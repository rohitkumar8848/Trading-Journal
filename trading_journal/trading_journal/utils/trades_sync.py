"""Promote broker-synced transactions into Trade journal records.

Accumulation model:
  - A Trade is OPEN while any bought qty remains unsold.
  - Buying more of the same symbol while a Trade is Open/Partially Sold appends
    a new Buy transaction to the SAME Trade (parent's entry_price = weighted avg).
  - Selling partially marks status=Partially Sold; selling all of it closes
    the Trade (Win/Loss/Breakeven based on realized P&L).
  - After a Trade is closed, buying the same symbol again starts a NEW Trade.

Transactions live as a child table `Trade.transactions` (Trade Transaction).
Dedup: `broker_trade_id` is unique across all transactions for a broker.
"""

from collections import defaultdict
from datetime import date as _date, datetime as _datetime

import frappe
from frappe.utils import flt, getdate, now_datetime


# ──────────────────────────── dedup ────────────────────────────

def _existing_txn_ids(broker: str) -> set:
	"""broker_trade_ids already imported for this broker, across all live Trades."""
	rows = frappe.db.sql(
		"""
		SELECT DISTINCT tt.broker_trade_id
		FROM `tabTrade Transaction` tt
		JOIN `tabTrade` t ON t.name = tt.parent
		WHERE t.broker = %s
		  AND tt.broker_trade_id IS NOT NULL AND tt.broker_trade_id != ''
		  AND tt.parenttype = 'Trade'
		""",
		(broker,),
	)
	return {r[0] for r in rows if r and r[0]}


@frappe.whitelist()
def diag(broker: str) -> dict:
	"""Diagnostic: counts of trades, transactions, and orphans for a broker."""
	trade_count = frappe.db.count("Trade", {"broker": broker})
	txn_total = frappe.db.sql(
		"SELECT COUNT(*) FROM `tabTrade Transaction` tt "
		"JOIN `tabTrade` t ON t.name = tt.parent WHERE t.broker = %s",
		(broker,),
	)[0][0]
	orphan = frappe.db.sql(
		"SELECT COUNT(*) FROM `tabTrade Transaction` tt "
		"WHERE tt.parenttype = 'Trade' "
		"AND NOT EXISTS (SELECT 1 FROM `tabTrade` t WHERE t.name = tt.parent)"
	)[0][0]
	sample = frappe.db.sql(
		"SELECT DISTINCT broker_trade_id FROM `tabTrade Transaction` "
		"WHERE parenttype='Trade' AND broker_trade_id IS NOT NULL LIMIT 10",
	)
	return {
		"broker": broker,
		"trade_count": trade_count,
		"txn_count": txn_total,
		"orphan_txns": orphan,
		"sample_ids": [r[0] for r in sample],
	}


@frappe.whitelist()
def purge_orphan_transactions() -> dict:
	"""Delete Trade Transaction rows whose parent Trade no longer exists."""
	deleted = frappe.db.sql(
		"DELETE tt FROM `tabTrade Transaction` tt "
		"WHERE tt.parenttype = 'Trade' "
		"AND NOT EXISTS (SELECT 1 FROM `tabTrade` t WHERE t.name = tt.parent)"
	)
	frappe.db.commit()
	return {"ok": True, "deleted_orphans": True}


def _open_trade_for(broker: str, symbol: str, exchange: str = None):
	"""Most recent Open or Partially Sold Trade for this broker+symbol+exchange.

	If `exchange` is provided we try an exact match first (to keep BSE / NSE
	trades separate), then fall back to symbol-only if no exchange-specific
	open trade exists.
	"""
	common = {
		"broker": broker, "symbol": symbol,
		"status": ["in", ("Open", "Partially Sold")],
		"source": "Broker Sync",
	}
	if exchange:
		rows = frappe.get_all("Trade",
			filters={**common, "exchange": exchange},
			fields=["name", "trade_type", "exchange"],
			order_by="buy_date desc, creation desc", limit=1)
		if rows:
			return rows[0]
	rows = frappe.get_all("Trade",
		filters=common,
		fields=["name", "trade_type", "exchange"],
		order_by="buy_date desc, creation desc", limit=1)
	return rows[0] if rows else None


def _ensure_stock_symbol(symbol: str):
	if not frappe.db.exists("Stock Symbol", symbol):
		frappe.get_doc({
			"doctype": "Stock Symbol",
			"symbol": symbol,
			"company_name": symbol,
			"is_active": 1,
		}).insert(ignore_permissions=True)


def _holding_cost_basis(broker: str, symbol: str, exchange: str = None):
	"""Avg cost of an existing holding. Matches exchange when possible."""
	common = {"broker": broker, "trading_symbol": symbol}
	if exchange:
		rows = frappe.get_all("Holding",
			filters={**common, "exchange": exchange},
			fields=["avg_cost_price"], limit=1)
		if rows and flt(rows[0].avg_cost_price) > 0:
			return flt(rows[0].avg_cost_price)
	rows = frappe.get_all("Holding",
		filters=common, fields=["avg_cost_price"], limit=1)
	if rows and flt(rows[0].avg_cost_price) > 0:
		return flt(rows[0].avg_cost_price)
	return None


def _txn_row(leg: dict) -> dict:
	"""Normalized leg → Trade Transaction child row dict."""
	executed_at = leg.get("executed_at")
	d = leg.get("date") or (executed_at.date() if executed_at else None)
	return {
		"action": leg["action"],
		"quantity": flt(leg.get("quantity") or 0),
		"rate": flt(leg.get("price") or 0),
		"date": d,
		"executed_at": executed_at,
		"broker_trade_id": str(leg.get("trade_id") or ""),
		"brokerage": flt(leg.get("brokerage") or 0),
		"taxes": flt(leg.get("taxes") or 0),
	}


# ──────────────────────────── main ────────────────────────────

def promote_legs(broker_name: str, incoming_legs: list) -> dict:
	"""Turn a batch of broker legs into Trade records using the accumulation model.

	`incoming_legs` keys per leg: trade_id, symbol, exchange, action, quantity,
	price, product, executed_at, brokerage, taxes.
	"""
	if not incoming_legs:
		return {"fetched": 0, "skipped_dup": 0, "skipped_no_symbol": 0,
		        "skipped_no_trade_id": 0, "created": 0, "appended": 0, "closed": 0}

	seen_ids = _existing_txn_ids(broker_name)

	skipped_dup, skipped_no_symbol, skipped_no_tid = 0, 0, 0
	fresh = []
	for leg in incoming_legs:
		tid = str(leg.get("trade_id") or "")
		if not tid:
			skipped_no_tid += 1
			continue
		if tid in seen_ids:
			skipped_dup += 1
			continue
		leg["symbol"] = (leg.get("symbol") or "").strip().upper()
		if not leg["symbol"]:
			skipped_no_symbol += 1
			continue
		fresh.append(leg)
		seen_ids.add(tid)  # also dedup within this batch

	if not fresh:
		return {
			"fetched": len(incoming_legs),
			"skipped_dup": skipped_dup,
			"skipped_no_symbol": skipped_no_symbol,
			"skipped_no_trade_id": skipped_no_tid,
			"created": 0, "appended": 0, "closed": 0,
		}

	# Group by symbol. (Product is informational only now — one Trade per open position.)
	groups = defaultdict(list)
	for leg in fresh:
		groups[leg["symbol"]].append(leg)

	created, appended, closed, unmatched_sells = 0, 0, 0, 0

	for symbol, bucket in groups.items():
		# Chronological order so accumulation behaves correctly.
		# Use datetime.min as fallback so comparisons are all datetime-vs-datetime.
		def _sort_k(l):
			dt = l.get("executed_at")
			if dt is None:
				return _datetime.min
			if not isinstance(dt, _datetime) and hasattr(dt, "year"):
				return _datetime.combine(dt, _datetime.min.time())
			return dt
		bucket.sort(key=_sort_k)

		# Walk each leg one at a time so that close-then-new-open transitions work.
		for leg in bucket:
			exch = leg.get("exchange") or None
			existing = _open_trade_for(broker_name, symbol, exch)

			if existing:
				# Append to the open trade
				doc = frappe.get_doc("Trade", existing["name"])
				doc.append("transactions", _txn_row(leg))
				doc.save(ignore_permissions=True)
				appended += 1
				if doc.status in ("Win", "Loss", "Breakeven"):
					closed += 1
				continue

			# No open trade. Decide what this leg starts:
			if leg["action"] == "Buy":
				_create_trade_from_leg(broker_name, symbol, "Long", leg)
				created += 1
				continue

			# Sell with no open trade. Only option: close an existing holding.
			# Never create a new Short out of a lone sell — that's almost always
			# a delivery exit of a pre-existing position.
			cost_basis = _holding_cost_basis(broker_name, symbol, exch)
			if cost_basis:
				_create_trade_closing_holding(broker_name, symbol, leg, cost_basis)
				created += 1
				closed += 1
			else:
				unmatched_sells += 1

	frappe.db.commit()
	return {
		"fetched": len(incoming_legs),
		"skipped_dup": skipped_dup,
		"skipped_no_symbol": skipped_no_symbol,
		"skipped_no_trade_id": skipped_no_tid,
		"created": created,
		"appended": appended,
		"closed": closed,
		"unmatched_sells": unmatched_sells,
	}


def _create_trade_from_leg(broker_name, symbol, trade_type, leg):
	_ensure_stock_symbol(symbol)
	d = (leg.get("executed_at").date() if leg.get("executed_at") else getdate())
	doc = frappe.get_doc({
		"doctype": "Trade",
		"broker": broker_name,
		"symbol": symbol,
		"trade_type": trade_type,
		"buy_date": d,
		"trade_date": d,  # legacy mirror, also set so before_save doesn't have to fallback
		"source": "Broker Sync",
		"transactions": [_txn_row(leg)],
	})
	doc.insert(ignore_permissions=True)
	return doc.name


def _create_trade_closing_holding(broker_name, symbol, sell_leg, cost_basis):
	"""Sell arrived for a symbol that exists in Holdings but has no Open Trade.
	Create a Trade with a synthetic opening buy at `cost_basis` + this sell leg.
	"""
	_ensure_stock_symbol(symbol)
	qty = flt(sell_leg.get("quantity"))
	sell_date = (sell_leg.get("executed_at").date()
	             if sell_leg.get("executed_at") else getdate())
	synthetic_buy = {
		"action": "Buy",
		"quantity": qty,
		"rate": cost_basis,
		"date": sell_date,  # we don't know real buy date
		"executed_at": None,
		"broker_trade_id": f"HOLDING-{symbol}-{sell_date}",
		"brokerage": 0,
		"taxes": 0,
		"notes": "Auto-created from existing holding cost basis",
	}
	doc = frappe.get_doc({
		"doctype": "Trade",
		"broker": broker_name,
		"symbol": symbol,
		"trade_type": "Long",
		"buy_date": sell_date,  # synthetic — we don't know real buy date
		"trade_date": sell_date,
		"source": "Broker Sync",
		"transactions": [synthetic_buy, _txn_row(sell_leg)],
	})
	doc.insert(ignore_permissions=True)
	return doc.name
