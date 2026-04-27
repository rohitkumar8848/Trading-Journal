import frappe
from frappe import _
from frappe.utils import flt, nowdate, add_months


@frappe.whitelist()
def get_kanban_data(from_date=None, to_date=None, symbol=None):
	if not from_date:
		from_date = add_months(nowdate(), -1)
	if not to_date:
		to_date = nowdate()

	filters = {"from_date": from_date, "to_date": to_date}
	symbol_cond = ""
	if symbol:
		symbol_cond = "AND symbol = %(symbol)s"
		filters["symbol"] = symbol

	# Group trades on the day they were closed (sell_date). Open trades still
	# appear — falling back to buy_date — so the board never hides live positions.
	trades = frappe.db.sql(
		f"""
		SELECT name, COALESCE(sell_date, buy_date, trade_date) AS trade_date,
		       symbol, company_name, trade_type,
		       status, setup_type, entry_price, stop_loss, target,
		       exit_price, pnl, pnl_percent, quantity
		FROM `tabTrade`
		WHERE COALESCE(sell_date, buy_date, trade_date) BETWEEN %(from_date)s AND %(to_date)s
		  {symbol_cond}
		ORDER BY COALESCE(sell_date, buy_date, trade_date) DESC, name DESC
		""",
		filters,
		as_dict=True,
	)

	# Group by day
	day_map = {}
	for t in trades:
		d = str(t.trade_date)
		if d not in day_map:
			day_map[d] = []
		day_map[d].append(t)

	days = []
	for d in sorted(day_map.keys(), reverse=True):
		day_trades = day_map[d]
		pnl_values = [flt(t.pnl or 0) for t in day_trades]
		statuses = [t.status for t in day_trades]
		total_pnl = sum(pnl_values)
		invested = sum(flt(t.entry_price or 0) * flt(t.quantity or 0) for t in day_trades)

		wins = statuses.count("Win")
		losses = statuses.count("Loss")
		be = statuses.count("Breakeven")
		open_count = statuses.count("Open")
		total = len(day_trades)

		days.append({
			"date": d,
			"total_trades": total,
			"wins": wins,
			"losses": losses,
			"breakeven": be,
			"open": open_count,
			"win_rate": round(wins / total * 100, 1) if total else 0,
			"total_pnl": total_pnl,
			"pnl_percent": round(total_pnl / invested * 100, 2) if invested else 0,
			"best_pnl": max((v for v in pnl_values if v > 0), default=0),
			"worst_pnl": min((v for v in pnl_values if v < 0), default=0),
			"column": "profit" if total_pnl > 0 else ("loss" if total_pnl < 0 else "breakeven"),
			"trade_pnls": pnl_values,
			"trade_symbols": [t.symbol for t in day_trades],
			"trades": [
				{
					"name": t.name,
					"symbol": t.symbol,
					"company": t.company_name or "",
					"type": t.trade_type,
					"status": t.status,
					"entry": flt(t.entry_price),
					"sl": flt(t.stop_loss),
					"target": flt(t.target),
					"exit": flt(t.exit_price),
					"pnl": flt(t.pnl or 0),
					"pnl_pct": flt(t.pnl_percent or 0),
				}
				for t in day_trades
			],
		})

	# Overall summary
	all_pnl = [d["total_pnl"] for d in days]
	profit_days = [d for d in days if d["total_pnl"] > 0]
	loss_days = [d for d in days if d["total_pnl"] < 0]
	cumulative, running = [], 0
	for d in sorted(days, key=lambda x: x["date"]):
		running += d["total_pnl"]
		cumulative.append({"date": d["date"], "value": round(running, 2)})

	summary = {
		"total_days": len(days),
		"profit_days": len(profit_days),
		"loss_days": len(loss_days),
		"total_pnl": sum(all_pnl),
		"best_day": max((v for v in all_pnl if v > 0), default=0),
		"worst_day": min((v for v in all_pnl if v < 0), default=0),
		"total_trades": sum(d["total_trades"] for d in days),
		"cumulative": cumulative,
	}

	return {"days": days, "summary": summary}
