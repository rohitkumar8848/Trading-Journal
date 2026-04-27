import frappe
from frappe.utils import flt, getdate, nowdate, add_days
from datetime import timedelta, date as _date
from collections import defaultdict


@frappe.whitelist()
def save_review_pdf(period, start, end):
	"""Generate PDF of the current review and attach to Trade Review Entry.

	Filename: Trade-Review-{Week|Month}-{start}-to-{end}.pdf
	"""
	try:
		from frappe.utils.pdf import get_pdf

		period_type = "Week" if period == "week" else "Month"
		entry_name = f"{period_type}-{start}"

		# Ensure a Trade Review Entry exists for this period
		if frappe.db.exists("Trade Review Entry", entry_name):
			entry = frappe.get_doc("Trade Review Entry", entry_name)
		else:
			entry = frappe.get_doc({
				"doctype": "Trade Review Entry",
				"period_type": period_type,
				"period_start": start,
				"period_end": end,
			}).insert(ignore_permissions=True)

		data = get_review(period=period, anchor=start)
		html = _render_review_html(data, entry)
		pdf_bytes = get_pdf(html, options={"page-size": "A4", "margin-top": "12mm",
		                                   "margin-bottom": "12mm",
		                                   "margin-left": "12mm", "margin-right": "12mm"})

		file_name = f"Trade-Review-{period_type}-{start}-to-{end}.pdf"

		# Delete previous file(s) with same name attached to this entry
		existing = frappe.get_all("File", filters={
			"attached_to_doctype": "Trade Review Entry",
			"attached_to_name": entry.name,
			"file_name": file_name,
		}, pluck="name")
		for n in existing:
			frappe.delete_doc("File", n, force=True, ignore_permissions=True)

		file_doc = frappe.get_doc({
			"doctype": "File",
			"file_name": file_name,
			"attached_to_doctype": "Trade Review Entry",
			"attached_to_name": entry.name,
			"content": pdf_bytes,
			"is_private": 1,
		})
		file_doc.insert(ignore_permissions=True)
		frappe.db.commit()

		return {
			"ok": True,
			"file_url": file_doc.file_url,
			"file_name": file_name,
			"entry_name": entry.name,
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Save Review PDF")
		return {"ok": False, "error": str(e)}


def _render_review_html(data: dict, entry) -> str:
	"""Build a self-contained HTML document for PDF rendering."""
	from frappe.utils import fmt_money

	def money(v):
		try:
			return fmt_money(v, currency="INR")
		except Exception:
			return f"₹{v:,.2f}"

	stats = data.get("stats", {}) or {}
	prev = data.get("prev_stats", {}) or {}
	setups = data.get("setups", []) or []
	mistakes = data.get("mistakes", []) or []
	best = data.get("best") or {}
	worst = data.get("worst") or {}
	trades = data.get("trades", []) or []

	period_label = "Weekly Review" if data.get("period") == "week" else "Monthly Review"

	def pn_color(v):
		return "#10b981" if (v or 0) >= 0 else "#f43f5e"

	# KPI grid
	kpis = [
		("Net P&L", money(stats.get("pnl", 0)), pn_color(stats.get("pnl", 0))),
		("Trades", stats.get("total", 0), "#0f172a"),
		("Win Rate", f"{stats.get('win_rate', 0)}%", pn_color(stats.get("win_rate", 0) - 50 + 0.01)),
		("Profit Factor", f"{stats.get('profit_factor', 0)}x", "#0f172a"),
		("Avg R", f"{stats.get('avg_r', 0)}R", pn_color(stats.get("avg_r", 0))),
		("Best", money(stats.get("best", 0)), "#10b981"),
		("Worst", money(stats.get("worst", 0)), "#f43f5e"),
	]
	kpis_html = "".join(
		f"<div class='kpi'><div class='kpi-label'>{lbl}</div>"
		f"<div class='kpi-value' style='color:{col}'>{val}</div></div>"
		for lbl, val, col in kpis
	)

	# Setups table
	if setups:
		setup_rows = "".join(
			f"<tr><td><b>{s['setup']}</b></td><td>{s['total']}</td><td>{s['wins']}</td>"
			f"<td>{s['win_rate']}%</td>"
			f"<td style='color:{pn_color(s['pnl'])};font-weight:700'>{money(s['pnl'])}</td></tr>"
			for s in setups
		)
	else:
		setup_rows = "<tr><td colspan='5' class='muted'>No setups logged</td></tr>"

	# Mistakes
	if mistakes:
		mistake_rows = "".join(
			f"<tr><td><b>{m['mistake']}</b></td><td>{m['count']}×</td>"
			f"<td style='color:{pn_color(m['pnl'])};font-weight:700'>{money(m['pnl'])}</td></tr>"
			for m in mistakes
		)
	else:
		mistake_rows = "<tr><td colspan='3' class='muted'>No mistakes tagged</td></tr>"

	# Best / Worst
	def highlight_card(t, kind):
		if not t:
			return f"<div class='hl hl-{kind}'><div class='muted'>No trades</div></div>"
		c = "#10b981" if kind == "best" else "#f43f5e"
		return (
			f"<div class='hl hl-{kind}'>"
			f"<div class='hl-label'>{'Best Trade' if kind == 'best' else 'Worst Trade'}</div>"
			f"<div class='hl-pnl' style='color:{c}'>{money(t.get('pnl', 0))}</div>"
			f"<div><b>{t.get('symbol', '')}</b> · {t.get('date', '')}</div>"
			f"<div class='muted'>{t.get('setup', '') or ''}"
			f"{' · R ' + str(t.get('r_multiple', 0)) if t.get('r_multiple') else ''}</div>"
			f"</div>"
		)

	# Trade log
	if trades:
		log_rows = "".join(
			f"<tr><td>{t['date']}</td><td><b>{t['symbol']}</b></td>"
			f"<td>{t['type']}</td><td>{t.get('setup', '')}</td>"
			f"<td>{t['status']}</td>"
			f"<td>{t['entry']}</td><td>{t['exit']}</td>"
			f"<td>{round(t.get('rr', 0), 2)}x</td>"
			f"<td>{round(t.get('r_multiple', 0), 2)}R</td>"
			f"<td>{t.get('grade', '') or '-'}</td>"
			f"<td style='color:{pn_color(t['pnl'])};font-weight:700'>{money(t['pnl'])}</td></tr>"
			for t in trades
		)
	else:
		log_rows = "<tr><td colspan='11' class='muted'>No trades</td></tr>"

	went_right = (entry.went_right or "").replace("\n", "<br>")
	went_wrong = (entry.went_wrong or "").replace("\n", "<br>")
	improvement = (entry.improvement or "").replace("\n", "<br>")

	return f"""
<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body {{ font-family: Inter, Arial, sans-serif; color:#0f172a; font-size:12px; margin:0; padding:0; }}
  .hero {{ text-align:center; padding:14px 0 20px; border-bottom:2px solid #eef1f7; margin-bottom:18px; }}
  .kicker {{ font-size:10px; color:#6366f1; font-weight:800; letter-spacing:2px; }}
  h1 {{ font-size:28px; font-weight:800; color:#6366f1; margin:4px 0 4px; letter-spacing:-.5px; }}
  .range {{ color:#64748b; font-size:12px; font-weight:600; }}

  h2 {{ font-size:13px; text-transform:uppercase; letter-spacing:.6px; color:#0f172a; margin:22px 0 10px; padding-bottom:6px; border-bottom:2px solid #eef1f7; }}

  .kpi-grid {{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px; }}
  .kpi {{ flex:1 1 120px; background:#f8f9fd; border:1px solid #e6e8f0; border-radius:8px; padding:10px 12px; }}
  .kpi-label {{ font-size:9px; color:#64748b; text-transform:uppercase; letter-spacing:.4px; font-weight:700; }}
  .kpi-value {{ font-size:18px; font-weight:800; margin-top:3px; }}

  table {{ width:100%; border-collapse:collapse; font-size:11px; margin-bottom:10px; }}
  th {{ background:#f1f2f8; padding:8px; text-align:left; font-size:9px; text-transform:uppercase; letter-spacing:.4px; color:#64748b; font-weight:700; border-bottom:1px solid #e6e8f0; }}
  td {{ padding:7px 8px; border-bottom:1px solid #f0f1f7; }}
  .muted {{ color:#94a3b8; font-style:italic; text-align:center; }}

  .hl-row {{ display:flex; gap:10px; margin-bottom:10px; }}
  .hl {{ flex:1; padding:12px 14px; border-radius:10px; border:1px solid #e6e8f0; }}
  .hl-best {{ background:#ecfdf5; border-color:#a7f3d0; }}
  .hl-worst {{ background:#fef2f2; border-color:#fecdd3; }}
  .hl-label {{ font-size:9px; text-transform:uppercase; letter-spacing:.5px; color:#64748b; font-weight:700; }}
  .hl-pnl {{ font-size:20px; font-weight:800; margin:3px 0; }}

  .reflect-block {{ margin-bottom:14px; page-break-inside:avoid; }}
  .reflect-label {{ font-weight:700; font-size:12px; margin-bottom:4px; }}
  .reflect-body {{ background:#fafbfe; border:1px solid #e6e8f0; border-radius:6px; padding:10px 12px; min-height:30px; white-space:pre-wrap; }}
  .reflect-body.empty {{ color:#94a3b8; font-style:italic; }}

  .footer {{ margin-top:20px; text-align:center; font-size:9px; color:#94a3b8; }}
</style></head>
<body>

<div class="hero">
  <div class="kicker">{period_label.upper()}</div>
  <h1>Trading Review</h1>
  <div class="range">{data.get("start", "")} → {data.get("end", "")}</div>
</div>

<h2>Summary</h2>
<div class="kpi-grid">{kpis_html}</div>

<h2>vs Previous Period</h2>
<table>
  <tr><th></th><th>This Period</th><th>Previous</th></tr>
  <tr><td><b>P&L</b></td><td>{money(stats.get('pnl', 0))}</td><td>{money(prev.get('pnl', 0))}</td></tr>
  <tr><td><b>Win Rate</b></td><td>{stats.get('win_rate', 0)}%</td><td>{prev.get('win_rate', 0)}%</td></tr>
  <tr><td><b>Trades</b></td><td>{stats.get('total', 0)}</td><td>{prev.get('total', 0)}</td></tr>
</table>

<h2>Setup Performance</h2>
<table>
  <thead><tr><th>Setup</th><th>Trades</th><th>Wins</th><th>Win%</th><th>P&L</th></tr></thead>
  <tbody>{setup_rows}</tbody>
</table>

<h2>Mistake Leaks</h2>
<table>
  <thead><tr><th>Mistake</th><th>Occurrences</th><th>Total P&L Impact</th></tr></thead>
  <tbody>{mistake_rows}</tbody>
</table>

<h2>Highlights</h2>
<div class="hl-row">
  {highlight_card(best, "best")}
  {highlight_card(worst, "worst")}
</div>

<h2>Trade Log</h2>
<table>
  <thead><tr>
    <th>Date</th><th>Symbol</th><th>Type</th><th>Setup</th><th>Status</th>
    <th>Entry</th><th>Exit</th><th>R:R</th><th>R</th><th>Grade</th><th>P&L</th>
  </tr></thead>
  <tbody>{log_rows}</tbody>
</table>

<h2>Reflection</h2>
<div class="reflect-block">
  <div class="reflect-label">What went right?</div>
  <div class="reflect-body {'' if went_right else 'empty'}">{went_right or 'Not filled in'}</div>
</div>
<div class="reflect-block">
  <div class="reflect-label">What went wrong?</div>
  <div class="reflect-body {'' if went_wrong else 'empty'}">{went_wrong or 'Not filled in'}</div>
</div>
<div class="reflect-block">
  <div class="reflect-label">One thing to improve next period</div>
  <div class="reflect-body {'' if improvement else 'empty'}">{improvement or 'Not filled in'}</div>
</div>

<div class="footer">Generated {frappe.utils.now_datetime().strftime('%d %b %Y, %I:%M %p')} · Trading Journal</div>

</body></html>
"""


@frappe.whitelist()
def save_reflection(period, start, end, went_right="", went_wrong="", improvement=""):
	"""Upsert a Trade Review Entry for the given period/start."""
	period_type = "Week" if period == "week" else "Month"
	name = f"{period_type}-{start}"
	if frappe.db.exists("Trade Review Entry", name):
		doc = frappe.get_doc("Trade Review Entry", name)
	else:
		doc = frappe.get_doc({
			"doctype": "Trade Review Entry",
			"period_type": period_type,
			"period_start": start,
			"period_end": end,
		})
	doc.went_right = went_right or ""
	doc.went_wrong = went_wrong or ""
	doc.improvement = improvement or ""
	doc.period_end = end
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"ok": True, "name": doc.name}


@frappe.whitelist()
def get_review(period="week", anchor=None):
	"""Return review data for the current (or given) week/month."""
	anchor_d = getdate(anchor) if anchor else getdate(nowdate())
	if period == "month":
		start = anchor_d.replace(day=1)
		# last day of month
		if start.month == 12:
			end = _date(start.year + 1, 1, 1) - timedelta(days=1)
		else:
			end = _date(start.year, start.month + 1, 1) - timedelta(days=1)
	else:  # week
		start = anchor_d - timedelta(days=anchor_d.weekday())  # Monday
		end = start + timedelta(days=6)

	# Previous period for comparison
	period_days = (end - start).days + 1
	prev_end = start - timedelta(days=1)
	prev_start = prev_end - timedelta(days=period_days - 1)

	def fetch(f, t):
		# Review is keyed on sell_date (profit realization date).
		return frappe.db.sql(
			"""
			SELECT name, sell_date AS trade_date, symbol, trade_type, status, setup_type,
			       entry_price, stop_loss, target, exit_price, pnl, risk_reward,
			       r_multiple, trade_grade
			FROM `tabTrade`
			WHERE sell_date IS NOT NULL
			  AND sell_date BETWEEN %s AND %s
			ORDER BY sell_date ASC, name ASC
			""",
			(f, t),
			as_dict=True,
		)

	trades = fetch(start, end)
	prev_trades = fetch(prev_start, prev_end)

	def stats(rows):
		wins = [r for r in rows if r.status == "Win"]
		losses = [r for r in rows if r.status == "Loss"]
		pnl = sum(flt(r.pnl or 0) for r in rows)
		closed = len(wins) + len(losses)
		gross_win = sum(flt(r.pnl or 0) for r in wins)
		gross_loss = sum(flt(r.pnl or 0) for r in losses)
		return {
			"total": len(rows),
			"wins": len(wins),
			"losses": len(losses),
			"win_rate": round(len(wins) / closed * 100, 1) if closed else 0,
			"pnl": round(pnl, 2),
			"gross_win": round(gross_win, 2),
			"gross_loss": round(gross_loss, 2),
			"profit_factor": round(gross_win / abs(gross_loss), 2) if gross_loss else 0,
			"avg_r": round(sum(flt(r.r_multiple or 0) for r in rows) / len(rows), 2) if rows else 0,
			"best": max((flt(r.pnl or 0) for r in rows), default=0),
			"worst": min((flt(r.pnl or 0) for r in rows), default=0),
		}

	# Setup breakdown
	setup_map = defaultdict(lambda: {"total": 0, "wins": 0, "pnl": 0})
	for r in trades:
		s = r.setup_type or "Other"
		setup_map[s]["total"] += 1
		if r.status == "Win":
			setup_map[s]["wins"] += 1
		setup_map[s]["pnl"] += flt(r.pnl or 0)
	setups = sorted([
		{
			"setup": k,
			"total": v["total"],
			"wins": v["wins"],
			"win_rate": round(v["wins"] / v["total"] * 100, 1) if v["total"] else 0,
			"pnl": round(v["pnl"], 2),
		}
		for k, v in setup_map.items()
	], key=lambda x: -x["pnl"])

	# Mistakes in period
	mistake_rows = frappe.db.sql(
		"""
		SELECT tm.mistake AS mistake, COUNT(*) AS cnt, COALESCE(SUM(t.pnl), 0) AS pnl
		FROM `tabTrade Mistake` tm
		JOIN `tabTrade` t ON t.name = tm.parent
		WHERE t.sell_date IS NOT NULL
		  AND t.sell_date BETWEEN %s AND %s
		GROUP BY tm.mistake
		ORDER BY pnl ASC
		""",
		(start, end),
		as_dict=True,
	)

	# Best / worst trade in period
	def serialize(t):
		if not t:
			return None
		return {
			"name": t.name, "symbol": t.symbol, "date": str(t.trade_date),
			"pnl": flt(t.pnl or 0), "rr": flt(t.risk_reward or 0),
			"setup": t.setup_type or "", "status": t.status,
			"r_multiple": flt(t.r_multiple or 0),
		}

	best = max(trades, key=lambda x: flt(x.pnl or 0)) if trades else None
	worst = min(trades, key=lambda x: flt(x.pnl or 0)) if trades else None

	# Load existing reflection (if any) for this period
	period_type = "Week" if period == "week" else "Month"
	entry_name = f"{period_type}-{start}"
	reflection = {"went_right": "", "went_wrong": "", "improvement": ""}
	if frappe.db.exists("Trade Review Entry", entry_name):
		rec = frappe.get_doc("Trade Review Entry", entry_name)
		reflection = {
			"went_right": rec.went_right or "",
			"went_wrong": rec.went_wrong or "",
			"improvement": rec.improvement or "",
		}

	return {
		"period": period,
		"start": str(start),
		"end": str(end),
		"stats": stats(trades),
		"prev_stats": stats(prev_trades),
		"setups": setups,
		"mistakes": [
			{"mistake": m.mistake, "count": m.cnt, "pnl": round(flt(m.pnl), 2)}
			for m in mistake_rows
		],
		"best": serialize(best),
		"worst": serialize(worst),
		"reflection": reflection,
		"trades": [
			{
				"name": t.name, "date": str(t.trade_date), "symbol": t.symbol,
				"type": t.trade_type, "status": t.status, "setup": t.setup_type or "",
				"entry": flt(t.entry_price), "sl": flt(t.stop_loss),
				"target": flt(t.target), "exit": flt(t.exit_price),
				"pnl": flt(t.pnl or 0), "rr": flt(t.risk_reward or 0),
				"r_multiple": flt(t.r_multiple or 0),
				"grade": t.trade_grade or "",
			}
			for t in trades
		],
	}
