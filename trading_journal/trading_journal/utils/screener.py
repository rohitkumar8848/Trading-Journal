"""Mark Minervini momentum screener + VCP scan for Nifty 500.

Two scans (separate, run independently):
  - Trend Template — Minervini's 8-rule filter + RS Rating ≥ 70
  - VCP            — base count + tightening contractions on the most recent base

Long runs (~5-10 min for Nifty 500) — the @frappe.whitelist entry points
queue the work as a background job and return immediately.
"""

import csv
import io
import json
import math
import statistics
import time
from datetime import datetime, timedelta
from io import StringIO

import frappe
import requests
from frappe.utils import flt, now_datetime

YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
# niftyindices.com is the canonical source but is sometimes slow / blocks scraping.
# We try a primary URL, then a mirror, then a bundled snapshot.
NIFTY500_URLS = [
	"https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv",
	"https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv",
	"https://archives.nseindia.com/content/indices/ind_nifty500list.csv",
]
NIFTY500_INDEX = "^CRSLDX"  # Nifty 500 index on Yahoo
TIMEOUT = 20
UNIVERSE_TIMEOUT = 60  # niftyindices is slow — give it more time
HISTORY_DAYS = 300  # ~14 months of trading days — enough for 200-SMA + 52w high/low
INTER_REQUEST_SLEEP = 0.15  # be polite to Yahoo


# ─────────────────────── Nifty 500 universe ───────────────────────

def _nifty500_cache_key():
	return "tj:screener:nifty500_list"


def _parse_nifty500_csv(text: str) -> list:
	out = []
	for row in csv.DictReader(StringIO(text)):
		sym = (row.get("Symbol") or "").strip().upper()
		if not sym:
			continue
		out.append({
			"symbol": sym,
			"company_name": (row.get("Company Name") or "").strip(),
			"industry": (row.get("Industry") or "").strip(),
		})
	return out


def _bundled_nifty500() -> list:
	"""Snapshot CSV shipped with the app — used when every remote source fails."""
	import os
	path = os.path.join(
		os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
		"data", "nifty500.csv",
	)
	try:
		with open(path, "r", encoding="utf-8") as f:
			return _parse_nifty500_csv(f.read())
	except FileNotFoundError:
		return []


def _bundled_fno_symbols() -> set:
	"""Set of NSE F&O-eligible symbols, bundled with the app.

	The NSE F&O list changes ~quarterly. The CSV is a maintained snapshot —
	when NSE adds/removes a stock, update `data/fno_list.csv`. We don't fetch
	live since the canonical NSE URL requires session cookies.
	"""
	import os
	path = os.path.join(
		os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
		"data", "fno_list.csv",
	)
	out = set()
	try:
		with open(path, "r", encoding="utf-8") as f:
			for row in csv.DictReader(f):
				sym = (row.get("Symbol") or "").strip().upper()
				if sym:
					out.add(sym)
	except FileNotFoundError:
		pass
	return out


def get_fno_symbols() -> set:
	"""Cached set of F&O-eligible NSE symbols."""
	cache = frappe.cache()
	key = "tj:screener:fno_list"
	cached = cache.get_value(key)
	if cached:
		try:
			return set(json.loads(cached))
		except Exception:
			pass
	syms = _bundled_fno_symbols()
	cache.set_value(key, json.dumps(sorted(syms)), expires_in_sec=24 * 3600)
	return syms


def get_nifty500_symbols(force: int = 0) -> list:
	"""Fetch the current Nifty 500 constituent list. Cached 24h.

	Tries multiple remote sources, then a bundled CSV snapshot. Returns
	[{symbol, company_name, industry}, ...].
	"""
	cache = frappe.cache()
	key = _nifty500_cache_key()
	if not int(force or 0):
		cached = cache.get_value(key)
		if cached:
			try:
				return json.loads(cached)
			except Exception:
				pass

	last_err = None
	headers = {
		"User-Agent": (
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
			"AppleWebKit/537.36 (KHTML, like Gecko) "
			"Chrome/124.0.0.0 Safari/537.36"
		),
		"Accept": "text/csv,*/*;q=0.9",
	}
	for url in NIFTY500_URLS:
		try:
			r = requests.get(url, headers=headers, timeout=UNIVERSE_TIMEOUT)
			r.raise_for_status()
			rows = _parse_nifty500_csv(r.text)
			if rows:
				cache.set_value(key, json.dumps(rows), expires_in_sec=24 * 3600)
				return rows
		except Exception as e:
			last_err = f"{url}: {e}"
			continue

	# All remotes failed → fall back to bundled snapshot
	rows = _bundled_nifty500()
	if rows:
		# Cache for only 1 hour so we re-try the live source soon
		cache.set_value(key, json.dumps(rows), expires_in_sec=3600)
		return rows
	raise RuntimeError(f"Could not load Nifty 500 universe. Last error: {last_err}")


# ─────────────────────── Yahoo OHLC history ───────────────────────

def fetch_history(symbol: str, exchange: str = "NSE", days: int = HISTORY_DAYS) -> dict:
	"""Pull daily OHLC history from Yahoo. Returns dict of arrays, or {ok: False}."""
	suffix = ".BO" if (exchange or "NSE").upper() == "BSE" else ".NS"
	# Index symbols (^CRSLDX, ^NSEI) are passed through as-is
	ys = symbol if symbol.startswith("^") else f"{symbol.upper()}{suffix}"
	# Range = days + buffer for weekends/holidays
	# Yahoo accepts: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y. Picked range gives some headroom.
	if days > 500:
		rng = "5y"
	elif days > 250:
		rng = "2y"
	else:
		rng = "1y"
	try:
		r = requests.get(
			YAHOO_CHART.format(symbol=ys),
			headers={"User-Agent": "Mozilla/5.0"},
			params={"interval": "1d", "range": rng},
			timeout=TIMEOUT,
		)
		payload = r.json()
		result = (payload.get("chart") or {}).get("result") or []
		if not result:
			err = (payload.get("chart") or {}).get("error") or {}
			return {"ok": False, "error": err.get("description") or "no data"}
		res = result[0]
		ts = res.get("timestamp") or []
		quote = (res.get("indicators") or {}).get("quote") or [{}]
		quote = quote[0] if quote else {}
		closes = quote.get("close") or []
		highs = quote.get("high") or []
		lows = quote.get("low") or []
		opens = quote.get("open") or []
		vols = quote.get("volume") or []
		# Drop rows with None close (Yahoo emits null for non-trading days inside the range)
		clean = []
		for i, t in enumerate(ts):
			c = closes[i] if i < len(closes) else None
			if c is None:
				continue
			clean.append({
				"t": t,
				"o": opens[i] if i < len(opens) and opens[i] is not None else c,
				"h": highs[i] if i < len(highs) and highs[i] is not None else c,
				"l": lows[i] if i < len(lows) and lows[i] is not None else c,
				"c": c,
				"v": vols[i] if i < len(vols) and vols[i] is not None else 0,
			})
		# Trim to last `days` rows
		clean = clean[-days:]
		return {
			"ok": True,
			"yahoo_symbol": ys,
			"candles": clean,
			"meta": res.get("meta") or {},
		}
	except requests.Timeout:
		return {"ok": False, "error": "timeout"}
	except Exception as e:
		return {"ok": False, "error": str(e)}


# ─────────────────────── indicator math ───────────────────────

def _sma(values, period):
	if len(values) < period:
		return None
	return sum(values[-period:]) / period


def _sma_at(values, period, offset_from_end):
	"""SMA computed `offset_from_end` bars ago. offset 0 = today, 22 = ~1 month ago."""
	end = len(values) - offset_from_end
	start = end - period
	if start < 0 or end <= 0:
		return None
	return sum(values[start:end]) / period


def compute_indicators(candles: list) -> dict:
	"""SMAs, 52w high/low, returns over multiple windows."""
	closes = [c["c"] for c in candles]
	if not closes:
		return {}
	last = closes[-1]
	out = {
		"price": last,
		"sma50": _sma(closes, 50),
		"sma150": _sma(closes, 150),
		"sma200": _sma(closes, 200),
		"sma200_22d_ago": _sma_at(closes, 200, 22),
		"sma200_44d_ago": _sma_at(closes, 200, 44),
	}
	# 52-week window = ~252 trading days
	window = closes[-252:] if len(closes) >= 252 else closes
	hi = max(window)
	lo = min(window)
	out["high_52w"] = hi
	out["low_52w"] = lo
	out["pct_from_52w_high"] = (last - hi) / hi * 100 if hi else 0  # ≤ 0
	out["pct_above_52w_low"] = (last - lo) / lo * 100 if lo else 0  # ≥ 0

	# Returns for RS Rating — Minervini-style weighted: 3m, 6m, 9m, 12m
	# (~63, 126, 189, 252 trading days)
	def _ret(days):
		if len(closes) <= days:
			return None
		past = closes[-days - 1]
		if not past:
			return None
		return (last / past) - 1

	out["ret_3m"] = _ret(63)
	out["ret_6m"] = _ret(126)
	out["ret_9m"] = _ret(189)
	out["ret_12m"] = _ret(252)
	return out


def compute_rs_score(ind: dict) -> float:
	"""Weighted return (Minervini's IBD-style RS): 2*Q1 + Q2 + Q3 + Q4."""
	r3 = ind.get("ret_3m")
	r6 = ind.get("ret_6m")
	r9 = ind.get("ret_9m")
	r12 = ind.get("ret_12m")
	if r3 is None or r6 is None or r9 is None or r12 is None:
		return None
	return 2 * r3 + r6 + r9 + r12


def percentile_ranks(values: list) -> list:
	"""Return percentile rank (0-99) for each input. None inputs → None outputs."""
	indexed = [(i, v) for i, v in enumerate(values) if v is not None]
	if not indexed:
		return [None] * len(values)
	indexed.sort(key=lambda t: t[1])
	n = len(indexed)
	out = [None] * len(values)
	for rank, (orig_i, _) in enumerate(indexed):
		# percentile 1..99 — rank 0 is worst
		out[orig_i] = round((rank / (n - 1) * 99) if n > 1 else 99, 1)
	return out


# ─────────────────────── Minervini Trend Template ───────────────────────

def evaluate_trend_template(ind: dict, rs_rating: float) -> dict:
	"""Apply the 8 Trend Template rules. Returns dict with criteria + total passed."""
	price = ind.get("price")
	sma50 = ind.get("sma50")
	sma150 = ind.get("sma150")
	sma200 = ind.get("sma200")
	sma200_22 = ind.get("sma200_22d_ago")
	pct_from_high = ind.get("pct_from_52w_high")  # ≤ 0
	pct_above_low = ind.get("pct_above_52w_low")  # ≥ 0

	criteria = {}
	# 1. Price > 150-SMA AND > 200-SMA
	criteria["1_price_above_150_200"] = bool(
		price and sma150 and sma200 and price > sma150 and price > sma200
	)
	# 2. 150-SMA > 200-SMA
	criteria["2_150_above_200"] = bool(sma150 and sma200 and sma150 > sma200)
	# 3. 200-SMA trending up for at least 1 month (~22 trading days)
	criteria["3_200_uptrending"] = bool(sma200 and sma200_22 and sma200 > sma200_22)
	# 4. 50-SMA > 150-SMA > 200-SMA
	criteria["4_50_150_200_stack"] = bool(
		sma50 and sma150 and sma200 and sma50 > sma150 > sma200
	)
	# 5. Price > 50-SMA
	criteria["5_price_above_50"] = bool(price and sma50 and price > sma50)
	# 6. Price ≥ 30% above 52-week low
	criteria["6_30pct_above_52w_low"] = bool(pct_above_low is not None and pct_above_low >= 30)
	# 7. Price within 25% of 52-week high (i.e. pct_from_high >= -25)
	criteria["7_within_25pct_of_52w_high"] = bool(
		pct_from_high is not None and pct_from_high >= -25
	)
	# 8. RS Rating ≥ 70
	criteria["8_rs_rating_70_plus"] = bool(rs_rating is not None and rs_rating >= 70)

	passed = sum(1 for v in criteria.values() if v)
	return {
		"criteria": criteria,
		"passed": passed,
		"total": 8,
		"all_pass": passed == 8,
	}


# ─────────────────────── VCP detector ───────────────────────

def _find_swings(candles: list, lookback: int = 130) -> list:
	"""Find swing highs/lows in the recent window using a 5-bar pivot.

	Returns list of {idx, price, kind: 'H'|'L'}.
	"""
	window = candles[-lookback:] if len(candles) >= lookback else candles
	off = len(candles) - len(window)
	swings = []
	for i in range(2, len(window) - 2):
		c = window[i]
		left = window[i - 2: i]
		right = window[i + 1: i + 3]
		if c["h"] > max(b["h"] for b in left) and c["h"] > max(b["h"] for b in right):
			swings.append({"idx": off + i, "price": c["h"], "kind": "H"})
		if c["l"] < min(b["l"] for b in left) and c["l"] < min(b["l"] for b in right):
			swings.append({"idx": off + i, "price": c["l"], "kind": "L"})
	swings.sort(key=lambda s: s["idx"])
	return swings


def detect_vcp(candles: list, ind: dict) -> dict:
	"""Look for a Volatility Contraction Pattern in the most recent ~6 months.

	Heuristic (not a strict Minervini definition):
	  - Find ≥ 2 successive contractions where each pullback is shallower than the prior
	  - Most recent pullback ≤ 15% (the "tight" final base)
	  - Latest price within ~5% of the pivot (last swing high)
	  - Bonus: 50-day avg volume in the most recent 10 bars < 50-day avg volume earlier
	"""
	if len(candles) < 60:
		return {"is_vcp": False, "reason": "not enough history"}

	swings = _find_swings(candles, lookback=130)
	if len(swings) < 4:
		return {"is_vcp": False, "reason": "fewer than 4 swing pivots"}

	# Build alternating H/L contractions from latest swings
	# Walk backward and pair (H, L) → contraction depth = (H - L) / H
	contractions = []
	last_high = None
	for s in reversed(swings):
		if s["kind"] == "H" and last_high is None:
			last_high = s
			continue
		if last_high and s["kind"] == "L":
			depth = (last_high["price"] - s["price"]) / last_high["price"] * 100
			contractions.append({
				"high_idx": last_high["idx"],
				"high": last_high["price"],
				"low_idx": s["idx"],
				"low": s["price"],
				"depth_pct": depth,
			})
			last_high = None  # reset for next pair (further back)
		if len(contractions) >= 4:
			break
	if len(contractions) < 2:
		return {"is_vcp": False, "reason": "fewer than 2 H→L contractions"}

	# Order from oldest to newest (we walked backwards, so reverse)
	contractions = list(reversed(contractions))

	# Each successive contraction should be ≤ 75% of the previous (i.e. tightening)
	tightening = True
	for i in range(1, len(contractions)):
		if contractions[i]["depth_pct"] >= contractions[i - 1]["depth_pct"]:
			tightening = False
			break
	latest = contractions[-1]
	final_tight = latest["depth_pct"] <= 15
	# Distance from the most recent pivot high
	pivot = max(c["high"] for c in contractions)
	price = ind.get("price") or candles[-1]["c"]
	dist_from_pivot = (pivot - price) / pivot * 100  # ≥ 0

	# Volume dryness in last 10 bars vs prior 40 bars
	vols = [c["v"] for c in candles[-50:]]
	avg_recent = sum(vols[-10:]) / 10 if len(vols) >= 10 else 0
	avg_earlier = sum(vols[:-10]) / max(len(vols) - 10, 1) if len(vols) > 10 else 0
	dry = avg_recent < avg_earlier if avg_earlier else False

	is_vcp = tightening and final_tight and dist_from_pivot <= 8

	return {
		"is_vcp": bool(is_vcp),
		"tightening": tightening,
		"final_contraction_pct": round(latest["depth_pct"], 2),
		"contraction_count": len(contractions),
		"contractions": [
			{"depth_pct": round(c["depth_pct"], 2)} for c in contractions
		],
		"pivot": round(pivot, 2),
		"distance_from_pivot_pct": round(dist_from_pivot, 2),
		"volume_dry_up": dry,
		"reason": (
			"tight VCP near pivot" if is_vcp
			else (
				"final contraction not tight" if not final_tight
				else "not tightening" if not tightening
				else "too far from pivot"
			)
		),
	}


# ─────────────────────── progress reporting ───────────────────────

def _set_progress(run_name: str, message: str):
	frappe.db.set_value("Screener Run", run_name, "progress_message", message, update_modified=False)
	frappe.db.commit()


def _log(run_name: str, message: str):
	"""Log to progress_message + bench log. Best-effort."""
	try:
		_set_progress(run_name, message)
	except Exception:
		pass


# ─────────────────────── snapshot-backed scan (the fast path) ───────────────────────

def _company_name_map() -> dict:
	"""{symbol: company_name} from the Nifty 500 universe."""
	return {row["symbol"]: row["company_name"] for row in get_nifty500_symbols()}


def _evaluate_trend_template_from_snapshot(row: dict) -> dict:
	"""Apply the 8 Trend Template rules to a Stock Daily Snapshot row."""
	price = flt(row.get("close_price"))
	sma50 = row.get("sma50")
	sma150 = row.get("sma150")
	sma200 = row.get("sma200")
	sma200_22 = row.get("sma200_22d_ago")
	pct_from_high = flt(row.get("pct_from_52w_high"))
	pct_above_low = flt(row.get("pct_above_52w_low"))
	rs = flt(row.get("rs_rating"))
	criteria = {
		"1_price_above_150_200": bool(price and sma150 and sma200 and price > sma150 and price > sma200),
		"2_150_above_200":       bool(sma150 and sma200 and sma150 > sma200),
		"3_200_uptrending":      bool(sma200 and sma200_22 and sma200 > sma200_22),
		"4_50_150_200_stack":    bool(sma50 and sma150 and sma200 and sma50 > sma150 > sma200),
		"5_price_above_50":      bool(price and sma50 and price > sma50),
		"6_30pct_above_52w_low": bool(pct_above_low >= 30),
		"7_within_25pct_of_52w_high": bool(pct_from_high >= -25),
		"8_rs_rating_70_plus":   bool(rs >= 70),
	}
	passed = sum(1 for v in criteria.values() if v)
	return {"criteria": criteria, "passed": passed, "all_pass": passed == 8}


def _detect_rocket_base(candles: list, last_close: float, min_run_pct: float = 90.0,
                         max_base_pullback_pct: float = 25.0) -> dict:
	"""Mark Minervini's Power Play / High Tight Flag (a.k.a. "Rocket Base").

	Looks for stocks that:
	  1. Rocketed up: 8-week return ≥ min_run_pct (default 90%)
	  2. Then based tightly: most recent ~4-week pullback from peak ≤ max_base_pullback_pct (default 25%)
	  3. Still holding near the peak (close within max_base_pullback_pct of the 8w high)
	  4. Optional: volume drying up in the base vs the rally
	"""
	if len(candles) < 50:
		return {"is_rocket_base": False, "reason": "not enough history"}

	closes = [c["c"] for c in candles]
	highs = [c["h"] for c in candles]
	lows = [c["l"] for c in candles]
	vols = [c["v"] for c in candles]

	# 8-week window = ~40 trading days
	window_8w = 40
	if len(closes) <= window_8w:
		return {"is_rocket_base": False, "reason": "history < 8 weeks"}
	bar_8w_ago = closes[-window_8w - 1]
	if not bar_8w_ago:
		return {"is_rocket_base": False, "reason": "bad reference price"}
	peak_8w = max(highs[-window_8w:])
	run_pct = (peak_8w / bar_8w_ago - 1) * 100

	# Recent base: last ~4 weeks (20 bars)
	base_window = 20
	base_highs = highs[-base_window:]
	base_lows = lows[-base_window:]
	base_peak = max(base_highs)
	base_low = min(base_lows)
	base_depth_pct = (base_peak - base_low) / base_peak * 100 if base_peak else 0

	# How far the latest close is below the 8-week peak
	dist_from_peak_pct = (peak_8w - last_close) / peak_8w * 100 if peak_8w else 0

	# Volume dry-up: last 10 bars vs prior 30
	avg_recent = sum(vols[-10:]) / 10 if len(vols) >= 10 else 0
	earlier = vols[-40:-10] if len(vols) >= 40 else []
	avg_earlier = sum(earlier) / len(earlier) if earlier else 0
	vol_dry = avg_recent < avg_earlier if avg_earlier else False

	is_rocket = (
		run_pct >= float(min_run_pct)
		and base_depth_pct <= float(max_base_pullback_pct)
		and dist_from_peak_pct <= float(max_base_pullback_pct)
	)

	return {
		"is_rocket_base": bool(is_rocket),
		"run_pct_8w": round(run_pct, 2),
		"peak_8w": round(peak_8w, 2),
		"base_depth_pct": round(base_depth_pct, 2),
		"dist_from_peak_pct": round(dist_from_peak_pct, 2),
		"volume_dry_up": vol_dry,
		"reason": (
			"rocketed and based tightly near peak" if is_rocket
			else (
				f"8w rally only {round(run_pct, 1)}% (need ≥ {min_run_pct}%)" if run_pct < min_run_pct
				else f"base too deep ({round(base_depth_pct, 1)}% > {max_base_pullback_pct}%)" if base_depth_pct > max_base_pullback_pct
				else f"price too far from peak ({round(dist_from_peak_pct, 1)}%)"
			)
		),
	}


def _detect_turnaround_from_snapshot(row: dict) -> dict:
	"""Turnaround stock detector — a beaten-down laggard reversing into a new uptrend.

	This is the *technical signature* of a fundamental turnaround (Weinstein
	Stage 1 → Stage 2 transition). We don't have earnings data, so instead of
	confirming the fundamentals we confirm that the market has *already
	repriced* the recovery — price action leads the tape.

	A turnaround candidate is a stock that:
	  1. Was beaten down  — trades ≥ 25% below its 52-week high (room to recover;
	     a stock near its high is a momentum leader, not a turnaround).
	  2. Has bottomed     — sits ≥ 20% above its 52-week low (a base formed and
	     price has lifted off it, i.e. it is no longer falling).
	  3. Reclaimed the trend — price back above BOTH the 50-DMA and 200-DMA
	     (the single clearest "Stage 2 has begun" signal).
	  4. Downtrend is ending — the 200-DMA has stopped falling vs ~2 months ago
	     (separates a real turn from a dead-cat bounce inside a downtrend).
	  5. Was a laggard    — 12-month return < 25% (it genuinely under-performed;
	     this is what makes it a turnaround and not an extended winner).
	  6. Momentum inflection — 3-month return ≥ 10% (a sharp recent-quarter
	     surge — the actual "turn").
	  7. Relative strength recovering — RS Rating ≥ 45 (lifting off the lows).
	"""
	price = flt(row.get("close_price"))
	sma50 = flt(row.get("sma50"))
	sma200 = flt(row.get("sma200"))
	sma200_44 = flt(row.get("sma200_44d_ago"))
	pct_from_high = flt(row.get("pct_from_52w_high"))   # ≤ 0
	pct_above_low = flt(row.get("pct_above_52w_low"))   # ≥ 0
	ret_3m = flt(row.get("ret_3m"))    # snapshot stores returns as percentages (12.0 = 12%)
	ret_6m = flt(row.get("ret_6m"))
	ret_12m = flt(row.get("ret_12m"))
	rs = flt(row.get("rs_rating"))
	vol_ratio = flt(row.get("vol_ratio_10_20"))

	checks = {
		"beaten_down":      pct_from_high <= -25,
		"lifted_off_low":   pct_above_low >= 20,
		"reclaimed_trend":  bool(price and sma200 and sma50 and price > sma200 and price > sma50),
		"downtrend_ending": bool(sma200 and sma200_44 and sma200 >= sma200_44),
		"was_laggard":      ret_12m < 25,
		"momentum_turn":    ret_3m >= 10,
		"rs_recovering":    rs >= 45,
	}
	is_turnaround = all(checks.values())
	golden_cross = bool(sma50 and sma200 and sma50 > sma200)
	volume_expansion = vol_ratio >= 1.1

	return {
		"is_turnaround": bool(is_turnaround),
		"ret_3m_pct": round(ret_3m, 2),
		"ret_6m_pct": round(ret_6m, 2),
		"ret_12m_pct": round(ret_12m, 2),
		"dist_from_52w_high_pct": round(pct_from_high, 2),
		"above_52w_low_pct": round(pct_above_low, 2),
		"price_above_200sma": checks["reclaimed_trend"],
		"sma200_flat_or_rising": checks["downtrend_ending"],
		"golden_cross": golden_cross,
		"volume_expansion": volume_expansion,
		"vol_ratio_10_20": round(vol_ratio, 2),
		"rs_rating": round(rs, 1),
		"checks": checks,
		"reason": (
			"beaten-down laggard reclaiming its trend — turnaround underway" if is_turnaround
			else (
				f"only {round(abs(pct_from_high), 1)}% below 52w high — not beaten down" if not checks["beaten_down"]
				else f"only {round(pct_above_low, 1)}% above 52w low — base not formed" if not checks["lifted_off_low"]
				else "still below 50-DMA / 200-DMA — downtrend intact" if not checks["reclaimed_trend"]
				else "200-DMA still falling — no base yet" if not checks["downtrend_ending"]
				else f"12m return {round(ret_12m, 1)}% — already a leader, not a turnaround" if not checks["was_laggard"]
				else f"3m return {round(ret_3m, 1)}% < 10% — no momentum inflection" if not checks["momentum_turn"]
				else f"RS Rating {round(rs, 1)} < 45 — relative strength not recovering"
			)
		),
	}


def _detect_intraday_momentum(candles: list, row: dict,
                                min_change_pct: float = 2.0,
                                min_close_strength: float = 0.65,
                                min_range_pct: float = 1.5,
                                min_vol_ratio: float = 1.5) -> dict:
	"""Identify next-day intraday trade candidates from end-of-day signals.

	The screener runs on daily bars, so it can't see live ticks. Instead it
	flags stocks that *closed strong* with surging volume — these are the
	tape's "in-play" names that gap-up traders and ORB scalpers watch the
	next morning.

	Criteria (all configurable):
	  1. Today's % change ≥ min_change_pct  (true up-day, not noise)
	  2. Close in top (1 - min_close_strength) of the day's range — i.e.
	     `(close - low) / (high - low) ≥ min_close_strength`  (closing strength)
	  3. Day's range ≥ min_range_pct of close  (enough movement to trade)
	  4. Today's volume ≥ min_vol_ratio × avg 20-day volume  (volume surge)
	  5. Price > 20-period SMA (uptrend bias; uses sma50 from snapshot)
	  6. RS Rating ≥ 50  (not a contra-trend bounce in a weak name)
	"""
	if len(candles) < 22:
		return {"is_momentum": False, "reason": "not enough history"}
	today = candles[-1]
	prev = candles[-2]
	# Returns / gap
	prev_close = flt(prev["c"])
	if prev_close <= 0:
		return {"is_momentum": False, "reason": "bad prev close"}
	change_pct = (today["c"] - prev_close) / prev_close * 100
	gap_pct = (today["o"] - prev_close) / prev_close * 100
	# Range + closing strength
	day_range = today["h"] - today["l"]
	if day_range <= 0 or today["c"] <= 0:
		return {"is_momentum": False, "reason": "no intraday range"}
	close_strength = (today["c"] - today["l"]) / day_range  # 1.0 = closed at high
	range_pct = day_range / today["c"] * 100
	# Volume surge (today vs last 20 days)
	prior_vols = [c["v"] for c in candles[-21:-1] if c.get("v")]
	avg_vol = sum(prior_vols) / len(prior_vols) if prior_vols else 0
	vol_ratio = (today["v"] / avg_vol) if avg_vol else 0
	# Trend bias from snapshot row (sma50 + RS)
	price = flt(row.get("close_price")) or today["c"]
	sma50 = flt(row.get("sma50"))
	sma200 = flt(row.get("sma200"))
	above_50 = bool(price and sma50 and price > sma50)
	stack = bool(sma50 and sma200 and sma50 > sma200)
	rs = flt(row.get("rs_rating"))
	# Distance from 20-day high (need fresh from candles)
	recent_high = max(c["h"] for c in candles[-20:])
	dist_from_20d_high = (recent_high - today["c"]) / recent_high * 100 if recent_high else 0

	checks = {
		"change_pct_ok":    change_pct >= float(min_change_pct),
		"close_strong":     close_strength >= float(min_close_strength),
		"range_ok":         range_pct >= float(min_range_pct),
		"volume_surge":     vol_ratio >= float(min_vol_ratio),
		"above_50sma":      above_50,
		"rs_60_plus":       rs >= 50,
	}
	is_momentum = all(checks.values())

	return {
		"is_momentum": bool(is_momentum),
		"change_pct": round(change_pct, 2),
		"gap_pct": round(gap_pct, 2),
		"close_strength": round(close_strength * 100, 1),  # as %
		"range_pct": round(range_pct, 2),
		"vol_ratio_20d": round(vol_ratio, 2),
		"avg_vol_20d": int(avg_vol or 0),
		"today_volume": int(today["v"] or 0),
		"dist_from_20d_high_pct": round(dist_from_20d_high, 2),
		"sma50_above_sma200": stack,
		"price_above_50sma": above_50,
		"checks": checks,
		"reason": (
			"strong close on volume — intraday momentum candidate" if is_momentum
			else (
				f"change only {round(change_pct, 1)}% (need ≥ {min_change_pct}%)" if not checks["change_pct_ok"]
				else f"close strength {round(close_strength * 100, 0)}% (need ≥ {min_close_strength * 100:.0f}%)" if not checks["close_strong"]
				else f"range only {round(range_pct, 2)}% (need ≥ {min_range_pct}%)" if not checks["range_ok"]
				else f"volume {round(vol_ratio, 1)}× avg (need ≥ {min_vol_ratio}×)" if not checks["volume_surge"]
				else "below 50 SMA" if not checks["above_50sma"]
				else "RS Rating < 50"
			)
		),
	}


def _detect_intraday_short(candles: list, row: dict,
                            min_change_pct: float = 2.0,
                            max_close_strength: float = 0.35,
                            min_range_pct: float = 1.5,
                            min_vol_ratio: float = 1.5) -> dict:
	"""Identify next-day intraday short candidates from end-of-day signals.

	Sell-side mirror of `_detect_intraday_momentum`. Flags stocks that
	*closed weak* on heavy volume — the tape's "in-play" sellers that
	gap-down and ORB-short traders watch the next morning.

	Criteria (all configurable):
	  1. Today's % change ≤ -min_change_pct  (true down-day, not noise)
	  2. Close in bottom (max_close_strength) of the day's range — i.e.
	     `(close - low) / (high - low) ≤ max_close_strength`  (closed near low)
	  3. Day's range ≥ min_range_pct of close  (enough movement to trade)
	  4. Today's volume ≥ min_vol_ratio × avg 20-day volume  (distribution surge)
	  5. Price < 50 SMA  (downtrend bias)
	  6. RS Rating ≤ 50  (laggard vs Nifty 500)
	"""
	if len(candles) < 22:
		return {"is_short": False, "reason": "not enough history"}
	today = candles[-1]
	prev = candles[-2]
	prev_close = flt(prev["c"])
	if prev_close <= 0:
		return {"is_short": False, "reason": "bad prev close"}
	change_pct = (today["c"] - prev_close) / prev_close * 100
	gap_pct = (today["o"] - prev_close) / prev_close * 100
	day_range = today["h"] - today["l"]
	if day_range <= 0 or today["c"] <= 0:
		return {"is_short": False, "reason": "no intraday range"}
	# Same metric as buy-side (1.0 = closed at high, 0.0 = closed at low) so
	# the UI/sorting reads consistently — short setups want this LOW.
	close_strength = (today["c"] - today["l"]) / day_range
	range_pct = day_range / today["c"] * 100
	prior_vols = [c["v"] for c in candles[-21:-1] if c.get("v")]
	avg_vol = sum(prior_vols) / len(prior_vols) if prior_vols else 0
	vol_ratio = (today["v"] / avg_vol) if avg_vol else 0
	price = flt(row.get("close_price")) or today["c"]
	sma50 = flt(row.get("sma50"))
	sma200 = flt(row.get("sma200"))
	below_50 = bool(price and sma50 and price < sma50)
	# Bearish stack: 50 SMA below 200 SMA
	bearish_stack = bool(sma50 and sma200 and sma50 < sma200)
	rs = flt(row.get("rs_rating"))
	recent_low = min(c["l"] for c in candles[-20:])
	dist_from_20d_low = (today["c"] - recent_low) / recent_low * 100 if recent_low else 0

	checks = {
		"change_pct_ok":    change_pct <= -float(min_change_pct),
		"close_weak":       close_strength <= float(max_close_strength),
		"range_ok":         range_pct >= float(min_range_pct),
		"volume_surge":     vol_ratio >= float(min_vol_ratio),
		"below_50sma":      below_50,
		"rs_50_or_less":    rs <= 50 and rs > 0,
	}
	is_short = all(checks.values())

	return {
		"is_short": bool(is_short),
		"change_pct": round(change_pct, 2),
		"gap_pct": round(gap_pct, 2),
		"close_strength": round(close_strength * 100, 1),
		"range_pct": round(range_pct, 2),
		"vol_ratio_20d": round(vol_ratio, 2),
		"avg_vol_20d": int(avg_vol or 0),
		"today_volume": int(today["v"] or 0),
		"dist_from_20d_low_pct": round(dist_from_20d_low, 2),
		"sma50_below_sma200": bearish_stack,
		"price_below_50sma": below_50,
		"checks": checks,
		"reason": (
			"weak close on volume — intraday short candidate" if is_short
			else (
				f"change only {round(change_pct, 1)}% (need ≤ -{min_change_pct}%)" if not checks["change_pct_ok"]
				else f"close strength {round(close_strength * 100, 0)}% (need ≤ {max_close_strength * 100:.0f}%)" if not checks["close_weak"]
				else f"range only {round(range_pct, 2)}% (need ≥ {min_range_pct}%)" if not checks["range_ok"]
				else f"volume {round(vol_ratio, 1)}× avg (need ≥ {min_vol_ratio}×)" if not checks["volume_surge"]
				else "above 50 SMA" if not checks["below_50sma"]
				else "RS Rating > 50"
			)
		),
	}


def _detect_fno_momentum_from_snapshot(row: dict, in_fno: bool) -> dict:
	"""F&O swing-momentum candidates — Trend Template-lite for the F&O universe.

	F&O traders need liquidity (everyone in the F&O universe has it) and a
	clean, sustained trend so options premium decay doesn't fight them.

	Criteria:
	  1. Symbol is F&O-eligible
	  2. Price > 50 SMA AND 50 SMA > 200 SMA  (clean uptrend)
	  3. RS Rating ≥ 60  (top-third strength vs Nifty 500)
	  4. 3-month return ≥ 5%  (sustained, not 1-day pop)
	  5. Within 20% of 52-week high  (not a falling knife)
	  6. Volume ratio (10d/20d) ≥ 1.0  (recent volume holding up)
	"""
	if not in_fno:
		return {"is_fno_momentum": False, "reason": "not F&O-eligible"}
	price = flt(row.get("close_price"))
	sma50 = flt(row.get("sma50"))
	sma200 = flt(row.get("sma200"))
	rs = flt(row.get("rs_rating"))
	ret_3m = flt(row.get("ret_3m"))  # snapshot already stores as a percentage (12.0 = 12%)
	pct_from_high = flt(row.get("pct_from_52w_high"))
	vol_ratio = flt(row.get("vol_ratio_10_20"))

	checks = {
		"above_50sma":      bool(price and sma50 and price > sma50),
		"sma50_above_200":  bool(sma50 and sma200 and sma50 > sma200),
		"rs_60_plus":       rs >= 60,
		"ret_3m_5pct":      ret_3m >= 5,
		"within_20_pct_of_high": pct_from_high >= -20,
		"vol_holding":      vol_ratio >= 1.0,
	}
	is_fno = all(checks.values())
	return {
		"is_fno_momentum": bool(is_fno),
		"ret_3m_pct": round(ret_3m, 2),
		"dist_from_52w_high_pct": round(abs(pct_from_high), 2),
		"vol_ratio_10_20": round(vol_ratio, 2),
		"price_above_50sma": checks["above_50sma"],
		"sma50_above_sma200": checks["sma50_above_200"],
		"rs_rating": round(rs, 1),
		"checks": checks,
		"reason": (
			"F&O stock in clean uptrend with momentum" if is_fno
			else (
				"below 50 SMA" if not checks["above_50sma"]
				else "50 SMA below 200 SMA (downtrend)" if not checks["sma50_above_200"]
				else f"RS Rating {round(rs, 1)} < 60" if not checks["rs_60_plus"]
				else f"3-month return {round(ret_3m, 1)}% < 5%" if not checks["ret_3m_5pct"]
				else "more than 20% below 52w high" if not checks["within_20_pct_of_high"]
				else f"volume cooling (ratio {round(vol_ratio, 2)})"
			)
		),
	}


def _vcp_candles_for_symbols(symbols: list, target_date) -> dict:
	"""Pull last 140 days of {h, l, c, v} per symbol from snapshots in one query."""
	from datetime import timedelta
	cutoff = target_date - timedelta(days=210)  # ~140 trading days
	if not symbols:
		return {}
	# Batch in groups of 200 to keep the IN() list bounded
	out = {}
	for i in range(0, len(symbols), 200):
		batch = symbols[i:i + 200]
		placeholders = ", ".join(["%s"] * len(batch))
		rows = frappe.db.sql(
			f"""
			SELECT symbol, UNIX_TIMESTAMP(date) AS t,
			       open_price AS o, high_price AS h, low_price AS l,
			       close_price AS c, volume AS v
			FROM `tabStock Daily Snapshot`
			WHERE date >= %s AND date <= %s AND symbol IN ({placeholders})
			ORDER BY symbol, date
			""",
			[cutoff.isoformat(), target_date.isoformat()] + batch,
			as_dict=True,
		)
		for r in rows:
			out.setdefault(r["symbol"], []).append({
				"t": int(r["t"]),
				"o": flt(r["o"]), "h": flt(r["h"]), "l": flt(r["l"]),
				"c": flt(r["c"]), "v": int(r["v"] or 0),
			})
	return out


def run_scan_from_snapshot(scan_type: str) -> dict:
	"""Sub-second screener using the snapshot table.

	Returns {ok, results, total_scanned, snapshot_date}.
	"""
	from trading_journal.trading_journal.utils import snapshot as snap

	target = snap.latest_snapshot_date()
	if not target:
		return {"ok": False, "error": "No snapshots in DB. Run Refresh Snapshot first.", "results": [], "total_scanned": 0}

	# Pull the universe row for that date
	rows = frappe.db.sql(
		"""
		SELECT symbol, industry, close_price, volume,
		       sma50, sma150, sma200, sma200_22d_ago,
		       high_52w, low_52w, pct_from_52w_high, pct_above_52w_low,
		       ret_3m, ret_6m, ret_9m, ret_12m, rs_score, rs_rating,
		       range_22d_pct, range_22d_high, range_22d_low, vol_ratio_10_20
		FROM `tabStock Daily Snapshot`
		WHERE date = %s
		""",
		(target.isoformat(),),
		as_dict=True,
	)
	total_scanned = len(rows)
	companies = _company_name_map()
	results = []

	if scan_type == "Trend Template":
		for r in rows:
			ev = _evaluate_trend_template_from_snapshot(r)
			if ev["passed"] >= 6:
				results.append({
					"symbol": r["symbol"],
					"company_name": companies.get(r["symbol"], r["symbol"]),
					"current_price": flt(r["close_price"]),
					"passed_count": ev["passed"],
					"rs_rating": flt(r.get("rs_rating")),
					"pct_from_52w_high": flt(r.get("pct_from_52w_high")),
					"pct_above_52w_low": flt(r.get("pct_above_52w_low")),
					"vcp_tightness": 0,
					"criteria_json": json.dumps(
						{"trend_template": ev["criteria"], "all_pass": ev["all_pass"], "industry": r.get("industry") or ""},
						default=str,
					),
				})
		results.sort(key=lambda x: (-x["passed_count"], -x["rs_rating"]))

	elif scan_type == "Turnaround":
		for r in rows:
			ta = _detect_turnaround_from_snapshot(r)
			if ta.get("is_turnaround"):
				ev = _evaluate_trend_template_from_snapshot(r)
				results.append({
					"symbol": r["symbol"],
					"company_name": companies.get(r["symbol"], r["symbol"]),
					"current_price": flt(r["close_price"]),
					"passed_count": ev["passed"],
					"rs_rating": flt(r.get("rs_rating")),
					"pct_from_52w_high": flt(r.get("pct_from_52w_high")),
					"pct_above_52w_low": flt(r.get("pct_above_52w_low")),
					# Repurpose vcp_tightness as the 3-month return (used for sort + UI)
					"vcp_tightness": flt(ta.get("ret_3m_pct")),
					"criteria_json": json.dumps(
						{"turnaround": ta, "trend_template_passed": ev["passed"], "industry": r.get("industry") or ""},
						default=str,
					),
				})
		# Strongest recent-quarter recovery first, then RS Rating
		results.sort(key=lambda x: (-x["vcp_tightness"], -x["rs_rating"]))

	elif scan_type == "Rocket Base":
		# Power Play / High Tight Flag — needs 50+ days of candles per symbol.
		# Same approach as VCP: candles come from the snapshot table, not Yahoo.
		all_syms = [r["symbol"] for r in rows]
		candles_by_sym = _vcp_candles_for_symbols(all_syms, target)
		row_by_sym = {r["symbol"]: r for r in rows}
		# Persist a loose population (≥50% run, ≤35% base) so the UI can tighten via filters.
		for sym, candles in candles_by_sym.items():
			r = row_by_sym.get(sym)
			if not r or len(candles) < 50:
				continue
			rb = _detect_rocket_base(candles, flt(r["close_price"]),
			                         min_run_pct=50.0, max_base_pullback_pct=35.0)
			if rb.get("is_rocket_base"):
				ev = _evaluate_trend_template_from_snapshot(r)
				results.append({
					"symbol": sym,
					"company_name": companies.get(sym, sym),
					"current_price": flt(r["close_price"]),
					"passed_count": ev["passed"],
					"rs_rating": flt(r.get("rs_rating")),
					"pct_from_52w_high": flt(r.get("pct_from_52w_high")),
					"pct_above_52w_low": flt(r.get("pct_above_52w_low")),
					"vcp_tightness": flt(rb.get("base_depth_pct")),
					"criteria_json": json.dumps(
						{"rocket_base": rb, "trend_template_passed": ev["passed"], "industry": r.get("industry") or ""},
						default=str,
					),
				})
		# Sort: highest 8-week rally first, then by tighter base, then RS
		def _rb_sort_key(x):
			try:
				crit = json.loads(x["criteria_json"]).get("rocket_base", {})
				return (-flt(crit.get("run_pct_8w") or 0), x["vcp_tightness"], -x["rs_rating"])
			except Exception:
				return (0, x["vcp_tightness"], -x["rs_rating"])
		results.sort(key=_rb_sort_key)

	elif scan_type == "VCP":
		# VCP needs swing-pivot detection, so we pull last ~140 candles per symbol from snapshots
		# (still SQL — no Yahoo calls). This is the only scan_type that processes per-symbol.
		all_syms = [r["symbol"] for r in rows]
		candles_by_sym = _vcp_candles_for_symbols(all_syms, target)
		row_by_sym = {r["symbol"]: r for r in rows}
		for sym, candles in candles_by_sym.items():
			r = row_by_sym.get(sym)
			if not r or len(candles) < 60:
				continue
			ind = {"price": flt(r["close_price"])}
			v = detect_vcp(candles, ind)
			if v.get("is_vcp"):
				ev = _evaluate_trend_template_from_snapshot(r)
				results.append({
					"symbol": sym,
					"company_name": companies.get(sym, sym),
					"current_price": flt(r["close_price"]),
					"passed_count": ev["passed"],
					"rs_rating": flt(r.get("rs_rating")),
					"pct_from_52w_high": flt(r.get("pct_from_52w_high")),
					"pct_above_52w_low": flt(r.get("pct_above_52w_low")),
					"vcp_tightness": flt(v.get("final_contraction_pct")),
					"criteria_json": json.dumps(
						{"vcp": v, "trend_template_passed": ev["passed"], "industry": r.get("industry") or ""},
						default=str,
					),
				})
		results.sort(key=lambda x: (x["vcp_tightness"], -x["rs_rating"]))

	elif scan_type == "Intraday Momentum":
		# Needs the last ~25 daily candles per symbol to measure today's gap,
		# closing strength, and 20-day volume baseline.
		all_syms = [r["symbol"] for r in rows]
		candles_by_sym = _vcp_candles_for_symbols(all_syms, target)
		row_by_sym = {r["symbol"]: r for r in rows}
		for sym, candles in candles_by_sym.items():
			r = row_by_sym.get(sym)
			if not r or len(candles) < 22:
				continue
			im = _detect_intraday_momentum(candles, r)
			if im.get("is_momentum"):
				ev = _evaluate_trend_template_from_snapshot(r)
				results.append({
					"symbol": sym,
					"company_name": companies.get(sym, sym),
					"current_price": flt(r["close_price"]),
					"passed_count": ev["passed"],
					"rs_rating": flt(r.get("rs_rating")),
					"pct_from_52w_high": flt(r.get("pct_from_52w_high")),
					"pct_above_52w_low": flt(r.get("pct_above_52w_low")),
					# Repurpose vcp_tightness as today's % change (used for sort + UI)
					"vcp_tightness": flt(im.get("change_pct")),
					"criteria_json": json.dumps(
						{"intraday_momentum": im, "trend_template_passed": ev["passed"], "industry": r.get("industry") or ""},
						default=str,
					),
				})
		# Highest % gain on best closing-strength first
		def _im_sort_key(x):
			try:
				im = json.loads(x["criteria_json"]).get("intraday_momentum", {})
				return (-flt(im.get("vol_ratio_20d") or 0), -flt(im.get("close_strength") or 0), -x["vcp_tightness"])
			except Exception:
				return (0, 0, -x["vcp_tightness"])
		results.sort(key=_im_sort_key)

	elif scan_type == "FnO Momentum":
		fno = get_fno_symbols()
		for r in rows:
			sym = r["symbol"]
			in_fno = sym in fno
			if not in_fno:
				continue  # skip non-FnO names entirely so total_scanned reflects the F&O universe
			fm = _detect_fno_momentum_from_snapshot(r, in_fno=True)
			if fm.get("is_fno_momentum"):
				ev = _evaluate_trend_template_from_snapshot(r)
				results.append({
					"symbol": sym,
					"company_name": companies.get(sym, sym),
					"current_price": flt(r["close_price"]),
					"passed_count": ev["passed"],
					"rs_rating": flt(r.get("rs_rating")),
					"pct_from_52w_high": flt(r.get("pct_from_52w_high")),
					"pct_above_52w_low": flt(r.get("pct_above_52w_low")),
					# Repurpose vcp_tightness as the 3-month return (used for sort + UI)
					"vcp_tightness": flt(fm.get("ret_3m_pct")),
					"criteria_json": json.dumps(
						{"fno_momentum": fm, "trend_template_passed": ev["passed"], "industry": r.get("industry") or ""},
						default=str,
					),
				})
		# Strongest 3-month return first, then RS Rating
		results.sort(key=lambda x: (-x["vcp_tightness"], -x["rs_rating"]))
		# F&O scan reports the F&O universe as the denominator, not the full Nifty 500
		total_scanned = sum(1 for r in rows if r["symbol"] in fno)

	elif scan_type == "Intraday Short":
		# Mirror of "Intraday Momentum" — needs the last ~25 daily candles per
		# symbol to measure today's drop, closing weakness, and 20-day volume baseline.
		all_syms = [r["symbol"] for r in rows]
		candles_by_sym = _vcp_candles_for_symbols(all_syms, target)
		row_by_sym = {r["symbol"]: r for r in rows}
		for sym, candles in candles_by_sym.items():
			r = row_by_sym.get(sym)
			if not r or len(candles) < 22:
				continue
			ish = _detect_intraday_short(candles, r)
			if ish.get("is_short"):
				ev = _evaluate_trend_template_from_snapshot(r)
				results.append({
					"symbol": sym,
					"company_name": companies.get(sym, sym),
					"current_price": flt(r["close_price"]),
					"passed_count": ev["passed"],
					"rs_rating": flt(r.get("rs_rating")),
					"pct_from_52w_high": flt(r.get("pct_from_52w_high")),
					"pct_above_52w_low": flt(r.get("pct_above_52w_low")),
					# Repurpose vcp_tightness as today's % change (negative for shorts)
					"vcp_tightness": flt(ish.get("change_pct")),
					"criteria_json": json.dumps(
						{"intraday_short": ish, "trend_template_passed": ev["passed"], "industry": r.get("industry") or ""},
						default=str,
					),
				})
		# Heaviest volume + weakest close + biggest drop first
		def _is_sort_key(x):
			try:
				ish = json.loads(x["criteria_json"]).get("intraday_short", {})
				return (-flt(ish.get("vol_ratio_20d") or 0), flt(ish.get("close_strength") or 0), x["vcp_tightness"])
			except Exception:
				return (0, 0, x["vcp_tightness"])
		results.sort(key=_is_sort_key)

	return {
		"ok": True,
		"results": results,
		"total_scanned": total_scanned,
		"snapshot_date": target.isoformat(),
	}


# ─────────────────────── main scan loop (snapshot-backed) ───────────────────────

def _scan(run_name: str, scan_type: str):
	"""Sub-second worker. Reads pre-computed snapshots from DB, applies filter, saves."""
	doc = frappe.get_doc("Screener Run", run_name)
	doc.status = "Running"
	doc.run_at = now_datetime()
	doc.error_message = ""
	doc.progress_message = "Querying snapshots…"
	doc.save(ignore_permissions=True)
	frappe.db.commit()

	try:
		out = run_scan_from_snapshot(scan_type)
		if not out.get("ok"):
			raise RuntimeError(out.get("error") or "Snapshot query failed")
		results = out["results"]

		doc.reload()
		doc.results = []
		for row in results:
			doc.append("results", row)
		doc.total_scanned = out["total_scanned"]
		if scan_type == "Trend Template":
			doc.passed_count = sum(1 for r in results if r["passed_count"] == 8)
		else:
			doc.passed_count = len(results)
		doc.universe = f"Nifty 500 ({out['snapshot_date']})"
		doc.status = "Completed"
		doc.completed_at = now_datetime()
		doc.progress_message = f"Done. {doc.passed_count} symbols passed."
		doc.save(ignore_permissions=True)
		frappe.db.commit()
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Screener Run {run_name} failed")
		doc.reload()
		doc.status = "Failed"
		doc.error_message = str(e) + "\n\n" + frappe.get_traceback()[:5000]
		doc.completed_at = now_datetime()
		doc.save(ignore_permissions=True)
		frappe.db.commit()


# ─────────────────────── public entry points ───────────────────────

ALL_SCAN_TYPES = (
	"Trend Template", "VCP", "Turnaround",
	"Rocket Base", "Intraday Momentum", "FnO Momentum",
	"Intraday Short",
)


def _evaluate_for_scan_type(scan_type: str, sym: str, h: dict, rs) -> dict:
	"""Apply one scan_type's filter to a single symbol with already-fetched data.

	Returns the result row if the symbol passes, else None.
	"""
	ind = h["ind"]
	if scan_type == "Trend Template":
		ev = evaluate_trend_template(ind, rs)
		if ev["passed"] >= 6:
			return {
				"symbol": sym,
				"company_name": h["row"]["company_name"],
				"current_price": flt(ind.get("price")),
				"passed_count": ev["passed"],
				"rs_rating": flt(rs) if rs is not None else 0,
				"pct_from_52w_high": flt(ind.get("pct_from_52w_high")),
				"pct_above_52w_low": flt(ind.get("pct_above_52w_low")),
				"vcp_tightness": 0,
				"criteria_json": json.dumps(
					{"trend_template": ev["criteria"], "all_pass": ev["all_pass"]},
					default=str,
				),
			}
	elif scan_type == "VCP":
		v = detect_vcp(h["candles"], ind)
		if v.get("is_vcp"):
			ev = evaluate_trend_template(ind, rs)
			return {
				"symbol": sym,
				"company_name": h["row"]["company_name"],
				"current_price": flt(ind.get("price")),
				"passed_count": ev["passed"],
				"rs_rating": flt(rs) if rs is not None else 0,
				"pct_from_52w_high": flt(ind.get("pct_from_52w_high")),
				"pct_above_52w_low": flt(ind.get("pct_above_52w_low")),
				"vcp_tightness": flt(v.get("final_contraction_pct")),
				"criteria_json": json.dumps(
					{"vcp": v, "trend_template_passed": ev["passed"]},
					default=str,
				),
			}
	return None


def _persist_results(run_name: str, scan_type: str, results: list, total_scanned: int):
	"""Write the result rows + completion status to a Screener Run doc."""
	if scan_type == "VCP":
		results.sort(key=lambda r: (r["vcp_tightness"], -r["rs_rating"]))
	elif scan_type == "Turnaround":
		# Strongest recent-quarter recovery first
		results.sort(key=lambda r: (-r["vcp_tightness"], -r["rs_rating"]))
	else:
		results.sort(key=lambda r: (-r["passed_count"], -r["rs_rating"]))

	doc = frappe.get_doc("Screener Run", run_name)
	doc.results = []
	for row in results:
		doc.append("results", row)
	doc.total_scanned = total_scanned
	if scan_type == "Trend Template":
		doc.passed_count = sum(1 for r in results if r["passed_count"] == 8)
	else:
		doc.passed_count = len(results)
	doc.status = "Completed"
	doc.completed_at = now_datetime()
	doc.progress_message = f"Done. {doc.passed_count} symbols passed."
	doc.save(ignore_permissions=True)
	frappe.db.commit()


def _scan_all(run_names: dict):
	"""Snapshot-backed worker — runs all 3 scans against the same DB query.

	Total time: <2 seconds (was 5-10 min when fetching from Yahoo).
	"""
	for st, rn in run_names.items():
		try:
			frappe.db.set_value("Screener Run", rn, {
				"status": "Running",
				"run_at": now_datetime(),
				"error_message": "",
				"progress_message": "Querying snapshots…",
			}, update_modified=False)
		except Exception:
			pass
	frappe.db.commit()

	try:
		for scan_type, run_name in run_names.items():
			out = run_scan_from_snapshot(scan_type)
			if not out.get("ok"):
				raise RuntimeError(f"{scan_type}: {out.get('error')}")
			_persist_results(run_name, scan_type, out["results"], out["total_scanned"])

		try:
			from trading_journal.trading_journal.utils import telegram
			telegram.send_daily_digest()
		except Exception:
			frappe.log_error(frappe.get_traceback(), "Telegram digest after scan_all failed")
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Screener Scan-All failed")
		err = str(e) + "\n\n" + frappe.get_traceback()[:5000]
		for rn in run_names.values():
			try:
				doc = frappe.get_doc("Screener Run", rn)
				if doc.status != "Completed":
					doc.status = "Failed"
					doc.error_message = err
					doc.completed_at = now_datetime()
					doc.save(ignore_permissions=True)
			except Exception:
				pass
		frappe.db.commit()


@frappe.whitelist()
def start_all_scans() -> dict:
	"""Queue a single worker that runs all 3 scans sharing fetched data.

	Creates one Screener Run doc per scan_type up front so the existing
	pages can poll progress as usual.
	"""
	run_names = {}
	for st in ALL_SCAN_TYPES:
		doc = frappe.new_doc("Screener Run")
		doc.scan_type = st
		doc.status = "Queued"
		doc.universe = "Nifty 500"
		doc.run_at = now_datetime()
		doc.insert(ignore_permissions=True)
		run_names[st] = doc.name
	frappe.db.commit()

	frappe.enqueue(
		"trading_journal.trading_journal.utils.screener._scan_all",
		queue="long",
		timeout=3600,
		run_names=run_names,
		now=False,
	)
	return {"ok": True, "run_names": run_names}


def scheduled_daily_scan_all():
	"""Cron entry point — runs all 3 scans daily at the configured time."""
	try:
		start_all_scans()
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Screener Daily Cron Failed")


@frappe.whitelist()
def start_scan(scan_type: str = "Trend Template") -> dict:
	"""Create a Screener Run and queue the worker. Returns the run name."""
	if scan_type not in ALL_SCAN_TYPES:
		return {"ok": False, "error": f"Unknown scan_type: {scan_type}"}
	doc = frappe.new_doc("Screener Run")
	doc.scan_type = scan_type
	doc.status = "Queued"
	doc.universe = "Nifty 500"
	doc.run_at = now_datetime()
	doc.insert(ignore_permissions=True)
	frappe.db.commit()

	frappe.enqueue(
		"trading_journal.trading_journal.utils.screener._scan",
		queue="long",
		timeout=1800,
		run_name=doc.name,
		scan_type=scan_type,
		now=False,
	)
	return {"ok": True, "run_name": doc.name, "scan_type": scan_type}


@frappe.whitelist()
def refresh_snapshot_now(force: int = 1) -> dict:
	"""Queue the snapshot refresh as a background job so the UI doesn't freeze.

	Returns immediately; UI polls snapshot_status() to know when it's done.
	"""
	frappe.cache().set_value("tj:snap_refresh:status", json.dumps({
		"running": True,
		"started_at": now_datetime().isoformat(),
		"message": "Queued — fetching NSE bhavcopy…",
		"result": None,
	}), expires_in_sec=3600)
	frappe.enqueue(
		"trading_journal.trading_journal.utils.screener._do_refresh_snapshot",
		queue="long", timeout=1800, force=force, now=False,
	)
	return {"ok": True, "queued": True}


def _do_refresh_snapshot(force: int = 1):
	from trading_journal.trading_journal.utils import snapshot
	cache = frappe.cache()
	try:
		result = snapshot.refresh_daily_snapshot(force=force)
		cache.set_value("tj:snap_refresh:status", json.dumps({
			"running": False,
			"finished_at": now_datetime().isoformat(),
			"message": "Done" if result.get("ok") else f"Failed: {result.get('error')}",
			"result": result,
		}), expires_in_sec=3600)
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Snapshot refresh failed")
		cache.set_value("tj:snap_refresh:status", json.dumps({
			"running": False,
			"finished_at": now_datetime().isoformat(),
			"message": f"Failed: {e}",
			"result": {"ok": False, "error": str(e)},
		}), expires_in_sec=3600)


@frappe.whitelist()
def snapshot_status() -> dict:
	"""Return the current refresh status + the latest snapshot date in DB."""
	from trading_journal.trading_journal.utils import snapshot
	cache_status = frappe.cache().get_value("tj:snap_refresh:status")
	latest = snapshot.latest_snapshot_date()
	parsed = {}
	if cache_status:
		try:
			parsed = json.loads(cache_status)
		except Exception:
			parsed = {}
	return {
		"ok": True,
		"latest_snapshot_date": latest.isoformat() if latest else None,
		"refresh": parsed,
	}


def _industry_lookup() -> dict:
	"""{symbol: industry} from the cached Nifty 500 universe."""
	return {row["symbol"]: (row.get("industry") or "") for row in get_nifty500_symbols()}


@frappe.whitelist()
def _patch_workspace_add_tiles(tiles_json: str = None) -> dict:
	"""Add Quick Access shortcut tiles to the Trading Journal workspace.

	`tiles_json` is a JSON list of {id, shortcut_name} dicts. Idempotent.
	"""
	import json as _json
	default_tiles = [
		{"id": "sc_earnings_calendar", "shortcut_name": "Earnings Calendar"},
		{"id": "sc_screener_backtest", "shortcut_name": "Screener Backtest"},
	]
	tiles = _json.loads(tiles_json) if tiles_json else default_tiles
	content = frappe.db.get_value("Workspace", "Trading Journal", "content") or "[]"
	blocks = _json.loads(content)
	existing = {(b.get("data") or {}).get("shortcut_name") for b in blocks if b.get("type") == "shortcut"}
	to_add = [t for t in tiles if t["shortcut_name"] not in existing]
	if not to_add:
		return {"ok": True, "added": 0, "message": "all tiles already present"}
	insert_at = next((i for i, b in enumerate(blocks) if b.get("type") == "spacer"), len(blocks))
	for t in reversed(to_add):
		blocks.insert(insert_at, {
			"id": t["id"],
			"type": "shortcut",
			"data": {"shortcut_name": t["shortcut_name"], "col": 4},
		})
	frappe.db.sql(
		"UPDATE `tabWorkspace` SET content = %s WHERE name = %s",
		(_json.dumps(blocks), "Trading Journal"),
	)
	frappe.db.commit()
	return {"ok": True, "added": len(to_add), "tiles": [t["shortcut_name"] for t in to_add]}


@frappe.whitelist()
def get_run_status(run_name: str) -> dict:
	"""Polled by the page to show progress.

	Each result row gets a top-level `industry` field — looked up from the
	cached Nifty 500 universe map. This means OLD scan results (saved before
	we added industry) still get sectors retroactively.
	"""
	doc = frappe.get_doc("Screener Run", run_name)
	ind_map = _industry_lookup()
	return {
		"ok": True,
		"name": doc.name,
		"status": doc.status,
		"progress": doc.progress_message or "",
		"error": doc.error_message or "",
		"total_scanned": doc.total_scanned or 0,
		"passed_count": doc.passed_count or 0,
		"started_at": str(doc.run_at) if doc.run_at else "",
		"completed_at": str(doc.completed_at) if doc.completed_at else "",
		"results": [
			{
				"symbol": r.symbol,
				"company_name": r.company_name,
				"current_price": flt(r.current_price),
				"passed_count": r.passed_count,
				"rs_rating": flt(r.rs_rating),
				"pct_from_52w_high": flt(r.pct_from_52w_high),
				"pct_above_52w_low": flt(r.pct_above_52w_low),
				"vcp_tightness": flt(r.vcp_tightness),
				"criteria_json": r.criteria_json or "{}",
				"industry": ind_map.get(r.symbol, ""),
			}
			for r in (doc.results or [])
		],
	}


@frappe.whitelist()
def get_chart_data(symbol: str, exchange: str = "NSE", days: int = 180, force: int = 0) -> dict:
	"""Daily OHLC candles for the chart-popup.

	Reads from `Stock Daily Snapshot` (canonical NSE bhavcopy data). Falls
	back to Yahoo only for symbols not in our universe (e.g. non-Nifty 500
	or BSE-only). Snapshot is updated at 7 AM IST or by the user via
	"Refresh Snapshot" — so the latest bar always reflects what bhavcopy has.
	"""
	if not symbol:
		return {"ok": False, "error": "No symbol"}
	symbol = symbol.strip().upper()
	exchange = (exchange or "NSE").upper()
	days = max(20, min(int(days or 180), 500))

	from datetime import datetime as _dt, timezone as _tz, timedelta as _td
	ist_now = _dt.now(_tz(_td(hours=5, minutes=30)))
	ist_today = ist_now.date().isoformat()
	cache = frappe.cache()
	key = f"tj:chartdata:{exchange}:{symbol}:{days}:{ist_today}"
	if not int(force or 0):
		cached = cache.get_value(key)
		if cached:
			try:
				return json.loads(cached)
			except Exception:
				pass

	# Try snapshot table first
	snap_rows = frappe.db.sql(
		"""
		SELECT UNIX_TIMESTAMP(date) AS t, open_price, high_price, low_price, close_price, volume
		FROM `tabStock Daily Snapshot`
		WHERE symbol = %s
		ORDER BY date DESC
		LIMIT %s
		""",
		(symbol, days),
		as_dict=True,
	)
	if snap_rows:
		# We pulled DESC; reverse to ascending for the chart
		snap_rows.reverse()
		candles = [
			{
				"time": int(r["t"]),
				"open": flt(r["open_price"]),
				"high": flt(r["high_price"]),
				"low": flt(r["low_price"]),
				"close": flt(r["close_price"]),
				"volume": int(r["volume"] or 0),
			}
			for r in snap_rows
		]
		latest_date = _dt.fromtimestamp(candles[-1]["time"]).date().isoformat() if candles else None
		out = {
			"ok": True,
			"symbol": symbol,
			"exchange": exchange,
			"source": "snapshot",
			"latest_bar_date": latest_date,
			"candles": candles,
			"as_of": ist_now.isoformat(),
		}
		cache.set_value(key, json.dumps(out), expires_in_sec=300)
		return out

	# Fallback: Yahoo (for non-Nifty 500 symbols)
	h = fetch_history(symbol, exchange=exchange, days=days)
	if not h.get("ok"):
		return {"ok": False, "error": h.get("error") or "Could not fetch history"}
	candles = h.get("candles") or []
	out = {
		"ok": True,
		"symbol": symbol,
		"exchange": exchange,
		"yahoo_symbol": h.get("yahoo_symbol"),
		"source": "yahoo",
		"candles": [
			{"time": c["t"], "open": c["o"], "high": c["h"], "low": c["l"], "close": c["c"], "volume": c["v"]}
			for c in candles
		],
		"as_of": ist_now.isoformat(),
	}
	cache.set_value(key, json.dumps(out), expires_in_sec=300)
	return out


@frappe.whitelist()
def latest_run(scan_type: str = "Trend Template") -> dict:
	"""Most recent Completed run for that scan_type — used to render the page on first open."""
	rows = frappe.get_all(
		"Screener Run",
		filters={"scan_type": scan_type, "status": "Completed"},
		fields=["name"],
		order_by="completed_at desc",
		limit=1,
	)
	if not rows:
		return {"ok": True, "run_name": None}
	return get_run_status(rows[0].name)
