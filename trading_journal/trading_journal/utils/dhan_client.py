"""Dhan API v2 client for holdings/positions sync.

Uses raw HTTP (requests) to avoid adding the `dhanhq` SDK dependency.
Docs: https://dhanhq.co/docs/v2/
"""

import json
from datetime import datetime

import frappe
import requests
from frappe.utils import flt, now_datetime

DHAN_BASE = "https://api.dhan.co/v2"
TIMEOUT = 20  # seconds


def _headers(client_id: str, access_token: str) -> dict:
	return {
		"access-token": access_token,
		"client-id": client_id,
		"Content-Type": "application/json",
		"Accept": "application/json",
	}


def _get_broker_creds(broker_name: str):
	"""Fetch decrypted Dhan credentials for the named Broker.

	Client ID is extracted from the PAT (JWT) if not already stored on the doc.
	"""
	doc = frappe.get_doc("Broker", broker_name)
	if doc.broker_type != "Dhan":
		frappe.throw(f"Broker '{broker_name}' is not a Dhan account.")

	access_token = doc.get_password("dhan_access_token", raise_exception=False)
	if not access_token:
		frappe.throw(f"Dhan Access Token is required on broker '{broker_name}'.")

	client_id = doc.dhan_client_id
	if not client_id:
		# Extract from JWT claims
		from trading_journal.trading_journal.doctype.broker.broker import _decode_jwt_claim
		client_id = _decode_jwt_claim(access_token, "dhanClientId")
		if client_id:
			# Persist for future calls
			frappe.db.set_value("Broker", broker_name, "dhan_client_id", client_id)
			frappe.db.commit()
	if not client_id:
		frappe.throw("Could not extract Dhan Client ID from the PAT. Please paste a valid Dhan JWT token.")
	return client_id, access_token


def _record_sync(broker_name: str, status: str, error: str = ""):
	"""Record a sync attempt. `last_sync_at` only advances on success — that way
	the UI can show "Last successful sync 5h ago · Latest attempt FAILED: ...".
	"""
	is_ok = status.upper().startswith("OK")
	updates = {
		"last_sync_status": status,
		"last_sync_error": error[:500] if error else "",
	}
	if is_ok:
		updates["last_sync_at"] = now_datetime()
	frappe.db.set_value("Broker", broker_name, updates)
	frappe.db.commit()


def _http_get(path: str, client_id: str, access_token: str, params: dict = None):
	url = f"{DHAN_BASE}{path}"
	r = requests.get(
		url, headers=_headers(client_id, access_token),
		params=params or None, timeout=TIMEOUT,
	)
	if r.status_code == 401:
		raise RuntimeError("Unauthorized — access token expired or invalid. Regenerate on Dhan portal.")
	if r.status_code == 429:
		raise RuntimeError("Rate limited by Dhan. Try again in a moment.")
	if r.status_code == 404:
		# Some endpoints return 404 when no data exists for a range — treat as empty
		return []
	if not r.ok:
		raise RuntimeError(f"Dhan API {r.status_code} @ {path}: {r.text[:300]}")
	try:
		return r.json()
	except ValueError:
		raise RuntimeError(f"Invalid JSON from Dhan: {r.text[:200]}")


# ──────────────────────────── Holdings ────────────────────────────

def _upsert_holding(broker_name: str, row: dict):
	symbol = row.get("tradingSymbol") or row.get("symbol") or ""
	exchange = row.get("exchange") or "ALL"
	if not symbol:
		return None
	name = f"{broker_name}-{symbol}-{exchange}"
	data = {
		"broker": broker_name,
		"trading_symbol": symbol,
		"isin": row.get("isin") or "",
		"exchange": exchange,
		"security_id": str(row.get("securityId") or ""),
		"total_qty": flt(row.get("totalQty") or 0),
		"available_qty": flt(row.get("availableQty") or 0),
		"avg_cost_price": flt(row.get("avgCostPrice") or 0),
		"last_traded_price": flt(row.get("lastTradedPrice") or 0),
		"synced_at": now_datetime(),
	}
	if frappe.db.exists("Holding", name):
		doc = frappe.get_doc("Holding", name)
		doc.update(data)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": "Holding", **data})
		doc.insert(ignore_permissions=True)
	return doc.name


def sync_holdings(broker_name: str) -> dict:
	"""Fetch holdings from Dhan and upsert. Returns summary dict."""
	try:
		client_id, access_token = _get_broker_creds(broker_name)
		rows = _http_get("/holdings", client_id, access_token) or []

		fetched_names = set()
		for row in rows:
			n = _upsert_holding(broker_name, row)
			if n:
				fetched_names.add(n)

		# Delete holdings that no longer exist on broker
		existing = set(frappe.get_all(
			"Holding", filters={"broker": broker_name}, pluck="name"
		))
		stale = existing - fetched_names
		for n in stale:
			frappe.delete_doc("Holding", n, force=True, ignore_permissions=True)

		frappe.db.commit()
		msg = f"Synced {len(fetched_names)} holding(s). Removed {len(stale)} stale."
		_record_sync(broker_name, "OK — holdings")
		return {"ok": True, "count": len(fetched_names), "removed": len(stale), "message": msg}
	except Exception as e:
		err = str(e)
		_record_sync(broker_name, "FAILED — holdings", err)
		frappe.log_error(frappe.get_traceback(), "Dhan Holdings Sync")
		return {"ok": False, "error": err}


# ──────────────────────────── Positions ────────────────────────────

def _upsert_position(broker_name: str, row: dict):
	symbol = row.get("tradingSymbol") or ""
	product = row.get("productType") or "CNC"
	if not symbol:
		return None
	name = f"{broker_name}-{symbol}-{product}"
	buy_qty = flt(row.get("buyQty") or 0)
	sell_qty = flt(row.get("sellQty") or 0)
	net_qty = flt(row.get("netQty") or (buy_qty - sell_qty))
	pos_type = row.get("positionType") or ("LONG" if net_qty > 0 else ("SHORT" if net_qty < 0 else "CLOSED"))
	data = {
		"broker": broker_name,
		"trading_symbol": symbol,
		"exchange_segment": row.get("exchangeSegment") or "",
		"security_id": str(row.get("securityId") or ""),
		"product_type": product,
		"position_type": pos_type,
		"net_qty": net_qty,
		"buy_qty": buy_qty,
		"sell_qty": sell_qty,
		"buy_avg": flt(row.get("buyAvg") or 0),
		"sell_avg": flt(row.get("sellAvg") or 0),
		"last_traded_price": flt(row.get("lastTradedPrice") or row.get("costPrice") or 0),
		"realized_pnl": flt(row.get("realizedProfit") or 0),
		"unrealized_pnl": flt(row.get("unrealizedProfit") or 0),
		"day_buy_value": flt(row.get("dayBuyValue") or 0),
		"day_sell_value": flt(row.get("daySellValue") or 0),
		"multiplier": flt(row.get("multiplier") or 1),
		"is_open": 1 if net_qty != 0 else 0,
		"synced_at": now_datetime(),
	}
	if frappe.db.exists("Position", name):
		doc = frappe.get_doc("Position", name)
		doc.update(data)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": "Position", **data})
		doc.insert(ignore_permissions=True)
	return doc.name


def sync_positions(broker_name: str) -> dict:
	try:
		client_id, access_token = _get_broker_creds(broker_name)
		rows = _http_get("/positions", client_id, access_token) or []
		fetched_names = set()
		for row in rows:
			n = _upsert_position(broker_name, row)
			if n:
				fetched_names.add(n)

		existing = set(frappe.get_all(
			"Position", filters={"broker": broker_name}, pluck="name"
		))
		stale = existing - fetched_names
		for n in stale:
			frappe.delete_doc("Position", n, force=True, ignore_permissions=True)

		frappe.db.commit()
		_record_sync(broker_name, "OK — positions")
		return {"ok": True, "count": len(fetched_names), "removed": len(stale)}
	except Exception as e:
		err = str(e)
		_record_sync(broker_name, "FAILED — positions", err)
		frappe.log_error(frappe.get_traceback(), "Dhan Positions Sync")
		return {"ok": False, "error": err}


# ──────────────────────────── Combined / Whitelisted endpoints ────────────────────────────

@frappe.whitelist()
def test_connection(broker: str) -> dict:
	"""Ping Dhan with current creds."""
	try:
		client_id, access_token = _get_broker_creds(broker)
		# Lightweight endpoint: fund limit returns quickly and confirms auth
		_http_get("/fundlimit", client_id, access_token)
		_record_sync(broker, "OK — connection test")
		return {"ok": True, "message": f"Connected to Dhan as {client_id}"}
	except Exception as e:
		_record_sync(broker, "FAILED — connection test", str(e))
		return {"ok": False, "error": str(e)}


@frappe.whitelist()
def sync_broker(broker: str) -> dict:
	"""Sync holdings + positions for a single broker.

	Writes a final combined status so a failure in step 1 isn't masked by
	a success in step 2 (or vice versa).
	"""
	h = sync_holdings(broker)
	p = sync_positions(broker)
	overall_ok = h.get("ok") and p.get("ok")
	if overall_ok:
		_record_sync(broker, "OK — holdings + positions")
	else:
		fails = []
		if not h.get("ok"):
			fails.append(f"holdings: {h.get('error') or 'failed'}")
		if not p.get("ok"):
			fails.append(f"positions: {p.get('error') or 'failed'}")
		_record_sync(broker, "FAILED — partial sync", " | ".join(fails))
	return {
		"broker": broker,
		"holdings": h,
		"positions": p,
		"ok": overall_ok,
	}


# ──────────────────────────── Trades (executed legs) ────────────────────────────

def _parse_dhan_dt(s):
	"""Robustly parse Dhan timestamps. Handles these observed formats:
	    2026-04-22 10:15:30
	    2026-04-22T10:15:30
	    2026-04-22T10:15:30.123456
	    22-04-2026 10:15:30 (DD-MM-YYYY)
	    2026/04/22 10:15:30
	Returns datetime or None.
	"""
	if not s:
		return None
	s = str(s).strip()
	formats = [
		"%Y-%m-%d %H:%M:%S",
		"%Y-%m-%dT%H:%M:%S",
		"%Y-%m-%dT%H:%M:%S.%f",
		"%Y/%m/%d %H:%M:%S",
		"%d-%m-%Y %H:%M:%S",
		"%d/%m/%Y %H:%M:%S",
	]
	for fmt in formats:
		try:
			return datetime.strptime(s[:26] if ".%f" in fmt else s[:19], fmt)
		except Exception:
			continue
	return None


def _pick_dhan_time(row: dict):
	"""Try every known field name that Dhan might use for the trade execution time."""
	for key in ("exchangeTime", "exchange_time", "updateTime", "update_time",
	            "createTime", "create_time", "tradeTime", "trade_time",
	            "orderTime", "time"):
		val = row.get(key)
		if val:
			dt = _parse_dhan_dt(val)
			if dt:
				return dt
	return None


def _extract_dhan_charges(row: dict) -> tuple:
	"""Return (brokerage, total_taxes_and_fees, charges_breakdown_dict) from a Dhan trade row."""
	brokerage = flt(row.get("brokerage") or 0)
	tax_fields = {
		"stt": flt(row.get("sttCtt") or row.get("stt") or 0),
		"stamp_duty": flt(row.get("stampDuty") or 0),
		"sebi_fee": flt(row.get("sebiFee") or 0),
		"exchange_charge": flt(row.get("exchangeTransactionCharge") or 0),
		"ipft": flt(row.get("ipft") or 0),
		"gst": flt(row.get("gst") or 0),
		"additional_tax": flt(row.get("additionalTax") or 0),
	}
	taxes = sum(tax_fields.values())
	breakdown = {"brokerage": brokerage, **tax_fields, "total": brokerage + taxes}
	return brokerage, taxes, breakdown


def _fetch_dhan_trades(client_id: str, access_token: str, from_date, to_date):
	"""Fetch executed trades from Dhan for the given date range.

	Dhan exposes two endpoints (we try them in order):
	  1. GET /v2/trades/{fromDate}/{toDate}/{pageNumber}  — paginated history,
	     returns up to ~1000 rows per page.
	  2. GET /v2/trades  — today-only fallback if the history endpoint errors.

	Returns a list of raw row dicts.
	"""
	from frappe.utils import getdate

	f = str(getdate(from_date))
	t = str(getdate(to_date))

	# Try the paginated history endpoint first
	try:
		all_rows = []
		page = 0
		while True:
			page_rows = _http_get(f"/trades/{f}/{t}/{page}", client_id, access_token) or []
			if not page_rows:
				break
			all_rows.extend(page_rows)
			if len(page_rows) < 1000:  # last page
				break
			page += 1
			if page > 100:  # safety
				break
		return all_rows
	except Exception as e:
		# Log the reason but fall back
		frappe.log_error(f"Dhan /trades/{f}/{t}/0 failed: {e}", "Dhan Trades History Fallback")

	# Fallback: today's /trades endpoint
	return _http_get("/trades", client_id, access_token) or []


def sync_trades(broker_name: str, from_date: str = None, to_date: str = None) -> dict:
	"""Fetch executed trades from Dhan and promote to the Trade journal.

	When `from_date`/`to_date` are omitted, syncs ALL trades — uses the
	broker's `start_date` as the lower bound (falls back to 2015-01-01)
	and today as the upper bound. Dedup by `broker_trade_id` in the
	Trade Transaction child table makes repeated syncs safe.
	"""
	try:
		from trading_journal.trading_journal.utils import trades_sync
		from frappe.utils import nowdate, getdate

		# If either bound is missing, pull everything from broker start date to today.
		if not from_date:
			start = frappe.db.get_value("Broker", broker_name, "start_date")
			from_date = str(start) if start else "2015-01-01"
		if not to_date:
			to_date = nowdate()
		from_d = getdate(from_date)
		to_d = getdate(to_date)

		# Refresh holdings so cost-basis is fresh
		sync_holdings(broker_name)

		client_id, access_token = _get_broker_creds(broker_name)
		rows = _fetch_dhan_trades(client_id, access_token, from_d, to_d)

		debug = {"raw_rows": len(rows), "kept": 0, "dropped_no_date": 0,
		         "dropped_out_of_range": 0, "dropped_bad_action": 0,
		         "dropped_no_trade_id": 0,
		         "sample_keys": sorted(list(rows[0].keys()))[:30] if rows else []}

		incoming = []
		for row in rows:
			exec_dt = _pick_dhan_time(row)

			# If timestamp is missing, keep the row (best-effort) — we'll use
			# trade_date fallback when promoting to the journal.
			if exec_dt:
				d = exec_dt.date()
				if d < from_d or d > to_d:
					debug["dropped_out_of_range"] += 1
					continue
			else:
				debug["dropped_no_date"] += 1
				# Still keep it if we're doing a full sync (no explicit range)
				# so broker rows without times don't silently disappear.

			action_raw = (row.get("transactionType") or row.get("transaction_type") or "").upper()
			if action_raw.startswith("B"):
				action = "Buy"
			elif action_raw.startswith("S"):
				action = "Sell"
			else:
				debug["dropped_bad_action"] += 1
				continue

			trade_id = (row.get("tradeId") or row.get("trade_id")
			            or row.get("tradeNumber") or row.get("trade_number")
			            or row.get("orderId") or row.get("order_id"))
			if not trade_id:
				debug["dropped_no_trade_id"] += 1
				continue

			brokerage, taxes, breakdown = _extract_dhan_charges(row)
			sym = (row.get("tradingSymbol") or row.get("trading_symbol")
			       or row.get("customSymbol") or row.get("custom_symbol")
			       or row.get("scripName") or row.get("scrip_name")
			       or row.get("symbol") or "").strip().upper()
			incoming.append({
				"trade_id": str(trade_id),
				"order_id": str(row.get("orderId") or row.get("order_id") or ""),
				"symbol": sym,
				"exchange": (row.get("exchangeSegment") or row.get("exchange_segment")
				             or row.get("exchange") or ""),
				"action": action,
				"quantity": flt(row.get("tradedQuantity") or row.get("traded_quantity")
				                or row.get("quantity") or 0),
				"price": flt(row.get("tradedPrice") or row.get("traded_price")
				             or row.get("price") or 0),
				"brokerage": brokerage,
				"taxes": taxes,
				"charges_breakdown": breakdown,
				"product": row.get("productType") or row.get("product_type") or "",
				"executed_at": exec_dt,
				"raw": row,
			})
			debug["kept"] += 1

		result = trades_sync.promote_legs(broker_name, incoming)
		result["debug"] = debug
		_record_sync(broker_name, "OK — trades")
		return {"ok": True, "range": f"{from_date} → {to_date}", **result}
	except Exception as e:
		err = str(e)
		_record_sync(broker_name, "FAILED — trades", err)
		frappe.log_error(frappe.get_traceback(), "Dhan Trades Sync")
		return {"ok": False, "error": err}


@frappe.whitelist()
def sync_trades_api(broker: str, from_date: str = None, to_date: str = None) -> dict:
	return sync_trades(broker, from_date=from_date, to_date=to_date)


@frappe.whitelist()
def sync_all_brokers() -> dict:
	"""Sync every active Dhan broker. Returns per-broker results."""
	brokers = frappe.get_all(
		"Broker",
		filters={"is_active": 1, "broker_type": "Dhan"},
		pluck="name",
	)
	results = []
	for b in brokers:
		results.append(sync_broker(b))
	return {"count": len(brokers), "results": results}


@frappe.whitelist()
def sync_all_supported() -> dict:
	"""Sync every active Dhan + Zerodha broker."""
	from trading_journal.trading_journal.utils import zerodha_client

	dhan = frappe.get_all("Broker",
		filters={"is_active": 1, "broker_type": "Dhan"}, pluck="name")
	zer = frappe.get_all("Broker",
		filters={"is_active": 1, "broker_type": "Zerodha"}, pluck="name")

	results = []
	for b in dhan:
		r = sync_broker(b)
		r["source"] = "Dhan"
		results.append(r)
	for b in zer:
		r = zerodha_client.sync_broker(b)
		r["source"] = "Zerodha"
		results.append(r)

	return {"count": len(dhan) + len(zer), "results": results}
