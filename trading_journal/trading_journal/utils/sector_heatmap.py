"""Sector rotation heatmap — now snapshot-backed (sub-second).

For every Nifty 500 industry, computes the average constituent return
over multiple windows (1W, 1M, 3M, 6M) using already-stored daily snapshots.
"""

import json

import frappe
from frappe.utils import flt, now_datetime

CACHE_KEY = "tj:sector_heatmap"
CACHE_SECONDS = 1800  # 30 min — re-runs cheap so keep it fresh

WINDOWS = {"1W": 5, "1M": 22, "3M": 66, "6M": 132}


@frappe.whitelist()
def compute_heatmap(force: int = 0) -> dict:
	"""Aggregate per-sector returns from Stock Daily Snapshot.

	Sub-second now — pulls one row per (symbol, look-back-date) instead of fetching from Yahoo.
	"""
	from trading_journal.trading_journal.utils import snapshot

	cache = frappe.cache()
	if not int(force or 0):
		cached = cache.get_value(CACHE_KEY)
		if cached:
			try:
				return json.loads(cached)
			except Exception:
				pass

	target = snapshot.latest_snapshot_date()
	if not target:
		return {"ok": False, "error": "No snapshots in DB. Run Refresh Snapshot first.", "sectors": []}

	# Pull every (symbol, date) close in one query for the look-back window
	from datetime import timedelta
	earliest_lookback = target - timedelta(days=200)  # ~132 trading days = 6 months

	rows = frappe.db.sql(
		"""
		SELECT symbol, date, close_price, industry
		FROM `tabStock Daily Snapshot`
		WHERE date >= %s AND date <= %s
		ORDER BY symbol, date
		""",
		(earliest_lookback.isoformat(), target.isoformat()),
		as_dict=True,
	)
	by_sym = {}
	industries = {}
	for r in rows:
		by_sym.setdefault(r["symbol"], []).append(flt(r["close_price"]))
		if r.get("industry"):
			industries[r["symbol"]] = r["industry"]

	# Per-symbol returns over each window
	per_sym_rets = {}
	for sym, closes in by_sym.items():
		if not closes:
			continue
		last = closes[-1]
		rets = {}
		for label, days in WINDOWS.items():
			if len(closes) <= days:
				rets[label] = None
				continue
			past = closes[-days - 1]
			rets[label] = round((last / past - 1) * 100, 2) if past else None
		per_sym_rets[sym] = rets

	# Group by industry, average
	by_ind = {}
	for sym, rets in per_sym_rets.items():
		ind = industries.get(sym, "Other") or "Other"
		by_ind.setdefault(ind, []).append((sym, rets))

	sectors = []
	for ind_name, items in by_ind.items():
		entry = {"industry": ind_name, "count": len(items)}
		for label in WINDOWS:
			vals = [r[label] for _, r in items if r.get(label) is not None]
			entry[f"ret_{label}"] = round(sum(vals) / len(vals), 2) if vals else None
		# Top 3 by 1M
		ranked = sorted(items, key=lambda t: -(t[1].get("1M") or -999))[:3]
		entry["top_3_1m"] = [{"symbol": s, "ret_1M": r.get("1M")} for s, r in ranked]
		sectors.append(entry)

	sectors.sort(key=lambda s: -(s.get("ret_1M") or -999))
	out = {
		"ok": True,
		"as_of": now_datetime().isoformat(),
		"snapshot_date": target.isoformat(),
		"sectors": sectors,
		"total_symbols": len(per_sym_rets),
	}
	cache.set_value(CACHE_KEY, json.dumps(out), expires_in_sec=CACHE_SECONDS)
	return out


@frappe.whitelist()
def get_cached_heatmap() -> dict:
	cache = frappe.cache()
	cached = cache.get_value(CACHE_KEY)
	if cached:
		try:
			return json.loads(cached)
		except Exception:
			pass
	return {"ok": True, "sectors": [], "as_of": None}
