import frappe
from frappe import _
from frappe.utils import flt


def execute(filters=None):
	filters = filters or {}
	columns = get_columns()
	data = get_data(filters)
	chart = get_chart(data)
	return columns, data, None, chart


def get_columns():
	return [
		{"fieldname": "trade_date", "label": _("Close Date"), "fieldtype": "Date", "width": 110},
		{"fieldname": "total_trades", "label": _("Trades"), "fieldtype": "Int", "width": 80},
		{"fieldname": "wins", "label": _("Wins"), "fieldtype": "Int", "width": 70},
		{"fieldname": "losses", "label": _("Losses"), "fieldtype": "Int", "width": 80},
		{"fieldname": "breakeven", "label": _("B/E"), "fieldtype": "Int", "width": 60},
		{"fieldname": "win_rate", "label": _("Win Rate %"), "fieldtype": "Percent", "width": 110},
		{"fieldname": "total_pnl", "label": _("Total P&L"), "fieldtype": "Currency", "width": 120},
		{"fieldname": "avg_win", "label": _("Avg Win"), "fieldtype": "Currency", "width": 110},
		{"fieldname": "avg_loss", "label": _("Avg Loss"), "fieldtype": "Currency", "width": 110},
		{"fieldname": "best_trade_pnl", "label": _("Best Trade"), "fieldtype": "Currency", "width": 120},
		{"fieldname": "worst_trade_pnl", "label": _("Worst Trade"), "fieldtype": "Currency", "width": 120},
		{"fieldname": "setups", "label": _("Setups Used"), "fieldtype": "Data", "width": 160},
	]


def get_data(filters):
	# Keyed on sell_date (close date) — the day P&L was realized.
	conditions = " AND sell_date IS NOT NULL"
	if filters.get("from_date"):
		conditions += " AND sell_date >= %(from_date)s"
	if filters.get("to_date"):
		conditions += " AND sell_date <= %(to_date)s"
	if filters.get("symbol"):
		conditions += " AND symbol = %(symbol)s"

	trades = frappe.db.sql(
		f"""
		SELECT sell_date AS trade_date, symbol, status, pnl, setup_type
		FROM `tabTrade`
		WHERE 1=1 {conditions}
		ORDER BY sell_date DESC
		""",
		filters,
		as_dict=True,
	)

	day_map = {}
	for t in trades:
		d = str(t.trade_date)
		if d not in day_map:
			day_map[d] = {"trades": [], "date": t.trade_date}
		day_map[d]["trades"].append(t)

	data = []
	for d in sorted(day_map.keys(), reverse=True):
		day = day_map[d]
		day_trades = day["trades"]
		wins = [t for t in day_trades if t.status == "Win"]
		losses = [t for t in day_trades if t.status == "Loss"]
		be = [t for t in day_trades if t.status == "Breakeven"]
		pnl_values = [flt(t.pnl) for t in day_trades if t.pnl is not None]
		win_pnl = [flt(t.pnl) for t in wins]
		loss_pnl = [flt(t.pnl) for t in losses]
		setups = list({t.setup_type for t in day_trades if t.setup_type})

		data.append({
			"trade_date": day["date"],
			"total_trades": len(day_trades),
			"wins": len(wins),
			"losses": len(losses),
			"breakeven": len(be),
			"win_rate": (len(wins) / len(day_trades) * 100) if day_trades else 0,
			"total_pnl": sum(pnl_values),
			"avg_win": (sum(win_pnl) / len(win_pnl)) if win_pnl else 0,
			"avg_loss": (sum(loss_pnl) / len(loss_pnl)) if loss_pnl else 0,
			"best_trade_pnl": max(pnl_values) if pnl_values else 0,
			"worst_trade_pnl": min(pnl_values) if pnl_values else 0,
			"setups": ", ".join(setups),
		})

	return data


def get_chart(data):
	if not data:
		return None
	labels = [str(row["trade_date"]) for row in reversed(data)]
	pnl_values = [row["total_pnl"] for row in reversed(data)]
	cumulative = []
	running = 0
	for v in pnl_values:
		running += v
		cumulative.append(running)

	return {
		"data": {
			"labels": labels,
			"datasets": [
				{"name": "Daily P&L", "values": pnl_values},
				{"name": "Cumulative P&L", "values": cumulative},
			],
		},
		"type": "Bar",
		"colors": ["#5E64FF", "#28a745"],
		"title": "Daily P&L",
	}
