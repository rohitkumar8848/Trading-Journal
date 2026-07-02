"""Stock Daily Snapshot pipeline.

  - `bhavcopy_for_date(d)`     — pulls one CSV (~600 KB) with every NSE stock's OHLCV for that date
  - `upsert_ohlcv(date, data)` — bulk-writes today's row for each Nifty 500 symbol
  - `compute_indicators(date)` — recomputes SMAs, 52w, returns, RS rating from snapshots in DB
  - `refresh_daily_snapshot()` — daily entry point (cron + manual)
  - `bootstrap_history()`      — one-time backfill from Yahoo when DB is empty
  - `latest_snapshot_date()`   — used by the screeners to know what date to query

The point of this module: make the screener's job a SQL filter instead of 500 HTTP requests.
"""

import csv
import io
import json
import time
from datetime import date, datetime, timedelta

import frappe
import requests
from frappe.utils import flt, getdate, now_datetime

from trading_journal.trading_journal.utils import screener as screener_mod

# NSE securitywise bhavcopy — full OHLCV for every traded NSE security in one CSV (~600 KB)
NSE_BHAV_URLS = [
	"https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{ddmmyyyy}.csv",
	"https://archives.nseindia.com/products/content/sec_bhavdata_full_{ddmmyyyy}.csv",
]
TIMEOUT = 30
NSE_HEADERS = {
	"User-Agent": (
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
		"AppleWebKit/537.36 (KHTML, like Gecko) "
		"Chrome/124.0.0.0 Safari/537.36"
	),
	"Accept": "text/csv,application/csv,*/*;q=0.9",
	"Accept-Language": "en-US,en;q=0.9",
	"Referer": "https://www.nseindia.com/",
}


# ─────────────────────── bhavcopy fetch ───────────────────────

def _is_market_holiday(d: date) -> bool:
	"""Weekend check. (We don't maintain an Indian holiday calendar; users can re-trigger manually.)"""
	return d.weekday() >= 5


def _previous_trading_day(d: date) -> date:
	"""Walk back until we hit a weekday."""
	while _is_market_holiday(d):
		d -= timedelta(days=1)
	return d


def bhavcopy_for_date(d: date) -> dict:
	"""Download + parse the NSE securitywise bhavcopy for `d`.

	Returns {"ok": True, "rows": {SYMBOL: {open, high, low, close, volume}}, "date": d}
	or {"ok": False, "error": "..."}.
	"""
	d = _previous_trading_day(d)
	ddmmyyyy = d.strftime("%d%m%Y")
	last_err = None
	for url_tpl in NSE_BHAV_URLS:
		url = url_tpl.format(ddmmyyyy=ddmmyyyy)
		try:
			r = requests.get(url, headers=NSE_HEADERS, timeout=TIMEOUT)
			if r.status_code == 404:
				last_err = f"{url}: 404"
				continue
			r.raise_for_status()
			text = r.text
			# NSE columns vary; tolerate spaces in headers
			rows = list(csv.DictReader(io.StringIO(text)))
			
			if not rows:
				last_err = f"{url}: empty CSV"
				continue
			out = {}
			for row in rows:
				# Strip whitespace in keys + values (NSE pads with spaces)
				row = { (k or "").strip(): (v.strip() if isinstance(v, str) else v) for k, v in row.items() }
				series = (row.get("SERIES") or "").upper()
				if series != "EQ":
					continue
				sym = (row.get("SYMBOL") or "").upper()
				if not sym:
					continue
				try:
					out[sym] = {
						"open": float(row.get("OPEN_PRICE") or row.get("OPEN") or 0) or None,
						"high": float(row.get("HIGH_PRICE") or row.get("HIGH") or 0) or None,
						"low": float(row.get("LOW_PRICE") or row.get("LOW") or 0) or None,
						"close": float(row.get("CLOSE_PRICE") or row.get("CLOSE") or 0) or None,
						"volume": int(float(row.get("TTL_TRD_QNTY") or row.get("VOLUME") or 0)),
					}
				except (TypeError, ValueError):
					continue
			if out:
				return {"ok": True, "rows": out, "date": d, "url": url, "count": len(out)}
			last_err = f"{url}: parsed 0 EQ rows"
		except Exception as e:
			
			last_err = f"{url}: {e}"
			continue
	return {"ok": False, "error": last_err or "no source returned data", "date": d}


# ─────────────────────── DB upsert ───────────────────────

def _industry_map() -> dict:
	"""Return {symbol: industry} from the Nifty 500 universe."""
	uni = screener_mod.get_nifty500_symbols()
	return {row["symbol"]: row.get("industry") or "" for row in uni}


def upsert_ohlcv(target_date: date, rows: dict, restrict_to_nifty500: bool = False):
	"""Bulk INSERT … ON DUPLICATE KEY UPDATE for OHLCV columns.

	By default stores ALL NSE EQ stocks from the bhavcopy (restrict_to_nifty500=False).
	Sets is_nifty500=1 for symbols that appear in the Nifty 500 universe.
	"""
	uni = screener_mod.get_nifty500_symbols()
	universe_syms = {r["symbol"]: r.get("industry") or "" for r in uni}
	target_syms = universe_syms.keys() if restrict_to_nifty500 else rows.keys()
	tuples = []
	for sym in target_syms:
		v = rows.get(sym)
		if not v:
			continue
		name = f"SDS-{sym}-{target_date.isoformat()}"
		in_n500 = 1 if sym in universe_syms else 0
		tuples.append((
			name, sym, target_date.isoformat(),
			universe_syms.get(sym, ""),
			in_n500,
			v.get("open"), v.get("high"), v.get("low"), v.get("close"), v.get("volume") or 0,
		))
	if not tuples:
		return 0
	# Chunked inserts (MySQL prepared-stmt parameter limits)
	CHUNK = 200
	now_iso = now_datetime()
	for i in range(0, len(tuples), CHUNK):
		batch = tuples[i:i + CHUNK]
		values_sql = ", ".join(["(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"] * len(batch))
		params = []
		for t in batch:
			params.extend([t[0], now_iso, now_iso, "Administrator", "Administrator", *t[1:]])
		frappe.db.sql(
			f"""
			INSERT INTO `tabStock Daily Snapshot`
				(name, creation, modified, owner, modified_by,
				 symbol, date, industry, is_nifty500,
				 open_price, high_price, low_price, close_price, volume)
			VALUES {values_sql}
			ON DUPLICATE KEY UPDATE
				industry = VALUES(industry),
				is_nifty500 = VALUES(is_nifty500),
				open_price = VALUES(open_price),
				high_price = VALUES(high_price),
				low_price = VALUES(low_price),
				close_price = VALUES(close_price),
				volume = VALUES(volume),
				modified = VALUES(modified)
			""",
			params,
		)
	frappe.db.commit()
	return len(tuples)


# ─────────────────────── indicator computation ───────────────────────

def _percentile_ranks(values: list) -> list:
	"""Same as screener.percentile_ranks but inlined to avoid circular import surprises."""
	indexed = [(i, v) for i, v in enumerate(values) if v is not None]
	if not indexed:
		return [None] * len(values)
	indexed.sort(key=lambda t: t[1])
	n = len(indexed)
	out = [None] * len(values)
	for rank, (orig_i, _) in enumerate(indexed):
		out[orig_i] = round((rank / (n - 1) * 99) if n > 1 else 99, 1)
	return out


def compute_indicators(target_date: date) -> dict:
	"""Recompute SMAs / 52w / returns / RS / 22d window for every Nifty 500 symbol on target_date.

	Reads ~280 trading days of closes from DB, writes back indicator columns to today's row.
	Returns {"updated": N, "skipped": N}.
	"""
	# Pull a wide window of closes (and volumes for the 22d ratio) from DB.
	# Restrict to Nifty 500 — non-Nifty stocks get only raw OHLCV, not indicators.
	cutoff = target_date - timedelta(days=480)
	rows = frappe.db.sql(
		"""
		SELECT symbol, date, close_price, high_price, low_price, volume
		FROM `tabStock Daily Snapshot`
		WHERE date >= %s AND date <= %s AND is_nifty500 = 1
		ORDER BY symbol, date
		""",
		(cutoff.isoformat(), target_date.isoformat()),
		as_dict=True,
	)
	by_sym = {}
	for r in rows:
		by_sym.setdefault(r["symbol"], []).append(r)

	# Compute per symbol
	rs_scores = []
	sym_order = []
	per_sym_ind = {}
	for sym, hist in by_sym.items():
		hist.sort(key=lambda r: r["date"])
		closes = [flt(r["close_price"]) for r in hist if r["close_price"]]
		highs = [flt(r["high_price"]) for r in hist if r["high_price"]]
		lows = [flt(r["low_price"]) for r in hist if r["low_price"]]
		volumes = [int(r["volume"] or 0) for r in hist]
		if len(closes) < 60:
			continue
		last = closes[-1]
		def avg(vals, n, offset=0):
			end = len(vals) - offset
			start = end - n
			if start < 0 or end <= 0:
				return None
			return sum(vals[start:end]) / n

		ind = {
			"sma50": avg(closes, 50),
			"sma150": avg(closes, 150),
			"sma200": avg(closes, 200),
			"sma200_22d_ago": avg(closes, 200, 22),
			"sma200_44d_ago": avg(closes, 200, 44),
		}
		# 52w window — use the matching highs/lows over last 252 bars
		win_hi = highs[-252:] if len(highs) >= 252 else highs
		win_lo = lows[-252:] if len(lows) >= 252 else lows
		if win_hi and win_lo:
			hi52 = max(win_hi)
			lo52 = min(win_lo)
			ind["high_52w"] = hi52
			ind["low_52w"] = lo52
			ind["pct_from_52w_high"] = (last - hi52) / hi52 * 100 if hi52 else 0
			ind["pct_above_52w_low"] = (last - lo52) / lo52 * 100 if lo52 else 0

		# Weighted return for RS (Q1 weighted 2x): 63=3m, 126=6m, 189=9m, 252=12m
		def ret(days):
			if len(closes) <= days:
				return None
			past = closes[-days - 1]
			if not past:
				return None
			return (last / past - 1)

		r3, r6, r9, r12 = ret(63), ret(126), ret(189), ret(252)
		ind["ret_3m"] = round(r3 * 100, 2) if r3 is not None else None
		ind["ret_6m"] = round(r6 * 100, 2) if r6 is not None else None
		ind["ret_9m"] = round(r9 * 100, 2) if r9 is not None else None
		ind["ret_12m"] = round(r12 * 100, 2) if r12 is not None else None
		if all(x is not None for x in (r3, r6, r9, r12)):
			ind["rs_score"] = round(2 * r3 + r6 + r9 + r12, 4)
		else:
			ind["rs_score"] = None

		# 22d range window
		if len(closes) >= 22:
			win_h = highs[-22:]
			win_l = lows[-22:]
			if win_h and win_l:
				w_hi = max(win_h)
				w_lo = min(win_l)
				w_mid = (w_hi + w_lo) / 2
				ind["range_22d_high"] = w_hi
				ind["range_22d_low"] = w_lo
				ind["range_22d_pct"] = (w_hi - w_lo) / w_mid * 100 if w_mid else 0
		# Vol ratio (last 10 vs prior 20)
		vols_50 = volumes[-50:]
		if len(vols_50) >= 30:
			recent = vols_50[-10:]
			earlier = vols_50[:-10]
			avg_recent = sum(recent) / max(len(recent), 1)
			avg_earlier = sum(earlier) / max(len(earlier), 1)
			ind["vol_ratio_10_20"] = round(avg_recent / avg_earlier, 4) if avg_earlier else 0

		per_sym_ind[sym] = ind
		rs_scores.append(ind.get("rs_score"))
		sym_order.append(sym)

	# Percentile-rank RS scores across the universe
	ranks = _percentile_ranks(rs_scores)
	for sym, rank in zip(sym_order, ranks):
		per_sym_ind[sym]["rs_rating"] = rank

	# Bulk update today's snapshot rows. Only set columns that have values
	# (Frappe Float columns default to NOT NULL, so None inputs would error).
	updated = 0
	for sym, ind in per_sym_ind.items():
		valid = {k: v for k, v in ind.items() if v is not None}
		if not valid:
			continue
		cols = list(valid.keys())
		set_clause = ", ".join(f"`{c}` = %s" for c in cols)
		params = [valid[c] for c in cols] + [sym, target_date.isoformat()]
		frappe.db.sql(
			f"""
			UPDATE `tabStock Daily Snapshot`
			SET {set_clause}
			WHERE symbol = %s AND date = %s
			""",
			params,
		)
		updated += 1
	frappe.db.commit()
	return {"updated": updated, "skipped": len(by_sym) - updated, "ranked": sum(1 for r in ranks if r is not None)}


# ─────────────────────── public entry points ───────────────────────

def latest_snapshot_date() -> date:
	"""Most recent date with fully-computed indicators (rs_rating > 0 for at least 50 symbols)."""
	row = frappe.db.sql(
		"""
		SELECT date, COUNT(*) AS c
		FROM `tabStock Daily Snapshot`
		WHERE rs_rating > 0
		GROUP BY date
		HAVING c >= 50
		ORDER BY date DESC
		LIMIT 1
		"""
	)
	if row and row[0] and row[0][0]:
		return getdate(row[0][0])
	# Fall back to the most recent date with ANY rs_rating > 0
	row = frappe.db.sql("SELECT MAX(date) FROM `tabStock Daily Snapshot` WHERE rs_rating > 0")
	if row and row[0] and row[0][0]:
		return getdate(row[0][0])
	return None


def _has_enough_history() -> bool:
	"""True when at least one symbol has 252 snapshot rows."""
	r = frappe.db.sql(
		"SELECT symbol, COUNT(*) AS c FROM `tabStock Daily Snapshot` GROUP BY symbol ORDER BY c DESC LIMIT 1"
	)
	if not r:
		return False
	return r[0][1] >= 252


@frappe.whitelist()
def refresh_daily_snapshot(target_date: str = None, force: int = 0) -> dict:
	"""Daily entry point. Cron at 7 AM IST + manual button.

	1. If history is missing, run bootstrap (one-time, slow).
	2. Download today's bhavcopy.
	3. Upsert OHLCV.
	4. Recompute indicators across the universe.
	"""
	t0 = time.time()
	d = getdate(target_date) if target_date else date.today()
	d = _previous_trading_day(d)

	# Bootstrap path: if we have < 252 days of history we need to backfill from Yahoo first.
	if not _has_enough_history():
		bootstrap_result = bootstrap_history()
		if not bootstrap_result.get("ok"):
			return {"ok": False, "error": "bootstrap failed: " + str(bootstrap_result.get("error"))}

	# Skip if today's snapshot already complete and not forced
	if not int(force or 0):
		row = frappe.db.sql(
			"SELECT COUNT(*) FROM `tabStock Daily Snapshot` WHERE date = %s AND rs_rating IS NOT NULL",
			(d.isoformat(),),
		)
		if row and row[0][0] >= 400:
			return {"ok": True, "skipped": True, "date": d.isoformat(), "rows": row[0][0]}

	bhav = bhavcopy_for_date(d)
	if not bhav.get("ok"):
		return {"ok": False, "error": "bhavcopy failed: " + str(bhav.get("error")), "date": d.isoformat()}
	written = upsert_ohlcv(bhav["date"], bhav["rows"])
	ind_result = compute_indicators(bhav["date"])

	dur = round(time.time() - t0, 1)
	return {
		"ok": True,
		"date": bhav["date"].isoformat(),
		"ohlcv_written": written,
		"indicators_updated": ind_result.get("updated"),
		"ranked": ind_result.get("ranked"),
		"duration_sec": dur,
	}


# ─────────────────────── one-time bootstrap from Yahoo ───────────────────────

def bootstrap_history(days: int = 280) -> dict:
	"""One-time backfill. Pulls last `days` of OHLC for every Nifty 500 symbol from Yahoo.

	Slow (~8-10 min) but only runs the first time. Subsequent days use bhavcopy (one HTTP call).
	"""
	t0 = time.time()
	uni = screener_mod.get_nifty500_symbols()
	industries = {r["symbol"]: r.get("industry") or "" for r in uni}
	total = len(uni)
	added_rows = 0
	failed = 0
	now_iso = now_datetime()

	for i, row in enumerate(uni):
		sym = row["symbol"]
		try:
			h = screener_mod.fetch_history(sym, exchange="NSE", days=days)
		except Exception:
			failed += 1
			continue
		if not h.get("ok"):
			failed += 1
			continue
		candles = h.get("candles") or []
		if not candles:
			continue
		# Build bulk rows for this symbol
		tuples = []
		for c in candles:
			d = datetime.fromtimestamp(int(c["t"])).date()
			name = f"SDS-{sym}-{d.isoformat()}"
			tuples.append((
				name, now_iso, now_iso, "Administrator", "Administrator",
				sym, d.isoformat(), industries.get(sym, ""),
				c.get("o"), c.get("h"), c.get("l"), c.get("c"), int(c.get("v") or 0),
			))
		if not tuples:
			continue
		CHUNK = 200
		for j in range(0, len(tuples), CHUNK):
			batch = tuples[j:j + CHUNK]
			values_sql = ", ".join(["(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"] * len(batch))
			params = []
			for t in batch:
				params.extend(t)
			try:
				frappe.db.sql(
					f"""
					INSERT INTO `tabStock Daily Snapshot`
						(name, creation, modified, owner, modified_by,
						 symbol, date, industry, open_price, high_price, low_price, close_price, volume)
					VALUES {values_sql}
					ON DUPLICATE KEY UPDATE
						close_price = VALUES(close_price),
						volume = VALUES(volume)
					""",
					params,
				)
				added_rows += len(batch)
			except Exception as e:
				frappe.log_error(str(e)[:1000], f"Snapshot bootstrap insert failed for {sym}")
				failed += 1
				break
		# Be polite to Yahoo
		time.sleep(screener_mod.INTER_REQUEST_SLEEP)
		if (i + 1) % 50 == 0:
			frappe.db.commit()

	frappe.db.commit()

	# Compute indicators for the most recent date in the dataset
	row = frappe.db.sql("SELECT MAX(date) FROM `tabStock Daily Snapshot`")
	target = getdate(row[0][0]) if row and row[0][0] else date.today()
	ind = compute_indicators(target)
	return {
		"ok": True,
		"rows": added_rows,
		"failed": failed,
		"computed_for": target.isoformat(),
		"indicators_updated": ind.get("updated"),
		"duration_sec": round(time.time() - t0, 1),
	}


@frappe.whitelist()
def migrate_nifty500_flag() -> dict:
	"""One-time migration: mark all existing snapshot rows as is_nifty500 = 1.

	Safe to re-run — already-correct rows are updated in place with no visible change.
	Call once after running bench migrate to add the is_nifty500 column.
	"""
	frappe.db.sql("UPDATE `tabStock Daily Snapshot` SET is_nifty500 = 1 WHERE is_nifty500 = 0 OR is_nifty500 IS NULL")
	frappe.db.commit()
	cnt = frappe.db.sql("SELECT COUNT(*) FROM `tabStock Daily Snapshot` WHERE is_nifty500 = 1")[0][0]
	return {"ok": True, "marked_nifty500": cnt}


@frappe.whitelist()
def bootstrap_all_nse_history(days: int = 140) -> dict:
	"""Backfill the last `days` trading days of OHLCV for ALL NSE EQ stocks.

	Fetches each historical bhavcopy file from NSE archives (one HTTP call per day).
	Nifty 500 symbols get is_nifty500=1; all others get is_nifty500=0.
	Safe to re-run — ON DUPLICATE KEY UPDATE means no duplicate rows.
	Typical runtime: ~3-5 minutes for 140 days.
	"""
	import time as _time
	t0 = _time.time()

	# Build list of target trading days (walk back, skip weekends)
	today = date.today()
	trading_days = []
	d = today
	while len(trading_days) < int(days):
		d -= timedelta(days=1)
		if not _is_market_holiday(d):
			trading_days.append(d)

	written_total = 0
	failed_days = []
	for td in trading_days:
		bhav = bhavcopy_for_date(td)
		if not bhav.get("ok"):
			failed_days.append(td.isoformat())
			continue
		written = upsert_ohlcv(bhav["date"], bhav["rows"], restrict_to_nifty500=False)
		written_total += written

	return {
		"ok": True,
		"days_fetched": len(trading_days) - len(failed_days),
		"days_failed": len(failed_days),
		"failed_dates": failed_days[:10],
		"rows_written": written_total,
		"duration_sec": round(_time.time() - t0, 1),
	}


# Cron entry — daily at 7:00 AM IST (registered in hooks.py)
def scheduled_daily_snapshot():
	"""Cron entry. Best-effort; logs but does not raise."""
	try:
		refresh_daily_snapshot()
	except Exception:
		frappe.log_error(frappe.get_traceback(), "scheduled_daily_snapshot failed")
