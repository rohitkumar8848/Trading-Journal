"""Broker CSV import.

Routes every CSV row as a transaction "leg" through the same accumulation engine
(`trades_sync.promote_legs`) that powers live broker sync. So:

- Buy legs open or extend a Long Trade (one Trade per open position, weighted-avg entry).
- Sell legs close part / all of an existing Long Trade.
- A Sell with no open Trade but with a matching Holding closes the holding
  using its `avg_cost_price` as a synthetic Buy.
- A Sell with neither is reported as `unmatched_sells` — never silently becomes a Short.
- Dedup across imports via `broker_trade_id`. Re-importing the same CSV is safe.

Supported formats: Zerodha tradebook, Upstox trade report, Generic CSV.
"""

import csv
import hashlib
import io
from datetime import datetime

import frappe
from frappe.utils import flt, getdate

from trading_journal.trading_journal.utils import trades_sync


# ───────────────────────── CSV parsing ─────────────────────────

def _parse_csv(file_content: str) -> list:
	file_content = file_content.lstrip("﻿")
	reader = csv.DictReader(io.StringIO(file_content))
	return [{(k or "").strip(): (v or "").strip() for k, v in row.items()} for row in reader]


def _detect_broker(headers: list) -> str:
	h = {(x or "").lower().strip() for x in headers}
	if {"symbol", "trade_date", "trade_type"}.issubset(h):
		return "zerodha"
	if {"scrip", "trade date", "transaction type", "quantity"}.issubset(h):
		return "upstox"
	return "generic"


def _parse_dt(s):
	if not s:
		return None
	s = str(s).strip()
	for fmt in (
		"%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S",
		"%d-%m-%Y %H:%M:%S", "%d/%m/%Y %H:%M:%S",
		"%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y",
	):
		try:
			return datetime.strptime(s[:19], fmt)
		except ValueError:
			continue
	return None


def _synth_id(row: dict, source: str) -> str:
	"""Stable id when the broker CSV doesn't include trade_id — derived from row contents."""
	key = "|".join(f"{k}={row.get(k, '')}" for k in sorted(row.keys()))
	return f"csv-{source}-{hashlib.sha1(key.encode('utf-8')).hexdigest()[:16]}"


def _normalize(rows: list, source: str) -> list:
	"""Turn raw CSV rows into legs ready for promote_legs."""
	out = []
	for r in rows:
		action_raw = (
			r.get("trade_type") or r.get("Trade Type")
			or r.get("Transaction Type") or r.get("type") or r.get("Type")
			or r.get("action") or ""
		).strip().lower()
		if not action_raw:
			continue
		action = "Buy" if action_raw.startswith("b") else "Sell"

		symbol = (r.get("symbol") or r.get("Symbol") or r.get("Scrip") or "").strip().upper()
		if not symbol:
			continue

		# Exchange — Zerodha tradebook puts NSE/BSE in `exchange`; "segment" of EQ/BE
		# is the equity series, which we collapse to NSE.
		exchange = (r.get("exchange") or r.get("Exchange") or "").strip().upper()
		if not exchange:
			seg = (r.get("segment") or r.get("Segment") or "").strip().upper()
			exchange = "BSE" if seg.startswith("BSE") else "NSE"
		if exchange in ("EQ", "BE", "NSE_EQ"):
			exchange = "NSE"
		elif exchange in ("BSE_EQ",):
			exchange = "BSE"

		qty = flt(r.get("quantity") or r.get("Quantity") or r.get("qty") or 0)
		price = flt(
			r.get("price") or r.get("Price") or r.get("Avg. Price")
			or r.get("Average Price") or r.get("entry") or 0
		)
		if qty <= 0 or price <= 0:
			continue

		date_str = (
			r.get("trade_date") or r.get("Trade Date") or r.get("date")
			or r.get("Date") or ""
		).strip()
		try:
			d = getdate(date_str) if date_str else None
		except Exception:
			d = None
		if not d:
			continue

		exec_dt = _parse_dt(
			r.get("order_execution_time") or r.get("Order Execution Time")
			or date_str
		)

		trade_id = (
			r.get("trade_id") or r.get("Trade ID")
			or r.get("Trade Id") or ""
		).strip() or _synth_id(r, source)

		out.append({
			"trade_id": str(trade_id),
			"order_id": (r.get("order_id") or r.get("Order ID") or "").strip(),
			"symbol": symbol,
			"exchange": exchange,
			"action": action,
			"quantity": qty,
			"price": price,
			"brokerage": 0,
			"taxes": 0,
			"executed_at": exec_dt,
			"date": str(d),
			"raw": r,
		})
	return out


# ───────────────────────── public endpoints ─────────────────────────

@frappe.whitelist()
def preview(file_content: str):
	"""Roll the legs up by symbol so the user can see what's coming in."""
	rows = _parse_csv(file_content)
	if not rows:
		return {"broker": "unknown", "row_count": 0, "leg_count": 0,
		        "summary": {}, "by_symbol": [], "error": "No rows found"}
	source = _detect_broker(list(rows[0].keys()))
	legs = _normalize(rows, source)

	# Group by symbol (not symbol+exchange) so the preview matches what the
	# accumulation engine will actually do — cross-exchange sells of the same
	# symbol are merged into one Trade by promote_legs.
	by_symbol = {}
	for leg in legs:
		key = leg["symbol"]
		agg = by_symbol.setdefault(key, {
			"symbol": leg["symbol"],
			"exchanges": set(),
			"buys": 0, "sells": 0,
			"buy_qty": 0, "sell_qty": 0,
			"first_date": leg["date"],
			"last_date": leg["date"],
		})
		agg["exchanges"].add(leg["exchange"])
		if leg["action"] == "Buy":
			agg["buys"] += 1
			agg["buy_qty"] += leg["quantity"]
		else:
			agg["sells"] += 1
			agg["sell_qty"] += leg["quantity"]
		if leg["date"] < agg["first_date"]:
			agg["first_date"] = leg["date"]
		if leg["date"] > agg["last_date"]:
			agg["last_date"] = leg["date"]
	# Serialize the set for JSON
	for v in by_symbol.values():
		v["exchange"] = "/".join(sorted(v.pop("exchanges")))

	return {
		"broker": source,
		"row_count": len(rows),
		"leg_count": len(legs),
		"summary": {
			"buys": sum(1 for x in legs if x["action"] == "Buy"),
			"sells": sum(1 for x in legs if x["action"] == "Sell"),
			"symbols": len(by_symbol),
		},
		"by_symbol": sorted(by_symbol.values(), key=lambda x: x["symbol"]),
	}


@frappe.whitelist()
def do_import(file_content: str, skip_existing: int = 1, broker: str = None):
	"""Promote every leg via the accumulation engine. Re-runs are idempotent (deduped by broker_trade_id)."""
	try:
		rows = _parse_csv(file_content)
		if not rows:
			return {"ok": False, "error": "No rows in file"}
		source = _detect_broker(list(rows[0].keys()))
		legs = _normalize(rows, source)

		if not broker:
			active = frappe.db.get_all("Broker", filters={"is_active": 1}, pluck="name")
			if len(active) == 1:
				broker = active[0]
			else:
				return {
					"ok": False,
					"error": "Please select a broker before importing (multiple brokers configured).",
					"broker": None, "source": source,
				}
		if not frappe.db.exists("Broker", broker):
			return {"ok": False, "error": f"Broker '{broker}' does not exist.", "source": source}

		result = trades_sync.promote_legs(broker, legs)
		return {
			"ok": True,
			"broker": broker,
			"source": source,
			"row_count": len(rows),
			"leg_count": len(legs),
			**result,
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "CSV Import Failed")
		return {
			"ok": False,
			"error": f"{type(e).__name__}: {str(e)[:500]}",
			"broker": broker,
		}
