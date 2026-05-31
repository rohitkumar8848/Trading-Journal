import frappe
from frappe.utils import flt
from collections import defaultdict


@frappe.whitelist()
def get_portfolio(broker=None, holder=None):
	"""Return consolidated + per-broker holdings and positions."""
	broker_filter = {"is_active": 1}
	if broker:
		broker_filter["name"] = broker
	if holder:
		broker_filter["account_holder"] = holder

	brokers = frappe.get_all(
		"Broker",
		filters=broker_filter,
		fields=["name", "broker_type", "account_holder", "last_sync_at", "last_sync_status", "last_sync_error"],
	)
	broker_names = [b.name for b in brokers]

	holdings = frappe.get_all(
		"Holding",
		filters={"broker": ["in", broker_names]} if broker_names else {"broker": "__none__"},
		fields=[
			"name", "broker", "trading_symbol", "isin", "exchange",
			"total_qty", "available_qty", "avg_cost_price", "last_traded_price",
			"invested_value", "current_value", "unrealized_pnl", "pnl_percent",
			"synced_at",
		],
	) if broker_names else []

	# Attach account_holder to each holding so the UI can render "Dhan · Dad" etc.
	holder_lookup = {b.name: (b.account_holder or "") for b in brokers}
	for h in holdings:
		h["account_holder"] = holder_lookup.get(h.get("broker"), "")

	positions = frappe.get_all(
		"Position",
		filters={"broker": ["in", broker_names]} if broker_names else {"broker": "__none__"},
		fields=[
			"name", "broker", "trading_symbol", "exchange_segment", "product_type",
			"position_type", "net_qty", "buy_qty", "sell_qty", "buy_avg", "sell_avg",
			"last_traded_price", "realized_pnl", "unrealized_pnl", "is_open",
			"day_buy_value", "day_sell_value", "synced_at",
		],
	) if broker_names else []

	# Holdings summary
	h_invested = sum(flt(h.invested_value) for h in holdings)
	h_current = sum(flt(h.current_value) for h in holdings)
	h_pnl = sum(flt(h.unrealized_pnl) for h in holdings)
	h_pct = round(h_pnl / h_invested * 100, 2) if h_invested else 0

	# Build lookup of broker → holder (from the brokers list we already fetched)
	holder_map = {b.name: (b.account_holder or "") for b in brokers}

	# Consolidated by ISIN (or fall back to symbol if ISIN missing)
	grouped = defaultdict(lambda: {
		"trading_symbol": "", "isin": "", "exchange": "",
		"total_qty": 0, "invested_value": 0, "current_value": 0,
		"unrealized_pnl": 0, "brokers": [], "ltp": 0, "avg_price_weighted": 0,
		"_sum_qty_price": 0,
	})
	for h in holdings:
		key = h.isin or h.trading_symbol
		g = grouped[key]
		g["trading_symbol"] = h.trading_symbol
		g["isin"] = h.isin or ""
		g["exchange"] = h.exchange or ""
		g["total_qty"] += flt(h.total_qty)
		g["invested_value"] += flt(h.invested_value)
		g["current_value"] += flt(h.current_value)
		g["unrealized_pnl"] += flt(h.unrealized_pnl)
		g["_sum_qty_price"] += flt(h.total_qty) * flt(h.avg_cost_price)
		g["ltp"] = flt(h.last_traded_price)  # last one wins; all brokers see same LTP
		g["brokers"].append({
			"broker": h.broker,
			"holder": holder_map.get(h.broker, ""),
			"qty": flt(h.total_qty),
			"avg": flt(h.avg_cost_price),
			"pnl": flt(h.unrealized_pnl),
		})

	consolidated = []
	for k, g in grouped.items():
		avg = g["_sum_qty_price"] / g["total_qty"] if g["total_qty"] else 0
		pct = g["unrealized_pnl"] / g["invested_value"] * 100 if g["invested_value"] else 0
		consolidated.append({
			"trading_symbol": g["trading_symbol"],
			"isin": g["isin"],
			"exchange": g["exchange"],
			"total_qty": g["total_qty"],
			"avg_cost_price": round(avg, 2),
			"ltp": g["ltp"],
			"invested_value": round(g["invested_value"], 2),
			"current_value": round(g["current_value"], 2),
			"unrealized_pnl": round(g["unrealized_pnl"], 2),
			"pnl_percent": round(pct, 2),
			"brokers": g["brokers"],
		})
	consolidated.sort(key=lambda x: -x["current_value"])

	# Positions summary
	p_open = [p for p in positions if p.is_open]
	p_realized = sum(flt(p.realized_pnl) for p in positions)
	p_unrealized = sum(flt(p.unrealized_pnl) for p in p_open)

	# Realized P&L from Trade journal (scoped by broker filter)
	if broker_names:
		trade_row = frappe.db.sql(
			"""
			SELECT COALESCE(SUM(pnl), 0), COUNT(*)
			FROM `tabTrade`
			WHERE broker IN %(brokers)s
			  AND status IN ('Win', 'Loss', 'Breakeven')
			""",
			{"brokers": tuple(broker_names)},
		)[0]
		trade_realized = flt(trade_row[0])
		trade_count = int(trade_row[1] or 0)

		open_trades = frappe.get_all(
			"Trade",
			filters={
				"broker": ["in", broker_names],
				"final_status": "Open",
			},
			fields=[
				"name", "symbol", "company_name", "exchange", "broker",
				"trade_type", "nature", "setup_type",
				"entry_price", "stop_loss", "target", "quantity",
				"current_price", "price_fetched_at",
				"pnl", "pnl_percent", "r_multiple", "risk_reward",
				"hold_days", "buy_date", "trade_date", "status",
			],
			order_by="buy_date desc, trade_date desc",
		)
	else:
		trade_realized, trade_count = 0, 0
		open_trades = []

	for t in open_trades:
		t["account_holder"] = holder_lookup.get(t.get("broker"), "")

	open_trades_summary = {
		"count": len(open_trades),
		"unrealized_pnl": round(sum(flt(t.get("pnl")) for t in open_trades), 2),
		"invested": round(
			sum(flt(t.get("entry_price")) * flt(t.get("quantity")) for t in open_trades), 2
		),
	}

	return {
		"brokers": brokers,
		"holdings": holdings,
		"consolidated_holdings": consolidated,
		"positions": positions,
		"holdings_summary": {
			"count": len(holdings),
			"unique_symbols": len(consolidated),
			"invested": round(h_invested, 2),
			"current": round(h_current, 2),
			"pnl": round(h_pnl, 2),
			"pnl_percent": h_pct,
		},
		"positions_summary": {
			"total": len(positions),
			"open": len(p_open),
			"realized_pnl": round(p_realized, 2),
			"unrealized_pnl": round(p_unrealized, 2),
			"total_pnl": round(p_realized + p_unrealized, 2),
		},
		"trades_summary": {
			"count": trade_count,
			"realized_pnl": round(trade_realized, 2),
		},
		"open_trades": open_trades,
		"open_trades_summary": open_trades_summary,
	}
