"""Zerodha Kite Connect client for holdings/positions sync.

Uses raw HTTP (requests) to avoid adding the `kiteconnect` SDK dependency.
Docs: https://kite.trade/docs/connect/v3/

Auth flow (runs daily — tokens expire at 06:00 IST):
  1. User clicks "Login to Zerodha" → opens Kite login URL with api_key
  2. Kite redirects to /app/zerodha-callback?request_token=XYZ&...
  3. Our callback calls `exchange_token(broker, request_token)` which POSTs
     { api_key, request_token, checksum=sha256(api_key+request_token+api_secret) }
     to /session/token and stores the returned access_token on the Broker.
"""

import hashlib
from datetime import datetime, time

import frappe
import requests
from frappe.utils import flt, now_datetime, getdate, get_datetime

KITE_BASE = "https://api.kite.trade"
KITE_LOGIN = "https://kite.zerodha.com/connect/login"
TIMEOUT = 20


def _headers(api_key: str, access_token: str) -> dict:
	return {
		"X-Kite-Version": "3",
		"Authorization": f"token {api_key}:{access_token}",
	}


def _get_broker_creds(broker_name: str):
	"""Fetch decrypted Kite credentials for the named Broker."""
	doc = frappe.get_doc("Broker", broker_name)
	if doc.broker_type != "Zerodha":
		frappe.throw(f"Broker '{broker_name}' is not a Zerodha account.")

	api_key = doc.kite_api_key
	access_token = doc.get_password("kite_access_token", raise_exception=False)
	if not api_key:
		frappe.throw(f"Kite API Key is required on broker '{broker_name}'.")
	if not access_token:
		frappe.throw(
			f"No access token for '{broker_name}'. Click 'Login to Zerodha' "
			"on the broker form (tokens expire daily at 6 AM IST)."
		)
	return api_key, access_token


def _record_sync(broker_name: str, status: str, error: str = ""):
	"""`last_sync_at` only advances on success — preserves the last-known-good
	timestamp so a failed attempt doesn't masquerade as a successful sync.
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


def _http_get(path: str, api_key: str, access_token: str):
	url = f"{KITE_BASE}{path}"
	r = requests.get(url, headers=_headers(api_key, access_token), timeout=TIMEOUT)
	if r.status_code == 403:
		raise RuntimeError("Forbidden — access token expired (daily reset at 6 AM IST). Please re-login.")
	if r.status_code == 429:
		raise RuntimeError("Rate limited by Kite. Try again in a moment.")
	try:
		payload = r.json()
	except ValueError:
		raise RuntimeError(f"Invalid JSON from Kite: {r.text[:200]}")
	if not r.ok or payload.get("status") != "success":
		raise RuntimeError(payload.get("message") or f"Kite API {r.status_code}: {r.text[:300]}")
	return payload.get("data") or []


# ──────────────────────────── Login / OAuth ────────────────────────────

@frappe.whitelist()
def get_login_url(broker: str) -> dict:
	"""Return the Kite login URL the frontend should redirect to."""
	doc = frappe.get_doc("Broker", broker)
	if doc.broker_type != "Zerodha":
		frappe.throw(f"Broker '{broker}' is not a Zerodha account.")
	if not doc.kite_api_key:
		frappe.throw(f"Set Kite API Key on broker '{broker}' first.")
	return {
		"url": f"{KITE_LOGIN}?v=3&api_key={doc.kite_api_key}",
		"api_key": doc.kite_api_key,
	}


@frappe.whitelist()
def exchange_token(broker: str, request_token: str) -> dict:
	"""Exchange Kite request_token for access_token and persist on the Broker."""
	try:
		doc = frappe.get_doc("Broker", broker)
		if doc.broker_type != "Zerodha":
			frappe.throw(f"Broker '{broker}' is not a Zerodha account.")
		api_key = doc.kite_api_key
		api_secret = doc.get_password("kite_api_secret", raise_exception=False)
		if not api_key or not api_secret:
			frappe.throw(f"Kite API Key + Secret are required on broker '{broker}'.")

		checksum = hashlib.sha256(
			f"{api_key}{request_token}{api_secret}".encode("utf-8")
		).hexdigest()

		r = requests.post(
			f"{KITE_BASE}/session/token",
			data={"api_key": api_key, "request_token": request_token, "checksum": checksum},
			headers={"X-Kite-Version": "3"},
			timeout=TIMEOUT,
		)
		try:
			payload = r.json()
		except ValueError:
			raise RuntimeError(f"Invalid JSON from Kite: {r.text[:200]}")
		if payload.get("status") != "success":
			raise RuntimeError(payload.get("message") or f"Kite {r.status_code}: {r.text[:200]}")

		data = payload.get("data") or {}
		access_token = data.get("access_token")
		if not access_token:
			raise RuntimeError("No access_token in Kite response")

		# Kite tokens expire at 06:00 IST the next morning.
		now = now_datetime()
		expires = now.replace(hour=6, minute=0, second=0, microsecond=0)
		if now.hour >= 6:
			# Already past today's 6 AM — expires tomorrow 6 AM
			from datetime import timedelta
			expires = expires + timedelta(days=1)

		doc.kite_access_token = access_token
		doc.kite_token_expires_at = expires
		doc.save(ignore_permissions=True)
		_record_sync(broker, "OK — logged in")
		frappe.db.commit()
		return {"ok": True, "message": f"Logged in as {data.get('user_name') or data.get('user_id') or broker}", "user": data.get("user_id")}
	except Exception as e:
		_record_sync(broker, "FAILED — login", str(e))
		frappe.log_error(frappe.get_traceback(), "Kite Login")
		return {"ok": False, "error": str(e)}


# ──────────────────────────── Test ────────────────────────────

@frappe.whitelist()
def test_connection(broker: str) -> dict:
	try:
		api_key, access_token = _get_broker_creds(broker)
		data = _http_get("/user/profile", api_key, access_token)
		_record_sync(broker, "OK — connection test")
		name = data.get("user_name") or data.get("user_id") or broker
		return {"ok": True, "message": f"Connected as {name}"}
	except Exception as e:
		_record_sync(broker, "FAILED — connection test", str(e))
		return {"ok": False, "error": str(e)}


# ──────────────────────────── Holdings ────────────────────────────

def _upsert_holding(broker_name: str, row: dict):
	symbol = row.get("tradingsymbol") or ""
	exchange = row.get("exchange") or "NSE"
	if not symbol:
		return None
	name = f"{broker_name}-{symbol}-{exchange}"
	data = {
		"broker": broker_name,
		"trading_symbol": symbol,
		"isin": row.get("isin") or "",
		"exchange": exchange,
		"security_id": str(row.get("instrument_token") or ""),
		"total_qty": flt(row.get("quantity") or 0),
		"available_qty": flt(row.get("quantity") or 0) - flt(row.get("t1_quantity") or 0),
		"avg_cost_price": flt(row.get("average_price") or 0),
		"last_traded_price": flt(row.get("last_price") or 0),
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
	try:
		api_key, access_token = _get_broker_creds(broker_name)
		rows = _http_get("/portfolio/holdings", api_key, access_token) or []

		fetched = set()
		for row in rows:
			n = _upsert_holding(broker_name, row)
			if n:
				fetched.add(n)

		existing = set(frappe.get_all(
			"Holding", filters={"broker": broker_name}, pluck="name"
		))
		stale = existing - fetched
		for n in stale:
			frappe.delete_doc("Holding", n, force=True, ignore_permissions=True)

		frappe.db.commit()
		_record_sync(broker_name, "OK — holdings")
		return {"ok": True, "count": len(fetched), "removed": len(stale)}
	except Exception as e:
		_record_sync(broker_name, "FAILED — holdings", str(e))
		frappe.log_error(frappe.get_traceback(), "Kite Holdings Sync")
		return {"ok": False, "error": str(e)}


# ──────────────────────────── Positions ────────────────────────────

def _upsert_position(broker_name: str, row: dict):
	symbol = row.get("tradingsymbol") or ""
	product = row.get("product") or "CNC"
	if not symbol:
		return None
	name = f"{broker_name}-{symbol}-{product}"
	net_qty = flt(row.get("quantity") or 0)
	buy_qty = flt(row.get("buy_quantity") or 0)
	sell_qty = flt(row.get("sell_quantity") or 0)
	pos_type = "LONG" if net_qty > 0 else ("SHORT" if net_qty < 0 else "CLOSED")
	data = {
		"broker": broker_name,
		"trading_symbol": symbol,
		"exchange_segment": row.get("exchange") or "",
		"security_id": str(row.get("instrument_token") or ""),
		"product_type": product,
		"position_type": pos_type,
		"net_qty": net_qty,
		"buy_qty": buy_qty,
		"sell_qty": sell_qty,
		"buy_avg": flt(row.get("buy_price") or 0),
		"sell_avg": flt(row.get("sell_price") or 0),
		"last_traded_price": flt(row.get("last_price") or 0),
		"realized_pnl": flt(row.get("realised") or 0),
		"unrealized_pnl": flt(row.get("unrealised") or 0),
		"day_buy_value": flt(row.get("day_buy_value") or 0),
		"day_sell_value": flt(row.get("day_sell_value") or 0),
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
		api_key, access_token = _get_broker_creds(broker_name)
		data = _http_get("/portfolio/positions", api_key, access_token) or {}
		# Kite returns {"day": [...], "net": [...]}; use net for the authoritative view
		rows = data.get("net") if isinstance(data, dict) else data
		rows = rows or []

		fetched = set()
		for row in rows:
			n = _upsert_position(broker_name, row)
			if n:
				fetched.add(n)

		existing = set(frappe.get_all(
			"Position", filters={"broker": broker_name}, pluck="name"
		))
		stale = existing - fetched
		for n in stale:
			frappe.delete_doc("Position", n, force=True, ignore_permissions=True)

		frappe.db.commit()
		_record_sync(broker_name, "OK — positions")
		return {"ok": True, "count": len(fetched), "removed": len(stale)}
	except Exception as e:
		_record_sync(broker_name, "FAILED — positions", str(e))
		frappe.log_error(frappe.get_traceback(), "Kite Positions Sync")
		return {"ok": False, "error": str(e)}


@frappe.whitelist()
def sync_broker(broker: str) -> dict:
	h = sync_holdings(broker)
	p = sync_positions(broker)
	return {
		"broker": broker,
		"holdings": h,
		"positions": p,
		"ok": h.get("ok") and p.get("ok"),
	}


# ──────────────────────────── Trades (executed legs) ────────────────────────────

def _parse_kite_dt(s):
	"""Kite timestamps like '2026-04-22 10:15:30' or ISO."""
	if not s:
		return None
	for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
		try:
			return datetime.strptime(s[:19], fmt)
		except Exception:
			continue
	return None


def sync_trades(broker_name: str, from_date: str = None, to_date: str = None) -> dict:
	"""Fetch executed trades from Kite, promote to Trade journal.

	Kite's /trades endpoint returns TODAY ONLY — historical trades aren't
	exposed via API. For past dates, users should use Trade Import (CSV)
	with their Kite tradebook export.

	Charges are not returned by /trades. For accurate post-charges P&L on
	Zerodha trades, enter brokerage/STT manually on each Trade row or
	import a charges CSV.

	Syncs holdings FIRST so trades_sync can use fresh cost-basis data.
	"""
	try:
		from trading_journal.trading_journal.utils import trades_sync
		from frappe.utils import nowdate, getdate

		# Kite /trades is today-only regardless; date bounds only filter
		# client-side. When bounds are omitted, keep everything.
		from_d = getdate(from_date) if from_date else None
		to_d = getdate(to_date) if to_date else None

		sync_holdings(broker_name)

		api_key, access_token = _get_broker_creds(broker_name)
		rows = _http_get("/trades", api_key, access_token) or []

		incoming = []
		for row in rows:
			exec_dt = _parse_kite_dt(row.get("fill_timestamp") or row.get("order_timestamp"))
			if exec_dt and from_d and to_d:
				d = exec_dt.date()
				if d < from_d or d > to_d:
					continue

			txn = (row.get("transaction_type") or "").upper()
			if txn == "BUY":
				action = "Buy"
			elif txn == "SELL":
				action = "Sell"
			else:
				continue
			trade_id = row.get("trade_id") or row.get("order_id")
			if not trade_id:
				continue
			incoming.append({
				"trade_id": str(trade_id),
				"order_id": row.get("order_id") or "",
				"symbol": (row.get("tradingsymbol") or "").upper(),
				"exchange": row.get("exchange") or "",
				"action": action,
				"quantity": flt(row.get("quantity") or 0),
				"price": flt(row.get("average_price") or row.get("price") or 0),
				"brokerage": 0,  # Kite /trades doesn't return charges
				"taxes": 0,
				"product": row.get("product") or "",
				"executed_at": exec_dt,
				"raw": row,
			})

		result = trades_sync.promote_legs(broker_name, incoming)
		if from_d or to_d:
			# explicit range requested but Kite only gives today
			result["note"] = "Kite's /trades API returns only today's executions. For historical, use Trade Import (CSV) with your Kite tradebook export."
		_record_sync(broker_name, "OK — trades")
		return {"ok": True, **result}
	except Exception as e:
		err = str(e)
		_record_sync(broker_name, "FAILED — trades", err)
		frappe.log_error(frappe.get_traceback(), "Kite Trades Sync")
		return {"ok": False, "error": err}


@frappe.whitelist()
def sync_trades_api(broker: str, from_date: str = None, to_date: str = None) -> dict:
	return sync_trades(broker, from_date=from_date, to_date=to_date)
