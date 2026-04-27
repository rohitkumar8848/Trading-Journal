import frappe
from frappe import _
from frappe.utils import flt


def execute(filters=None):
	filters = filters or {}
	columns = get_columns()
	data = get_data(filters)
	chart = get_chart(data)
	summary = get_summary(data)
	return columns, data, None, chart, summary


def get_columns():
	return [
		{"fieldname": "name", "label": _("Trade ID"), "fieldtype": "Link", "options": "Trade", "width": 120},
		{"fieldname": "trade_date", "label": _("Close Date"), "fieldtype": "Date", "width": 110},
		{"fieldname": "symbol", "label": _("Symbol"), "fieldtype": "Data", "width": 100},
		{"fieldname": "trade_type", "label": _("Type"), "fieldtype": "Data", "width": 70},
		{"fieldname": "setup_type", "label": _("Setup"), "fieldtype": "Data", "width": 110},
		{"fieldname": "entry_price", "label": _("Entry"), "fieldtype": "Currency", "width": 100, "options": "currency"},
		{"fieldname": "stop_loss", "label": _("SL"), "fieldtype": "Currency", "width": 100, "options": "currency"},
		{"fieldname": "target", "label": _("Target"), "fieldtype": "Currency", "width": 100, "options": "currency"},
		{"fieldname": "exit_price", "label": _("Exit"), "fieldtype": "Currency", "width": 100, "options": "currency"},
		{"fieldname": "quantity", "label": _("Qty"), "fieldtype": "Float", "width": 70},
		{"fieldname": "pnl", "label": _("P&L"), "fieldtype": "Currency", "width": 100, "options": "currency"},
		{"fieldname": "pnl_percent", "label": _("P&L %"), "fieldtype": "Percent", "width": 90},
		{"fieldname": "risk_reward", "label": _("R:R"), "fieldtype": "Float", "width": 70},
		{"fieldname": "status", "label": _("Status"), "fieldtype": "Data", "width": 90},
		{"fieldname": "outcome", "label": _("Outcome"), "fieldtype": "Data", "width": 130},
	]


def get_data(filters):
	# Report is keyed on sell_date (close date) — the date P&L was realized.
	conditions = " AND sell_date IS NOT NULL"
	if filters.get("from_date"):
		conditions += " AND sell_date >= %(from_date)s"
	if filters.get("to_date"):
		conditions += " AND sell_date <= %(to_date)s"
	if filters.get("symbol"):
		conditions += " AND symbol = %(symbol)s"
	if filters.get("status"):
		conditions += " AND status = %(status)s"
	if filters.get("setup_type"):
		conditions += " AND setup_type = %(setup_type)s"

	return frappe.db.sql(
		f"""
		SELECT name, sell_date AS trade_date, symbol, trade_type, setup_type,
		       entry_price, stop_loss, target, exit_price, quantity,
		       pnl, pnl_percent, risk_reward, status, outcome
		FROM `tabTrade`
		WHERE 1=1 {conditions}
		ORDER BY sell_date DESC, name DESC
		""",
		filters,
		as_dict=True,
	)


def get_chart(data):
	if not data:
		return None
	pnl_values = [flt(r.get("pnl") or 0) for r in data]
	labels = [str(r.get("trade_date")) for r in data]
	cumulative, running = [], 0
	for v in pnl_values:
		running += v
		cumulative.append(running)
	return {
		"data": {"labels": labels, "datasets": [{"name": "Cumulative P&L", "values": cumulative}]},
		"type": "Line",
		"colors": ["#5E64FF"],
		"title": "Equity Curve",
	}


def get_summary(data):
	if not data:
		return []
	total = len(data)
	wins = sum(1 for r in data if r.get("status") == "Win")
	total_pnl = sum(flt(r.get("pnl") or 0) for r in data)
	win_rate = (wins / total * 100) if total else 0
	return [
		{"label": _("Total Trades"), "value": total, "datatype": "Int"},
		{"label": _("Win Rate"), "value": f"{win_rate:.1f}%", "datatype": "Data", "indicator": "Green" if win_rate >= 50 else "Red"},
		{"label": _("Total P&L"), "value": total_pnl, "datatype": "Currency", "indicator": "Green" if total_pnl >= 0 else "Red"},
	]
