"""Sector rotation heatmap — snapshot-backed with RRG-style momentum classification.

Per-sector returns (1W/1M/3M/6M), momentum delta (this week vs last week),
rotation score (weighted composite), and quadrant classification for
the Relative Rotation Graph style display.
"""

import json

import frappe
from frappe.utils import flt, now_datetime

CACHE_KEY = "tj:sector_heatmap"
CACHE_SECONDS = 1800  # 30 min

WINDOWS = {"1W": 5, "1M": 22, "3M": 66, "6M": 132}


@frappe.whitelist()
def compute_heatmap(force: int = 0) -> dict:
	"""Aggregate per-sector returns from Stock Daily Snapshot.

	Adds momentum_delta (this week vs prior week), rotation_score (weighted
	composite of all windows), and quadrant (Leading/Weakening/Improving/Lagging).
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

	from datetime import timedelta
	earliest_lookback = target - timedelta(days=210)  # need 132 + 11 extra for prior-week momentum

	rows = frappe.db.sql(
		"""
		SELECT symbol, date, close_price, industry
		FROM `tabStock Daily Snapshot`
		WHERE date >= %s AND date <= %s AND is_nifty500 = 1
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

		# Prior-week return (T-10 to T-5) for momentum delta
		if len(closes) > 10 and closes[-6] and closes[-11]:
			rets["prior_1W"] = round((closes[-6] / closes[-11] - 1) * 100, 2)
		else:
			rets["prior_1W"] = None

		per_sym_rets[sym] = rets

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

		# Momentum delta: this week's 1W return minus last week's 1W return
		delta_vals = []
		for _, r in items:
			if r.get("1W") is not None and r.get("prior_1W") is not None:
				delta_vals.append(r["1W"] - r["prior_1W"])
		entry["momentum_delta"] = round(sum(delta_vals) / len(delta_vals), 2) if delta_vals else None

		# Weighted rotation score: recent weeks weighted more
		r1w = entry.get("ret_1W") or 0
		r1m = entry.get("ret_1M") or 0
		r3m = entry.get("ret_3M") or 0
		r6m = entry.get("ret_6M") or 0
		none_count = sum(1 for v in [entry.get("ret_1W"), entry.get("ret_1M"), entry.get("ret_3M"), entry.get("ret_6M")] if v is None)
		if none_count < 4:
			entry["rotation_score"] = round(0.40 * r1w + 0.35 * r1m + 0.15 * r3m + 0.10 * r6m, 2)
		else:
			entry["rotation_score"] = None

		# Top 3 by 1M return
		ranked = sorted(items, key=lambda t: -(t[1].get("1M") or -999))[:5]
		entry["top_5_1m"] = [{"symbol": s, "ret_1M": r.get("1M")} for s, r in ranked]

		# Legacy key for backwards compat
		entry["top_3_1m"] = entry["top_5_1m"][:3]

		sectors.append(entry)

	# Quadrant classification based on rotation_score and momentum_delta
	# Leading: strong + improving, Weakening: strong + fading,
	# Improving: weak + recovering, Lagging: weak + still falling
	for s in sectors:
		score = s.get("rotation_score")
		delta = s.get("momentum_delta")
		if score is None or delta is None:
			s["quadrant"] = "Unknown"
		elif score >= 0 and delta >= 0:
			s["quadrant"] = "Leading"
		elif score >= 0 and delta < 0:
			s["quadrant"] = "Weakening"
		elif score < 0 and delta >= 0:
			s["quadrant"] = "Improving"
		else:
			s["quadrant"] = "Lagging"

	sectors.sort(key=lambda s: -(s.get("rotation_score") or -999))

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
