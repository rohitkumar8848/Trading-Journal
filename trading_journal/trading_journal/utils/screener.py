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


# ─────────────────────── Tight 1-month consolidation ───────────────────────

def detect_tight_consolidation(candles: list, ind: dict, window_days: int = 22) -> dict:
	"""Find symbols trading in a narrow range for the past month.

	Definition (defaults — tunable):
	  - Last `window_days` (~22 trading days = 1 month) range
	  - (high - low) / mid < 8%   (tight)
	  - Recent 10-bar avg volume < prior 30-bar avg (volume dry-up)
	  - Price > 50-SMA AND 50-SMA > 200-SMA (clean uptrend, not a downtrend pause)
	"""
	if len(candles) < max(window_days + 5, 60):
		return {"is_tight": False, "reason": "not enough history"}

	w = candles[-window_days:]
	highs = [c["h"] for c in w]
	lows = [c["l"] for c in w]
	closes = [c["c"] for c in w]
	hi = max(highs)
	lo = min(lows)
	mid = (hi + lo) / 2 if (hi + lo) > 0 else 0
	if mid <= 0:
		return {"is_tight": False, "reason": "bad price data"}
	range_pct = (hi - lo) / mid * 100

	# How far the latest close is from the top of the range (< 5% = breakout-ready)
	last = closes[-1]
	dist_from_high_pct = (hi - last) / hi * 100 if hi else 0

	# Volume dry-up: last 10 bars vs prior 20 bars within the window
	vols = [c["v"] for c in candles[-(window_days + 20):]]
	avg_recent = sum(vols[-10:]) / 10 if len(vols) >= 10 else 0
	avg_earlier = sum(vols[:-10]) / max(len(vols) - 10, 1) if len(vols) > 10 else 0
	vol_dry = avg_recent < avg_earlier if avg_earlier else False
	vol_ratio = (avg_recent / avg_earlier) if avg_earlier else 0

	# Trend filter — a "tight base" inside a downtrend is just a pause; we want uptrends
	price = ind.get("price") or last
	sma50 = ind.get("sma50")
	sma200 = ind.get("sma200")
	above_50 = bool(price and sma50 and price > sma50)
	stack_50_200 = bool(sma50 and sma200 and sma50 > sma200)

	tight_range = range_pct <= 8
	near_top = dist_from_high_pct <= 5
	is_tight = tight_range and near_top and above_50 and stack_50_200

	return {
		"is_tight": bool(is_tight),
		"window_days": window_days,
		"range_pct": round(range_pct, 2),
		"range_high": round(hi, 2),
		"range_low": round(lo, 2),
		"distance_from_range_high_pct": round(dist_from_high_pct, 2),
		"volume_dry_up": vol_dry,
		"volume_ratio": round(vol_ratio, 2),
		"price_above_50sma": above_50,
		"sma50_above_sma200": stack_50_200,
		"reason": (
			"tight 1-month base near range high in uptrend" if is_tight
			else (
				"range too wide" if not tight_range
				else "below 50 SMA" if not above_50
				else "50 SMA below 200 SMA (downtrend)" if not stack_50_200
				else "not near range high"
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


def _detect_near_52w_high_from_snapshot(row: dict, max_distance_pct: float = 20.0) -> dict:
	"""Symbols within `max_distance_pct` of their 52-week high, in an uptrend.

	Excludes falling knives by requiring price > 50-SMA AND 50 > 200-SMA.
	"""
	price = flt(row.get("close_price"))
	hi52 = flt(row.get("high_52w"))
	pct_from_high = flt(row.get("pct_from_52w_high"))  # negative or 0
	sma50 = row.get("sma50")
	sma200 = row.get("sma200")
	above_50 = bool(price and sma50 and price > sma50)
	stack = bool(sma50 and sma200 and sma50 > sma200)
	in_range = pct_from_high >= -float(max_distance_pct)
	is_near = in_range and above_50 and stack

	# Days since the 52w high — bonus filter only used for sort tie-break, not enforced
	return {
		"is_near_high": bool(is_near),
		"high_52w": round(hi52, 2),
		"distance_from_high_pct": round(abs(pct_from_high), 2),
		"max_distance_pct": float(max_distance_pct),
		"price_above_50sma": above_50,
		"sma50_above_sma200": stack,
		"reason": (
			"within range of 52w high in uptrend" if is_near
			else (
				f"too far from 52w high (>{max_distance_pct}%)" if not in_range
				else "below 50 SMA" if not above_50
				else "50 SMA below 200 SMA (downtrend)"
			)
		),
	}


def _detect_tight_from_snapshot(row: dict) -> dict:
	"""Tight 1-month consolidation directly from snapshot columns."""
	price = flt(row.get("close_price"))
	sma50 = row.get("sma50")
	sma200 = row.get("sma200")
	r_pct = flt(row.get("range_22d_pct"))
	r_hi = flt(row.get("range_22d_high"))
	dist_from_high = (r_hi - price) / r_hi * 100 if r_hi else 0
	vol_ratio = flt(row.get("vol_ratio_10_20"))
	above_50 = bool(price and sma50 and price > sma50)
	stack = bool(sma50 and sma200 and sma50 > sma200)
	is_tight = (r_pct and r_pct <= 8) and (dist_from_high <= 5) and above_50 and stack
	return {
		"is_tight": bool(is_tight),
		"window_days": 22,
		"range_pct": round(r_pct, 2),
		"range_high": round(r_hi, 2),
		"range_low": round(flt(row.get("range_22d_low")), 2),
		"distance_from_range_high_pct": round(dist_from_high, 2),
		"volume_ratio": round(vol_ratio, 2),
		"volume_dry_up": vol_ratio < 1 if vol_ratio else False,
		"price_above_50sma": above_50,
		"sma50_above_sma200": stack,
		"reason": (
			"tight 1-month base near range high in uptrend" if is_tight
			else (
				"range too wide" if (not r_pct or r_pct > 8)
				else "below 50 SMA" if not above_50
				else "50 SMA below 200 SMA (downtrend)" if not stack
				else "not near range high"
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

	elif scan_type == "Tight Consolidation":
		for r in rows:
			t = _detect_tight_from_snapshot(r)
			if t.get("is_tight"):
				ev = _evaluate_trend_template_from_snapshot(r)
				results.append({
					"symbol": r["symbol"],
					"company_name": companies.get(r["symbol"], r["symbol"]),
					"current_price": flt(r["close_price"]),
					"passed_count": ev["passed"],
					"rs_rating": flt(r.get("rs_rating")),
					"pct_from_52w_high": flt(r.get("pct_from_52w_high")),
					"pct_above_52w_low": flt(r.get("pct_above_52w_low")),
					"vcp_tightness": flt(t.get("range_pct")),
					"criteria_json": json.dumps(
						{"tight_consolidation": t, "trend_template_passed": ev["passed"], "industry": r.get("industry") or ""},
						default=str,
					),
				})
		results.sort(key=lambda x: (x["vcp_tightness"], -x["rs_rating"]))

	elif scan_type == "Near 52w High":
		for r in rows:
			n = _detect_near_52w_high_from_snapshot(r, max_distance_pct=20.0)
			if n.get("is_near_high"):
				ev = _evaluate_trend_template_from_snapshot(r)
				results.append({
					"symbol": r["symbol"],
					"company_name": companies.get(r["symbol"], r["symbol"]),
					"current_price": flt(r["close_price"]),
					"passed_count": ev["passed"],
					"rs_rating": flt(r.get("rs_rating")),
					"pct_from_52w_high": flt(r.get("pct_from_52w_high")),
					"pct_above_52w_low": flt(r.get("pct_above_52w_low")),
					"vcp_tightness": flt(n.get("distance_from_high_pct")),
					"criteria_json": json.dumps(
						{"near_52w_high": n, "trend_template_passed": ev["passed"], "industry": r.get("industry") or ""},
						default=str,
					),
				})
		# Sort: closest to 52w high first, then by RS
		results.sort(key=lambda x: (x["vcp_tightness"], -x["rs_rating"]))

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

ALL_SCAN_TYPES = ("Trend Template", "VCP", "Tight Consolidation", "Near 52w High")


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
	elif scan_type == "Tight Consolidation":
		t = detect_tight_consolidation(h["candles"], ind, window_days=22)
		if t.get("is_tight"):
			ev = evaluate_trend_template(ind, rs)
			return {
				"symbol": sym,
				"company_name": h["row"]["company_name"],
				"current_price": flt(ind.get("price")),
				"passed_count": ev["passed"],
				"rs_rating": flt(rs) if rs is not None else 0,
				"pct_from_52w_high": flt(ind.get("pct_from_52w_high")),
				"pct_above_52w_low": flt(ind.get("pct_above_52w_low")),
				"vcp_tightness": flt(t.get("range_pct")),
				"criteria_json": json.dumps(
					{"tight_consolidation": t, "trend_template_passed": ev["passed"]},
					default=str,
				),
			}
	return None


def _persist_results(run_name: str, scan_type: str, results: list, total_scanned: int):
	"""Write the result rows + completion status to a Screener Run doc."""
	if scan_type in ("VCP", "Tight Consolidation"):
		results.sort(key=lambda r: (r["vcp_tightness"], -r["rs_rating"]))
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
def get_chart_data(symbol: str, exchange: str = "NSE", days: int = 180) -> dict:
	"""Daily OHLC candles for the chart-popup. Cached 30 min per symbol.

	Returns timestamps in seconds (Lightweight Charts format).
	"""
	if not symbol:
		return {"ok": False, "error": "No symbol"}
	symbol = symbol.strip().upper()
	exchange = (exchange or "NSE").upper()
	days = max(20, min(int(days or 180), 500))

	cache = frappe.cache()
	key = f"tj:chartdata:{exchange}:{symbol}:{days}"
	cached = cache.get_value(key)
	if cached:
		try:
			return json.loads(cached)
		except Exception:
			pass

	h = fetch_history(symbol, exchange=exchange, days=days)
	if not h.get("ok"):
		return {"ok": False, "error": h.get("error") or "Could not fetch history"}
	candles = h.get("candles") or []
	out = {
		"ok": True,
		"symbol": symbol,
		"exchange": exchange,
		"yahoo_symbol": h.get("yahoo_symbol"),
		"candles": [
			{"time": c["t"], "open": c["o"], "high": c["h"], "low": c["l"], "close": c["c"], "volume": c["v"]}
			for c in candles
		],
	}
	cache.set_value(key, json.dumps(out), expires_in_sec=1800)
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
