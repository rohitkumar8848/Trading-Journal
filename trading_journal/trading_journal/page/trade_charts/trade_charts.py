"""Backend for the Trade Charts review page — closed trades with before/after screenshots."""
import frappe
from frappe.utils import flt, nowdate, add_months, now_datetime


def _truthy(v):
	return str(v).lower() in ("1", "true", "yes", "on")


@frappe.whitelist()
def get_chart_trades(from_date=None, to_date=None, outcome=None, symbol=None, include_reviewed=0):
	"""Closed trades with at least one screenshot, for side-by-side review.

	By default, trades marked `chart_reviewed=1` are excluded so the page acts
	as a backlog. Pass `include_reviewed=1` to show everything.
	"""
	if not from_date:
		from_date = add_months(nowdate(), -3)
	if not to_date:
		to_date = nowdate()

	filters = {"from_date": from_date, "to_date": to_date}
	clauses = []
	if outcome == "win":
		clauses.append("status = 'Win'")
	elif outcome == "loss":
		clauses.append("status = 'Loss'")
	elif outcome == "breakeven":
		clauses.append("status = 'Breakeven'")
	if symbol:
		clauses.append("symbol = %(symbol)s")
		filters["symbol"] = symbol
	if not _truthy(include_reviewed):
		clauses.append("(chart_reviewed IS NULL OR chart_reviewed = 0)")
	extra = (" AND " + " AND ".join(clauses)) if clauses else ""

	rows = frappe.db.sql(
		f"""
		SELECT name, symbol, company_name, exchange, broker,
		       trade_type, status, setup_type, outcome, trade_grade,
		       buy_date, sell_date,
		       entry_price, exit_price, quantity,
		       pnl, pnl_percent, r_multiple, risk_reward,
		       entry_screenshot, exit_screenshot, screenshot,
		       current_price, price_fetched_at, trade_notes,
		       chart_reviewed, chart_reviewed_at, chart_review_notes
		FROM `tabTrade`
		WHERE final_status = 'Closed'
		  AND sell_date IS NOT NULL
		  AND sell_date BETWEEN %(from_date)s AND %(to_date)s
		  AND (entry_screenshot IS NOT NULL OR exit_screenshot IS NOT NULL OR screenshot IS NOT NULL)
		  {extra}
		ORDER BY sell_date DESC, name DESC
		""",
		filters,
		as_dict=True,
	)

	for r in rows:
		# Prefer the new fields, fall back to legacy `screenshot` so old data still shows.
		r["entry_img"] = r.get("entry_screenshot") or r.get("screenshot") or ""
		r["exit_img"] = r.get("exit_screenshot") or ""
		r["pnl"] = flt(r.get("pnl") or 0)
		r["pnl_percent"] = flt(r.get("pnl_percent") or 0)
		r["r_multiple"] = flt(r.get("r_multiple") or 0)
		r["buy_date"] = str(r["buy_date"]) if r.get("buy_date") else ""
		r["sell_date"] = str(r["sell_date"]) if r.get("sell_date") else ""
		r["chart_reviewed"] = int(r.get("chart_reviewed") or 0)
		r["chart_reviewed_at"] = str(r["chart_reviewed_at"]) if r.get("chart_reviewed_at") else ""

	# Summary counters (over the returned/visible rows)
	total = len(rows)
	wins = sum(1 for r in rows if r["status"] == "Win")
	losses = sum(1 for r in rows if r["status"] == "Loss")
	net_pnl = sum(r["pnl"] for r in rows)

	# Reviewed/pending backlog counts in the same date range (for "N pending" label)
	backlog = frappe.db.sql(
		"""
		SELECT
			SUM(CASE WHEN chart_reviewed = 1 THEN 1 ELSE 0 END) AS reviewed,
			SUM(CASE WHEN chart_reviewed = 0 OR chart_reviewed IS NULL THEN 1 ELSE 0 END) AS pending
		FROM `tabTrade`
		WHERE final_status = 'Closed'
		  AND sell_date IS NOT NULL
		  AND sell_date BETWEEN %(from_date)s AND %(to_date)s
		  AND (entry_screenshot IS NOT NULL OR exit_screenshot IS NOT NULL OR screenshot IS NOT NULL)
		""",
		{"from_date": from_date, "to_date": to_date},
		as_dict=True,
	)
	bl = backlog[0] if backlog else {}

	return {
		"trades": rows,
		"summary": {
			"total": total,
			"wins": wins,
			"losses": losses,
			"breakeven": total - wins - losses,
			"net_pnl": round(net_pnl, 2),
			"pending": int(bl.get("pending") or 0),
			"reviewed": int(bl.get("reviewed") or 0),
		},
		"from_date": from_date,
		"to_date": to_date,
		"include_reviewed": bool(_truthy(include_reviewed)),
	}


@frappe.whitelist()
def mark_reviewed(trade: str, reviewed: int = 1, notes: str = "") -> dict:
	"""Toggle chart_reviewed on a Trade. Auto-stamps chart_reviewed_at."""
	doc = frappe.get_doc("Trade", trade)
	doc.chart_reviewed = 1 if _truthy(reviewed) else 0
	if notes:
		doc.chart_review_notes = notes
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {
		"ok": True,
		"name": doc.name,
		"chart_reviewed": doc.chart_reviewed,
		"chart_reviewed_at": str(doc.chart_reviewed_at) if doc.chart_reviewed_at else "",
	}
