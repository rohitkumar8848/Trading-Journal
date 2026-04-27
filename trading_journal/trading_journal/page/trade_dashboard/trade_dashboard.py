import frappe
from frappe import _
from frappe.utils import flt, nowdate, add_months, getdate
from collections import defaultdict
from datetime import timedelta, date as _date


@frappe.whitelist()
def get_dashboard_data(from_date=None, to_date=None, broker=None):
	if not from_date:
		from_date = add_months(nowdate(), -1)
	if not to_date:
		to_date = nowdate()

	broker_clause = ""
	params = {"from_date": from_date, "to_date": to_date}
	if broker:
		broker_clause = "AND broker = %(broker)s"
		params["broker"] = broker

	# Attribute trades to the date profit was realized (sell_date = last sell).
	# Open trades have no realized P&L yet → excluded.
	trades = frappe.db.sql(
		f"""
		SELECT name, sell_date AS trade_date, symbol, trade_type, status, setup_type,
		       entry_price, stop_loss, target, exit_price, pnl, pnl_percent,
		       risk_reward, quantity, broker
		FROM `tabTrade`
		WHERE sell_date IS NOT NULL
		  AND sell_date BETWEEN %(from_date)s AND %(to_date)s
		  {broker_clause}
		ORDER BY sell_date ASC, name ASC
		""",
		params,
		as_dict=True,
	)

	# Broker list for filter dropdown + per-broker aggregates
	brokers = frappe.db.sql(
		"""
		SELECT b.name, b.broker_type, b.account_holder,
		       b.starting_capital, b.start_date,
		       COALESCE(SUM(t.pnl), 0) AS realized_pnl,
		       COUNT(t.name) AS trade_count,
		       COALESCE(SUM(CASE WHEN t.status = 'Open' THEN 1 ELSE 0 END), 0) AS open_count,
		       COALESCE(SUM(CASE WHEN t.status = 'Open' THEN t.entry_price * t.quantity ELSE 0 END), 0) AS open_exposure
		FROM `tabBroker` b
		LEFT JOIN `tabTrade` t ON t.broker = b.name
		WHERE b.is_active = 1
		GROUP BY b.name
		ORDER BY b.account_holder ASC, b.broker_name ASC
		""",
		as_dict=True,
	)
	for b in brokers:
		b["current_equity"] = flt(b.starting_capital) + flt(b.realized_pnl)
		b["return_pct"] = round((flt(b.realized_pnl) / flt(b.starting_capital) * 100), 2) if flt(b.starting_capital) else 0

	total = len(trades)
	wins = [t for t in trades if t.status == "Win"]
	losses = [t for t in trades if t.status == "Loss"]
	pnl_list = [flt(t.pnl or 0) for t in trades]
	total_pnl = sum(pnl_list)

	# Equity curve + drawdown.
	# peak = highest running P&L seen so far (clamped to 0 if we're underwater from day 1).
	# dd = running - peak (always ≤ 0).
	# dd_pct is reported against whichever is larger: the peak, or the absolute size of the
	# trough itself — so if you've never been positive, the denominator is the drawdown
	# magnitude (giving you a meaningful "-100% of your low-water mark" reading rather
	# than a silent 0%).
	cumulative, running = [], 0
	peak = 0
	drawdown_curve = []
	max_dd = 0
	max_dd_pct = 0
	current_dd = 0
	for t in trades:
		running += flt(t.pnl or 0)
		cumulative.append({"date": str(t.trade_date), "value": round(running, 2)})
		if running > peak:
			peak = running
		dd = running - peak  # ≤ 0
		denom = peak if peak > 0 else abs(dd)
		dd_pct = (dd / denom * 100) if denom > 0 else 0
		drawdown_curve.append({"date": str(t.trade_date), "value": round(dd, 2)})
		if dd < max_dd:
			max_dd = dd
			max_dd_pct = dd_pct
		current_dd = dd

	# Setup breakdown with expectancy
	setup_map = {}
	for t in trades:
		s = t.setup_type or "Other"
		if s not in setup_map:
			setup_map[s] = {"total": 0, "wins": 0, "losses": 0, "pnl": 0, "win_pnls": [], "loss_pnls": []}
		setup_map[s]["total"] += 1
		pnl = flt(t.pnl or 0)
		setup_map[s]["pnl"] += pnl
		if t.status == "Win":
			setup_map[s]["wins"] += 1
			setup_map[s]["win_pnls"].append(pnl)
		elif t.status == "Loss":
			setup_map[s]["losses"] += 1
			setup_map[s]["loss_pnls"].append(pnl)

	setup_breakdown = []
	for s, v in setup_map.items():
		closed = v["wins"] + v["losses"]
		avg_win = (sum(v["win_pnls"]) / len(v["win_pnls"])) if v["win_pnls"] else 0
		avg_loss = (sum(v["loss_pnls"]) / len(v["loss_pnls"])) if v["loss_pnls"] else 0
		win_rate = (v["wins"] / closed) if closed else 0
		loss_rate = (v["losses"] / closed) if closed else 0
		expectancy = (win_rate * avg_win) + (loss_rate * avg_loss)  # avg_loss is negative
		setup_breakdown.append({
			"setup": s,
			"total": v["total"],
			"wins": v["wins"],
			"losses": v["losses"],
			"win_rate": round(win_rate * 100, 1),
			"avg_win": round(avg_win, 2),
			"avg_loss": round(avg_loss, 2),
			"expectancy": round(expectancy, 2),
			"pnl": round(v["pnl"], 2),
		})

	# Daily P&L
	day_map = {}
	for t in trades:
		d = str(t.trade_date)
		day_map[d] = day_map.get(d, 0) + flt(t.pnl or 0)
	daily_pnl = [{"date": d, "pnl": round(v, 2)} for d, v in sorted(day_map.items())]

	# R-multiple distribution — R = pnl / initial_risk_per_share * 1 (use |entry - stop_loss| * qty as risk $)
	r_multiples = []
	for t in trades:
		if t.status not in ("Win", "Loss", "Breakeven"):
			continue
		entry = flt(t.entry_price)
		sl = flt(t.stop_loss)
		qty = flt(t.quantity) or 1
		pnl = flt(t.pnl or 0)
		if not entry or not sl or entry == sl:
			continue
		risk_dollars = abs(entry - sl) * qty
		if risk_dollars <= 0:
			continue
		r = pnl / risk_dollars
		r_multiples.append({
			"name": t.name,
			"symbol": t.symbol,
			"r": round(r, 2),
			"pnl": pnl,
		})

	# R histogram buckets
	buckets = [
		("≤ -2R", -999, -2),
		("-2R to -1R", -2, -1),
		("-1R to 0", -1, 0),
		("0 to 1R", 0, 1),
		("1R to 2R", 1, 2),
		("2R to 3R", 2, 3),
		("≥ 3R", 3, 999),
	]
	r_histogram = []
	for label, lo, hi in buckets:
		count = sum(1 for m in r_multiples if lo < m["r"] <= hi) if label != "≤ -2R" else sum(1 for m in r_multiples if m["r"] <= hi)
		r_histogram.append({"bucket": label, "count": count})
	avg_r = round(sum(m["r"] for m in r_multiples) / len(r_multiples), 2) if r_multiples else 0

	# Day-of-week performance
	dow_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
	dow_map = {i: {"total": 0, "wins": 0, "pnl": 0} for i in range(7)}
	for t in trades:
		d = getdate(t.trade_date)
		idx = d.weekday()
		dow_map[idx]["total"] += 1
		if t.status == "Win":
			dow_map[idx]["wins"] += 1
		dow_map[idx]["pnl"] += flt(t.pnl or 0)
	dow_stats = [
		{
			"day": dow_names[i],
			"total": dow_map[i]["total"],
			"wins": dow_map[i]["wins"],
			"win_rate": round(dow_map[i]["wins"] / dow_map[i]["total"] * 100, 1) if dow_map[i]["total"] else 0,
			"pnl": round(dow_map[i]["pnl"], 2),
		}
		for i in range(7)
	]

	# Streaks
	current_streak_type = None
	current_streak = 0
	longest_win = 0
	longest_loss = 0
	temp = 0
	temp_type = None
	for t in trades:  # chronological
		if t.status == "Win":
			if temp_type == "W":
				temp += 1
			else:
				temp_type, temp = "W", 1
			longest_win = max(longest_win, temp)
		elif t.status == "Loss":
			if temp_type == "L":
				temp += 1
			else:
				temp_type, temp = "L", 1
			longest_loss = max(longest_loss, temp)
		else:
			continue
		current_streak_type, current_streak = temp_type, temp

	# Monthly calendar heatmap (all days in range, not just trade days)
	calendar_days = []
	if trades:
		start = getdate(from_date)
		end = getdate(to_date)
		d = start
		while d <= end:
			pnl = day_map.get(str(d), 0)
			calendar_days.append({
				"date": str(d),
				"dow": d.weekday(),
				"pnl": round(pnl, 2),
				"has_trade": str(d) in day_map,
			})
			d += timedelta(days=1)

	# Best / Worst trade — this week + this month
	today = getdate(nowdate())
	week_start = today - timedelta(days=today.weekday())
	month_start = today.replace(day=1)
	this_week_trades = [t for t in trades if getdate(t.trade_date) >= week_start]
	this_month_trades = [t for t in trades if getdate(t.trade_date) >= month_start]
	def mk_trade_card(t):
		if not t:
			return None
		return {
			"name": t.name,
			"symbol": t.symbol,
			"date": str(t.trade_date),
			"pnl": flt(t.pnl or 0),
			"rr": flt(t.risk_reward or 0),
			"setup": t.setup_type or "",
			"status": t.status,
		}
	# Best = most-profitable actual win; Worst = most-damaging actual loss.
	# If the period has no wins (or no losses), the opposite card stays empty
	# rather than reusing the single available trade.
	def _best(rows):
		wins = [t for t in rows if flt(t.pnl or 0) > 0]
		return max(wins, key=lambda x: flt(x.pnl or 0)) if wins else None
	def _worst(rows):
		losses = [t for t in rows if flt(t.pnl or 0) < 0]
		return min(losses, key=lambda x: flt(x.pnl or 0)) if losses else None
	best_week = _best(this_week_trades)
	worst_week = _worst(this_week_trades)
	best_month = _best(this_month_trades)
	worst_month = _worst(this_month_trades)

	# Avg R:R (closed trades only, and only valid r_multiples)
	avg_rr_all = round(sum(flt(t.risk_reward or 0) for t in trades) / total, 2) if total else 0

	# Profit factor: sum(wins) / |sum(losses)|
	gross_win = sum(flt(t.pnl or 0) for t in trades if t.status == "Win")
	gross_loss = sum(flt(t.pnl or 0) for t in trades if t.status == "Loss")
	profit_factor = round(gross_win / abs(gross_loss), 2) if gross_loss else (gross_win if gross_win else 0)

	# Mistake analytics (filtered date range)
	mistake_rows = frappe.db.sql(
		"""
		SELECT tm.mistake AS mistake, mt.category AS category, t.pnl AS pnl, t.status AS status
		FROM `tabTrade Mistake` tm
		JOIN `tabTrade` t ON t.name = tm.parent
		LEFT JOIN `tabMistake Tag` mt ON mt.name = tm.mistake
		WHERE t.sell_date IS NOT NULL
		  AND t.sell_date BETWEEN %(from_date)s AND %(to_date)s
		""",
		{"from_date": from_date, "to_date": to_date},
		as_dict=True,
	)
	mistake_map = defaultdict(lambda: {"count": 0, "pnl": 0, "losses": 0, "category": ""})
	for row in mistake_rows:
		key = row.mistake
		mistake_map[key]["count"] += 1
		mistake_map[key]["pnl"] += flt(row.pnl or 0)
		mistake_map[key]["category"] = row.category or "Other"
		if row.status == "Loss":
			mistake_map[key]["losses"] += 1
	mistakes_breakdown = sorted([
		{"mistake": k, "category": v["category"], "count": v["count"],
		 "losses": v["losses"], "pnl": round(v["pnl"], 2)}
		for k, v in mistake_map.items()
	], key=lambda x: x["pnl"])  # most damaging first (most negative)

	return {
		"summary": {
			"total_trades": total,
			"wins": len(wins),
			"losses": len(losses),
			"win_rate": round(len(wins) / total * 100, 1) if total else 0,
			"total_pnl": total_pnl,
			"avg_rr": avg_rr_all,
			"avg_r": avg_r,
			"best_trade": max((p for p in pnl_list if p > 0), default=0),
			"worst_trade": min((p for p in pnl_list if p < 0), default=0),
			"max_drawdown": round(max_dd, 2),
			"max_drawdown_pct": round(max_dd_pct, 2),
			"current_drawdown": round(current_dd, 2),
			"longest_win_streak": longest_win,
			"longest_loss_streak": longest_loss,
			"current_streak_type": current_streak_type,
			"current_streak": current_streak,
			"profit_factor": profit_factor,
		},
		"equity_curve": cumulative,
		"drawdown_curve": drawdown_curve,
		"daily_pnl": daily_pnl,
		"setup_breakdown": setup_breakdown,
		"r_histogram": r_histogram,
		"r_multiples": r_multiples,
		"dow_stats": dow_stats,
		"calendar": calendar_days,
		"best_week": mk_trade_card(best_week),
		"worst_week": mk_trade_card(worst_week),
		"best_month": mk_trade_card(best_month),
		"worst_month": mk_trade_card(worst_month),
		"mistakes_breakdown": mistakes_breakdown,
		"brokers": brokers,
		"selected_broker": broker or "",
		"recent_trades": [
			{
				"name": t.name,
				"date": str(t.trade_date),
				"symbol": t.symbol,
				"type": t.trade_type,
				"status": t.status,
				"entry": flt(t.entry_price),
				"sl": flt(t.stop_loss),
				"target": flt(t.target),
				"exit": flt(t.exit_price),
				"pnl": flt(t.pnl or 0),
				"rr": flt(t.risk_reward or 0),
			}
			for t in sorted(trades, key=lambda x: x.trade_date, reverse=True)[:10]
		],
	}
