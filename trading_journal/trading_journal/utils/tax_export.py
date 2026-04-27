"""Tax export for Indian traders.

Classifies each closed trade into:
  - Intraday (buy/sell same day) — speculative business income
  - STCG (held < 1 year) — short-term capital gains
  - LTCG (held >= 1 year) — long-term capital gains

For intraday we can't derive from a single Trade row without entry/exit
dates (we only have trade_date). So:
  - If entry_time and exit_time both set → intraday
  - Else: use trade_date as both buy and sell date → intraday by default
    (acknowledging the Trade doctype models complete trades, not open positions)

Users with multi-day swings should record hold duration in Notes for now,
or the schema can be extended with entry_date/exit_date later.
"""

import csv
import io
from collections import defaultdict

import frappe
from frappe.utils import flt, getdate, cint


@frappe.whitelist()
def get_tax_data(fy_start=None, fy_end=None):
	"""Return tax buckets for the given financial year range."""
	if not fy_start:
		# Default to current Indian FY (Apr 1 → Mar 31)
		today = getdate()
		if today.month >= 4:
			fy_start = f"{today.year}-04-01"
			fy_end = f"{today.year + 1}-03-31"
		else:
			fy_start = f"{today.year - 1}-04-01"
			fy_end = f"{today.year}-03-31"

	trades = frappe.db.sql(
		"""
		SELECT name, trade_date, symbol, trade_type, entry_price, exit_price,
		       quantity, pnl, exchange, status
		FROM `tabTrade`
		WHERE trade_date BETWEEN %(f)s AND %(t)s
		  AND status IN ('Win', 'Loss', 'Breakeven')
		  AND exit_price IS NOT NULL
		ORDER BY trade_date ASC
		""",
		{"f": fy_start, "t": fy_end},
		as_dict=True,
	)

	# Without entry/exit date fields on Trade, treat every closed trade
	# as intraday unless the symbol appears rarely (heuristic is unreliable).
	# Future: add `entry_date` + `exit_date` fields for accurate bucketing.
	buckets = {"intraday": [], "stcg": [], "ltcg": []}
	for t in trades:
		bucket = "intraday"  # safe default for journal-entered trades
		buckets[bucket].append({
			"date": str(t.trade_date),
			"symbol": t.symbol,
			"exchange": t.exchange or "",
			"type": t.trade_type,
			"qty": flt(t.quantity),
			"buy_price": flt(t.entry_price if t.trade_type == "Long" else t.exit_price),
			"sell_price": flt(t.exit_price if t.trade_type == "Long" else t.entry_price),
			"turnover": flt(t.quantity) * (flt(t.entry_price) + flt(t.exit_price)),
			"pnl": flt(t.pnl or 0),
		})

	def summarize(rows):
		turnover = sum(r["turnover"] for r in rows)
		gain = sum(r["pnl"] for r in rows if r["pnl"] > 0)
		loss = sum(r["pnl"] for r in rows if r["pnl"] < 0)
		return {
			"count": len(rows),
			"turnover": round(turnover, 2),
			"gross_profit": round(gain, 2),
			"gross_loss": round(loss, 2),
			"net_pnl": round(gain + loss, 2),
		}

	return {
		"fy_start": fy_start,
		"fy_end": fy_end,
		"intraday": {"rows": buckets["intraday"], "summary": summarize(buckets["intraday"])},
		"stcg": {"rows": buckets["stcg"], "summary": summarize(buckets["stcg"])},
		"ltcg": {"rows": buckets["ltcg"], "summary": summarize(buckets["ltcg"])},
	}


@frappe.whitelist()
def download_csv(fy_start=None, fy_end=None, category="intraday"):
	"""Return CSV text for a given bucket."""
	data = get_tax_data(fy_start, fy_end)
	bucket = data.get(category, {"rows": []})
	rows = bucket["rows"]

	buf = io.StringIO()
	writer = csv.writer(buf)
	writer.writerow(["Date", "Symbol", "Exchange", "Type", "Qty", "Buy Price", "Sell Price", "Turnover", "P&L"])
	for r in rows:
		writer.writerow([
			r["date"], r["symbol"], r["exchange"], r["type"],
			r["qty"], r["buy_price"], r["sell_price"], r["turnover"], r["pnl"],
		])
	# Summary footer
	s = bucket["summary"]
	writer.writerow([])
	writer.writerow(["Trades", s["count"]])
	writer.writerow(["Turnover", s["turnover"]])
	writer.writerow(["Gross Profit", s["gross_profit"]])
	writer.writerow(["Gross Loss", s["gross_loss"]])
	writer.writerow(["Net P&L", s["net_pnl"]])

	frappe.response.filename = f"tax_{category}_{data['fy_start']}_to_{data['fy_end']}.csv"
	frappe.response.filecontent = buf.getvalue()
	frappe.response.type = "binary"
