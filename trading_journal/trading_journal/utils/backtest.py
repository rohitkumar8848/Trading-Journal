"""Backtest the 3 screeners over recent history — now snapshot-backed.

For each test date in the lookback window, we:
  - Load every symbol's daily closes UP TO that date from Stock Daily Snapshot
  - Re-compute SMAs / 52w / RS as of that date (one in-memory pass per date)
  - Apply each scan_type's filter
  - Measure forward 30d / 90d returns from the same snapshot table

No Yahoo calls — entire backtest reads a single SQL query upfront and
computes in-memory.  ~3 sec for 12 months × 100 symbols.
"""

import json
import time
from datetime import date, datetime, timedelta

import frappe
from frappe.utils import flt, getdate, now_datetime

from trading_journal.trading_journal.utils import screener as screener_mod

CACHE_KEY_PREFIX = "tj:backtest:"


def _percentile_ranks(values: list) -> list:
	indexed = [(i, v) for i, v in enumerate(values) if v is not None]
	if not indexed:
		return [None] * len(values)
	indexed.sort(key=lambda t: t[1])
	n = len(indexed)
	out = [None] * len(values)
	for rank, (orig_i, _) in enumerate(indexed):
		out[orig_i] = round((rank / (n - 1) * 99) if n > 1 else 99, 1)
	return out


def _sma(values, period, offset=0):
	end = len(values) - offset
	start = end - period
	if start < 0 or end <= 0:
		return None
	return sum(values[start:end]) / period


def _eval_at_date(scan_type: str, sym: str, closes_up_to_d: list, highs: list, lows: list, vols: list, rs: float) -> bool:
	"""Apply one scan_type's rules to closes ending at the target date."""
	if not closes_up_to_d:
		return False
	last = closes_up_to_d[-1]
	sma50 = _sma(closes_up_to_d, 50)
	sma150 = _sma(closes_up_to_d, 150)
	sma200 = _sma(closes_up_to_d, 200)
	sma200_22 = _sma(closes_up_to_d, 200, offset=22)
	# 52w
	if len(closes_up_to_d) >= 252:
		win_h = highs[-252:]
		win_l = lows[-252:]
	else:
		win_h, win_l = highs, lows
	hi52 = max(win_h) if win_h else 0
	lo52 = min(win_l) if win_l else 0
	pct_from_high = (last - hi52) / hi52 * 100 if hi52 else 0
	pct_above_low = (last - lo52) / lo52 * 100 if lo52 else 0

	if scan_type == "Trend Template":
		passed = sum([
			bool(sma150 and sma200 and last > sma150 and last > sma200),
			bool(sma150 and sma200 and sma150 > sma200),
			bool(sma200 and sma200_22 and sma200 > sma200_22),
			bool(sma50 and sma150 and sma200 and sma50 > sma150 > sma200),
			bool(sma50 and last > sma50),
			bool(pct_above_low >= 30),
			bool(pct_from_high >= -25),
			bool(rs is not None and rs >= 70),
		])
		return passed >= 7

	if scan_type == "Turnaround":
		# Beaten-down laggard reversing into a Stage 2 uptrend.
		if len(closes_up_to_d) < 252:
			return False
		sma200_44 = _sma(closes_up_to_d, 200, offset=44)
		ret_3m = (last / closes_up_to_d[-64] - 1) * 100 if closes_up_to_d[-64] else None
		ret_12m = (last / closes_up_to_d[-253] - 1) * 100 if closes_up_to_d[-253] else None
		if ret_3m is None or ret_12m is None:
			return False
		return (
			pct_from_high <= -25
			and pct_above_low >= 20
			and bool(sma200 and sma50 and last > sma200 and last > sma50)
			and bool(sma200 and sma200_44 and sma200 >= sma200_44)
			and ret_12m < 25
			and ret_3m >= 10
			and rs is not None and rs >= 45
		)

	if scan_type == "VCP":
		# Use the same swing-pivot detector — pass a candle-shaped list
		candles = []
		for i in range(len(closes_up_to_d)):
			candles.append({"o": closes_up_to_d[i], "h": highs[i], "l": lows[i], "c": closes_up_to_d[i], "v": vols[i] if i < len(vols) else 0, "t": 0})
		ind = {"price": last}
		v = screener_mod.detect_vcp(candles, ind)
		return bool(v.get("is_vcp"))

	return False


def _forward_return(prices_by_date: dict, sym: str, target_dt: date, days: int) -> float:
	"""Find the close on/closest-after target_dt and on/closest-before target_dt + days.

	`prices_by_date` is a dict {sym: [(date, close), ...]} sorted.
	"""
	series = prices_by_date.get(sym)
	if not series:
		return None
	# entry: first bar at/after target_dt
	entry = None
	for d, c in series:
		if d >= target_dt:
			entry = c
			break
	if entry is None or not entry:
		return None
	exit_dt = target_dt + timedelta(days=days)
	exit_c = None
	for d, c in series:
		if d > exit_dt:
			break
		exit_c = c
	if exit_c is None or not exit_c:
		return None
	return round((exit_c / entry - 1) * 100, 2)


@frappe.whitelist()
def run_backtest(months: int = 12, sample_size: int = 100, force: int = 0) -> dict:
	"""Replay all 3 screeners on monthly snapshots over the last N months."""
	import random

	cache = frappe.cache()
	cache_key = f"{CACHE_KEY_PREFIX}{int(months)}m_{int(sample_size)}n"
	if not int(force or 0):
		cached = cache.get_value(cache_key)
		if cached:
			try:
				return json.loads(cached)
			except Exception:
				pass

	# Universe
	universe = screener_mod.get_nifty500_symbols()
	random.seed(42)
	if sample_size and sample_size < len(universe):
		universe = random.sample(universe, int(sample_size))
	syms = [u["symbol"] for u in universe]

	# Pull all closes/highs/lows for these symbols from Stock Daily Snapshot
	# (one query, ~500 symbols × 700 trading days = ~350k rows)
	from datetime import date as _date
	earliest = _date.today() - timedelta(days=int(months) * 31 + 380)
	if not syms:
		return {"ok": False, "error": "Empty universe"}

	rows = []
	for i in range(0, len(syms), 200):
		batch = syms[i:i + 200]
		placeholders = ", ".join(["%s"] * len(batch))
		rows.extend(frappe.db.sql(
			f"""
			SELECT symbol, date, close_price, high_price, low_price, volume
			FROM `tabStock Daily Snapshot`
			WHERE symbol IN ({placeholders}) AND date >= %s
			ORDER BY symbol, date
			""",
			batch + [earliest.isoformat()],
			as_dict=True,
		))
	if not rows:
		return {"ok": False, "error": "No snapshot data. Run Refresh Snapshot first.", "per_scan": None}

	# Group history by symbol
	hist_by_sym = {}
	for r in rows:
		hist_by_sym.setdefault(r["symbol"], []).append({
			"date": getdate(r["date"]),
			"c": flt(r["close_price"]),
			"h": flt(r["high_price"]),
			"l": flt(r["low_price"]),
			"v": int(r["volume"] or 0),
		})

	# Build forward-price lookup
	prices_by_date = {sym: [(b["date"], b["c"]) for b in hist] for sym, hist in hist_by_sym.items()}

	# Build N monthly test dates going back
	today = _date.today()
	test_dates = [today - timedelta(days=30 * i) for i in range(1, int(months) + 1)]
	test_dates = [d for d in test_dates if (today - d).days >= 95]

	per_scan = {st: {
		"total_hits": 0, "hit_dates": 0,
		"forward_30d": [], "forward_90d": [],
	} for st in ("Trend Template", "VCP", "Turnaround")}
	timeline = []

	for d_dt in test_dates:
		# Slice every symbol's history to <= d_dt
		sliced_by_sym = {}
		for sym, hist in hist_by_sym.items():
			s = [b for b in hist if b["date"] <= d_dt]
			if len(s) >= 252:
				sliced_by_sym[sym] = s
		if not sliced_by_sym:
			continue

		# Compute RS rank as of d_dt
		rs_scores = []
		sym_order = []
		for sym, s in sliced_by_sym.items():
			closes = [b["c"] for b in s]
			last = closes[-1]
			def _ret(days):
				if len(closes) <= days:
					return None
				past = closes[-days - 1]
				if not past:
					return None
				return last / past - 1
			r3, r6, r9, r12 = _ret(63), _ret(126), _ret(189), _ret(252)
			score = (2 * r3 + r6 + r9 + r12) if all(x is not None for x in (r3, r6, r9, r12)) else None
			rs_scores.append(score)
			sym_order.append(sym)
		rs_ranks = _percentile_ranks(rs_scores)
		rs_by_sym = dict(zip(sym_order, rs_ranks))

		date_summary = {"date": d_dt.isoformat(), "scans": {}}
		for st in per_scan.keys():
			hits = []
			for sym, s in sliced_by_sym.items():
				closes = [b["c"] for b in s]
				highs = [b["h"] for b in s]
				lows = [b["l"] for b in s]
				vols = [b["v"] for b in s]
				rs = rs_by_sym.get(sym)
				if _eval_at_date(st, sym, closes, highs, lows, vols, rs):
					r30 = _forward_return(prices_by_date, sym, d_dt, 30)
					r90 = _forward_return(prices_by_date, sym, d_dt, 90)
					hits.append({"symbol": sym, "ret_30d": r30, "ret_90d": r90})
					per_scan[st]["total_hits"] += 1
					if r30 is not None:
						per_scan[st]["forward_30d"].append(r30)
					if r90 is not None:
						per_scan[st]["forward_90d"].append(r90)
			if hits:
				per_scan[st]["hit_dates"] += 1
			date_summary["scans"][st] = {"hits": len(hits), "top_3": hits[:3]}
		timeline.append(date_summary)

	# Aggregates
	for st, s in per_scan.items():
		r30, r90 = s["forward_30d"], s["forward_90d"]
		s["avg_30d"] = round(sum(r30) / len(r30), 2) if r30 else 0
		s["win_rate_30d"] = round(sum(1 for x in r30 if x > 0) / len(r30) * 100, 1) if r30 else 0
		s["max_30d"] = round(max(r30), 2) if r30 else None
		s["min_30d"] = round(min(r30), 2) if r30 else None
		s["avg_90d"] = round(sum(r90) / len(r90), 2) if r90 else 0
		s["win_rate_90d"] = round(sum(1 for x in r90 if x > 0) / len(r90) * 100, 1) if r90 else 0
		s["max_90d"] = round(max(r90), 2) if r90 else None
		s["min_90d"] = round(min(r90), 2) if r90 else None
		del s["forward_30d"]
		del s["forward_90d"]

	out = {
		"ok": True,
		"as_of": now_datetime().isoformat(),
		"months": int(months),
		"sample_size": len(universe),
		"test_dates": [d.isoformat() for d in test_dates],
		"per_scan": per_scan,
		"timeline": timeline,
	}
	cache.set_value(cache_key, json.dumps(out), expires_in_sec=12 * 3600)
	return out


@frappe.whitelist()
def get_cached_backtest(months: int = 12, sample_size: int = 100) -> dict:
	cache = frappe.cache()
	key = f"{CACHE_KEY_PREFIX}{int(months)}m_{int(sample_size)}n"
	cached = cache.get_value(key)
	if cached:
		try:
			return json.loads(cached)
		except Exception:
			pass
	return {"ok": True, "per_scan": None}
