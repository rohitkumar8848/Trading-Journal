import frappe
from frappe.model.document import Document
from frappe.utils import flt, now_datetime


class Position(Document):
	pass


@frappe.whitelist()
def convert_to_holding(position: str) -> dict:
	"""Promote a long Position into a Holding immediately, ahead of the
	next-day broker holdings sync.

	The Holding is named with the same `{broker}-{symbol}-{exchange}` pattern
	that `_upsert_holding` uses in dhan_client / zerodha_client, so the next
	scheduled holdings sync upserts the same row instead of creating a duplicate.
	"""
	pos = frappe.get_doc("Position", position)
	qty = flt(pos.net_qty or 0)
	if qty <= 0:
		frappe.throw("Only LONG positions with a positive net qty can be converted.")

	broker_type = frappe.db.get_value("Broker", pos.broker, "broker_type") or ""
	if broker_type == "Dhan":
		# Dhan's holdings API doesn't return an `exchange` — `_upsert_holding`
		# falls back to "ALL" and that's what we have to match for dedup.
		exchange = "ALL"
	else:
		# Zerodha & friends: position carries `NSE_EQ`/`BSE_EQ`/etc — the
		# holdings row stores just `NSE`/`BSE`.
		seg = (pos.exchange_segment or "").upper()
		exchange = seg.split("_")[0] or "NSE"

	name = f"{pos.broker}-{pos.trading_symbol}-{exchange}"

	if frappe.db.exists("Holding", name):
		return {
			"ok": False,
			"name": name,
			"error": f"Holding '{name}' already exists. The next holdings sync will refresh it.",
		}

	doc = frappe.get_doc({
		"doctype": "Holding",
		"broker": pos.broker,
		"trading_symbol": pos.trading_symbol,
		"exchange": exchange,
		"security_id": pos.security_id or "",
		"total_qty": qty,
		"available_qty": qty,
		"avg_cost_price": flt(pos.buy_avg or 0),
		"last_traded_price": flt(pos.last_traded_price or 0),
		"synced_at": now_datetime(),
	})
	doc.insert(ignore_permissions=True)
	frappe.db.commit()

	# Create (or reuse) a Trade record so the user can chart-annotate now.
	# We don't wait for the broker /trades API — that often lags. Instead we
	# insert a synthetic placeholder transaction tagged with a "POS-CONVERT-"
	# broker_trade_id. When the regular sync_trades runs later and brings in
	# the real leg, `promote_legs` strips the placeholder so qty isn't doubled.
	from frappe.utils import nowdate
	today = nowdate()
	trade_name, trade_created = _ensure_trade_for_position(pos, today)

	return {
		"ok": True,
		"name": doc.name,
		"trade_name": trade_name,
		"trade_created": trade_created,
	}


@frappe.whitelist()
def convert_to_trade(position: str) -> dict:
	"""Create just the Trade record (no Holding) — works for both still-open
	and already-closed intraday positions. The Trade gets synthetic
	`POS-CONVERT-…` broker_trade_id(s); `trades_sync.promote_legs` strips
	them when the real broker legs arrive on the next sync.
	"""
	from frappe.utils import nowdate
	pos = frappe.get_doc("Position", position)
	if flt(pos.buy_qty or 0) <= 0 and flt(pos.sell_qty or 0) <= 0:
		frappe.throw("Position has no buy or sell quantity — nothing to record.")

	trade_name, trade_created = _ensure_trade_for_position(pos, nowdate())
	return {
		"ok": True,
		"trade_name": trade_name,
		"trade_created": trade_created,
	}


def _ensure_trade_for_position(pos, today):
	"""Return (trade_name, created_bool).

	Reuses an existing open Trade for this broker+symbol if one is already
	there. Otherwise creates a new Trade reflecting the position's actual
	activity:

	  - net_qty > 0  → still-open Long: one Buy leg sized to net_qty
	  - net_qty < 0  → still-open Short: one Sell leg sized to |net_qty|
	  - net_qty == 0 with both buy_qty and sell_qty: closed intraday — emit
	    both legs so the Trade closes with a realized P&L
	"""
	open_trade = frappe.get_all(
		"Trade",
		filters={
			"broker": pos.broker,
			"symbol": pos.trading_symbol,
			"final_status": "Open",
		},
		fields=["name"],
		order_by="creation desc",
		limit=1,
	)
	if open_trade:
		return open_trade[0].name, False

	if not frappe.db.exists("Stock Symbol", pos.trading_symbol):
		frappe.get_doc({
			"doctype": "Stock Symbol",
			"symbol": pos.trading_symbol,
			"company_name": pos.trading_symbol,
			"is_active": 1,
		}).insert(ignore_permissions=True)

	seg = (pos.exchange_segment or "").upper()
	exch_for_trade = seg.split("_")[0] or "NSE"

	net_qty = flt(pos.net_qty or 0)
	buy_qty = flt(pos.buy_qty or 0)
	sell_qty = flt(pos.sell_qty or 0)
	buy_avg = flt(pos.buy_avg or 0)
	sell_avg = flt(pos.sell_avg or 0)

	# Determine trade direction and the legs to record.
	transactions = []
	base_id = f"POS-CONVERT-{pos.name}"
	if net_qty > 0:
		# Still-open long
		trade_type = "Long"
		transactions.append({
			"action": "Buy", "quantity": net_qty,
			"rate": buy_avg or flt(pos.last_traded_price or 0),
			"date": today, "broker_trade_id": f"{base_id}-BUY",
			"brokerage": 0, "taxes": 0,
		})
	elif net_qty < 0:
		# Still-open short
		trade_type = "Short"
		transactions.append({
			"action": "Sell", "quantity": abs(net_qty),
			"rate": sell_avg or flt(pos.last_traded_price or 0),
			"date": today, "broker_trade_id": f"{base_id}-SELL",
			"brokerage": 0, "taxes": 0,
		})
	else:
		# Closed intraday — record both legs. Direction defaults to Long
		# (entered with a Buy) unless this was clearly opened on the sell
		# side at a higher avg (shorted, then covered).
		trade_type = "Short" if (sell_avg and buy_avg and sell_avg > buy_avg
		                          and (pos.position_type or "").upper() == "SHORT") else "Long"
		if buy_qty > 0:
			transactions.append({
				"action": "Buy", "quantity": buy_qty, "rate": buy_avg,
				"date": today, "broker_trade_id": f"{base_id}-BUY",
				"brokerage": 0, "taxes": 0,
			})
		if sell_qty > 0:
			transactions.append({
				"action": "Sell", "quantity": sell_qty, "rate": sell_avg,
				"date": today, "broker_trade_id": f"{base_id}-SELL",
				"brokerage": 0, "taxes": 0,
			})

	td = frappe.get_doc({
		"doctype": "Trade",
		"broker": pos.broker,
		"symbol": pos.trading_symbol,
		"exchange": exch_for_trade,
		"trade_type": trade_type,
		"buy_date": today,
		"trade_date": today,
		"source": "Broker Sync",  # blocks the rate-card calculator
		"transactions": transactions,
	})
	td.insert(ignore_permissions=True)
	frappe.db.commit()
	return td.name, True
