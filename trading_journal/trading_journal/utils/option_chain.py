"""End-of-day option chain analyzer powered by NSE F&O bhavcopy.

Why bhavcopy and not the live option-chain JSON: NSE's Akamai bot management
silently returns `{}` for server-side requests to /api/option-chain-indices —
even with full browser headers / cloudscraper. The bhavcopy ZIP at
nsearchives.nseindia.com isn't behind the same wall, gives us *actual*
day-over-day OI change (better than oi_day_high/low hacks), and ships every
expiry's strikes pre-aggregated. Cost: it's only available after ~6 PM IST
(post market close).

Pipeline:
  1. Resolve the most-recent trading day with a published bhavcopy (try today,
     walk back up to 7 days). Cache the parsed rows for 6 h.
  2. Filter for the selected underlying ticker (NIFTY, BANKNIFTY, …).
  3. Build distinct expiry list; default to the nearest.
  4. Pick ATM ± strike_count strikes around UndrlygPric.
  5. For each strike: emit OI, day OI change, volume, LTP (= ClsPric),
     compute IV from LTP via Newton-Raphson, then greeks.
  6. Tally PCR, max-pain, total CE / PE OI for the headline tiles.
"""

import csv
import io
import zipfile
from collections import defaultdict
from datetime import date as _date, datetime as _datetime, timedelta

import frappe
import requests
from frappe.utils import flt, now_datetime

from trading_journal.trading_journal.utils import option_greeks


BHAVCOPY_URL = (
	"https://nsearchives.nseindia.com/content/fo/"
	"BhavCopy_NSE_FO_0_0_0_{ymd}_F_0000.csv.zip"
)
TIMEOUT = 30
CACHE_KEY = "tj:option_chain:bhavcopy:{ymd}"
CACHE_TTL = 6 * 3600  # bhavcopy is published once per trading day; 6 h is plenty

# Underlying tickers as they appear in the bhavcopy `TckrSymb` column.
UNDERLYINGS = {
	"NIFTY":      {"name": "NIFTY 50",         "tsym": "NIFTY"},
	"BANKNIFTY":  {"name": "NIFTY BANK",       "tsym": "BANKNIFTY"},
	"FINNIFTY":   {"name": "NIFTY FIN SERVICE","tsym": "FINNIFTY"},
	"MIDCPNIFTY": {"name": "NIFTY MID SELECT", "tsym": "MIDCPNIFTY"},
	"NIFTYNXT50": {"name": "NIFTY NEXT 50",    "tsym": "NIFTYNXT50"},
}

RISK_FREE = 0.07
DIV_YIELD = 0.0

# Lot size lookup — only the indices we list. Stocks would need a per-symbol
# lookup against the bhavcopy's NewBrdLotQty.
LOT_SIZE = {
	"NIFTY": 65, "BANKNIFTY": 30, "FINNIFTY": 65,
	"MIDCPNIFTY": 120, "NIFTYNXT50": 25,
}

# Spot-move scenarios for the analyzer matrix.
SPOT_MOVES = [-0.05, -0.03, -0.02, -0.01, 0.0, 0.01, 0.02, 0.03, 0.05]


# ──────────────────────────── bhavcopy fetch + cache ────────────────────────────

def _bhavcopy_for(ymd: str) -> list:
	"""Return parsed rows for the bhavcopy of `YYYYMMDD`, or [] if not published.
	Each row is the CSV dict straight out of the file — keys are NSE's column
	names (TradDt, TckrSymb, XpryDt, StrkPric, OptnTp, ClsPric, OpnIntrst, …).
	"""
	cache = frappe.cache()
	key = CACHE_KEY.format(ymd=ymd)
	cached = cache.get_value(key)
	if cached is not None:
		return cached

	url = BHAVCOPY_URL.format(ymd=ymd)
	r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=TIMEOUT)
	if r.status_code != 200 or len(r.content) < 1000:
		# Not yet published / non-trading day. Negative-cache for 30 min so we
		# don't re-hammer NSE while the user is poking at expiries.
		cache.set_value(key, [], expires_in_sec=1800)
		return []

	try:
		z = zipfile.ZipFile(io.BytesIO(r.content))
	except zipfile.BadZipFile:
		return []
	fname = z.namelist()[0]
	with z.open(fname) as fh:
		text = fh.read().decode("utf-8")
	rows = list(csv.DictReader(io.StringIO(text)))
	cache.set_value(key, rows, expires_in_sec=CACHE_TTL)
	return rows


def _resolve_latest_bhavcopy(today=None) -> tuple:
	"""Find the most recent trading day (≤ 7 days back) that has a published
	F&O bhavcopy. Returns (ymd_string, rows). Raises if nothing in window.
	"""
	d = today or _date.today()
	for _ in range(8):
		ymd = d.strftime("%Y%m%d")
		rows = _bhavcopy_for(ymd)
		if rows:
			return ymd, rows
		d -= timedelta(days=1)
	frappe.throw(
		"Could not find a published F&O bhavcopy in the last 7 days. "
		"NSE may have changed the URL pattern, or it's a long holiday weekend.",
	)


OPTION_INSTRUMENT_TYPES = {"IDO", "STO"}  # Index Option, Stock Option (new schema)
FUTURE_INSTRUMENT_TYPES = {"IDF", "STF"}  # Index Future, Stock Future


def _filter_underlying(rows, tsym: str, expiry: str = None) -> list:
	"""Filter bhavcopy rows for the requested underlying + (optional) expiry.
	Keeps only IDO/STO rows (skips futures), CE & PE.
	"""
	out = []
	for r in rows:
		if r.get("TckrSymb") != tsym:
			continue
		if r.get("FinInstrmTp") not in OPTION_INSTRUMENT_TYPES:
			continue
		if r.get("OptnTp") not in ("CE", "PE"):
			continue
		if expiry and r.get("XpryDt") != expiry:
			continue
		out.append(r)
	return out


# ──────────────────────────── public endpoints ────────────────────────────

@frappe.whitelist()
def get_underlyings() -> dict:
	return {
		"underlyings": [{"key": k, **v} for k, v in UNDERLYINGS.items()],
	}


@frappe.whitelist()
def get_expiries(underlying: str) -> dict:
	"""Distinct expiries (ascending) available in the latest bhavcopy."""
	uw = UNDERLYINGS.get(underlying)
	if not uw:
		frappe.throw(f"Unknown underlying '{underlying}'.")
	bhav_ymd, rows = _resolve_latest_bhavcopy()
	subset = _filter_underlying(rows, uw["tsym"])
	expiries = sorted({r["XpryDt"] for r in subset if r.get("XpryDt")})
	# Filter past expiries — irrelevant after expiry date passes.
	today = _date.today()
	expiries = [e for e in expiries if _date.fromisoformat(e) >= today]
	return {
		"underlying": underlying,
		"bhavcopy_date": bhav_ymd,
		"expiries": expiries,
	}


@frappe.whitelist()
def get_chain(underlying: str, expiry: str, strike_count: int = 15) -> dict:
	strike_count = int(strike_count or 15)
	uw = UNDERLYINGS.get(underlying)
	if not uw:
		frappe.throw(f"Unknown underlying '{underlying}'.")

	bhav_ymd, rows = _resolve_latest_bhavcopy()
	subset = _filter_underlying(rows, uw["tsym"], expiry=expiry)
	if not subset:
		frappe.throw(f"No contracts for {underlying} {expiry} in the bhavcopy "
		             f"({bhav_ymd}). The expiry may already have settled.")

	# Underlying spot — bhavcopy stores it on every row (UndrlygPric). All rows
	# for a given underlying carry the same value, so first one wins.
	spot = flt(subset[0].get("UndrlygPric") or 0)
	if not spot:
		# Fallback: look at any FUT row for this underlying for the spot reference.
		for r in rows:
			if r.get("TckrSymb") == uw["tsym"] and r.get("FinInstrmTp") in FUTURE_INSTRUMENT_TYPES:
				spot = flt(r.get("UndrlygPric") or 0)
				if spot:
					break
	if not spot:
		frappe.throw(f"Could not resolve underlying spot for {underlying} from bhavcopy.")

	# Group rows per (strike, type)
	by_key = {}
	all_strikes = set()
	for r in subset:
		k = flt(r.get("StrkPric") or 0)
		t = r.get("OptnTp")
		all_strikes.add(k)
		by_key[(k, t)] = r

	all_strikes_sorted = sorted(all_strikes)
	atm = min(all_strikes_sorted, key=lambda k: abs(k - spot))
	atm_idx = all_strikes_sorted.index(atm)
	lo = max(0, atm_idx - strike_count)
	hi = min(len(all_strikes_sorted), atm_idx + strike_count + 1)
	selected_strikes = all_strikes_sorted[lo:hi]

	# Time to expiry — bhavcopy is for `bhav_ymd` close (15:30 IST). Use
	# expiry day's 15:30 as the target.
	bhav_close = _datetime.strptime(bhav_ymd, "%Y%m%d").replace(hour=15, minute=30)
	exp_close = _datetime.fromisoformat(expiry).replace(hour=15, minute=30)
	T = max((exp_close - bhav_close).total_seconds() / (365.0 * 86400), 1e-6)

	def _build_side(strike, opt_type):
		row = by_key.get((strike, opt_type))
		if not row:
			return None
		ltp = flt(row.get("ClsPric") or 0)
		oi = flt(row.get("OpnIntrst") or 0)
		oi_change = flt(row.get("ChngInOpnIntrst") or 0)
		vol = flt(row.get("TtlTradgVol") or 0)
		settlement = flt(row.get("SttlmPric") or 0)
		# Use settlement as the price for IV when ClsPric=0 (illiquid strikes
		# sometimes show 0 close but a positive theoretical settlement).
		px_for_iv = ltp if ltp > 0 else settlement
		iv = (option_greeks.implied_vol(px_for_iv, spot, strike, T, RISK_FREE,
		                                q=DIV_YIELD, option_type=opt_type)
		      if px_for_iv > 0 else 0)
		gks = (option_greeks.greeks(spot, strike, T, RISK_FREE, iv,
		                            q=DIV_YIELD, option_type=opt_type)
		       if iv > 0 else {"delta": 0, "gamma": 0, "theta": 0, "vega": 0, "rho": 0})
		return {
			"ltp": ltp,
			"settlement": settlement,
			"oi": oi,
			"oi_change": oi_change,
			"volume": vol,
			"iv": iv * 100,
			"delta": gks["delta"],
			"gamma": gks["gamma"],
			"theta": gks["theta"],
			"vega": gks["vega"],
			"rho": gks["rho"],
			"open": flt(row.get("OpnPric") or 0),
			"high": flt(row.get("HghPric") or 0),
			"low": flt(row.get("LwPric") or 0),
			"close": ltp,
		}

	chain_rows = []
	total_ce_oi = total_pe_oi = 0
	total_ce_vol = total_pe_vol = 0
	total_ce_oi_chg = total_pe_oi_chg = 0
	for strike in selected_strikes:
		ce = _build_side(strike, "CE")
		pe = _build_side(strike, "PE")
		row = {"strike": strike, "is_atm": strike == atm, "ce": ce, "pe": pe}
		if ce:
			total_ce_oi += ce["oi"]; total_ce_vol += ce["volume"]
			total_ce_oi_chg += ce["oi_change"]
		if pe:
			total_pe_oi += pe["oi"]; total_pe_vol += pe["volume"]
			total_pe_oi_chg += pe["oi_change"]
		chain_rows.append(row)

	# Max pain over the selected strike range.
	max_pain_strike = None
	max_pain_value = None
	for cand in selected_strikes:
		total = 0
		for r in chain_rows:
			K = r["strike"]
			if r["ce"]:
				total += r["ce"]["oi"] * max(cand - K, 0)
			if r["pe"]:
				total += r["pe"]["oi"] * max(K - cand, 0)
		if max_pain_value is None or total < max_pain_value:
			max_pain_value = total
			max_pain_strike = cand

	pcr = (total_pe_oi / total_ce_oi) if total_ce_oi else 0

	bhav_iso = f"{bhav_ymd[:4]}-{bhav_ymd[4:6]}-{bhav_ymd[6:]}"
	return {
		"ok": True,
		"underlying": underlying,
		"underlying_name": uw["name"],
		"expiry": expiry,
		"bhavcopy_date": bhav_iso,
		"spot": spot,
		"atm_strike": atm,
		"strike_count": strike_count,
		"days_to_expiry": (exp_close.date() - bhav_close.date()).days,
		"rows": chain_rows,
		"summary": {
			"total_ce_oi": total_ce_oi,
			"total_pe_oi": total_pe_oi,
			"total_ce_volume": total_ce_vol,
			"total_pe_volume": total_pe_vol,
			"total_ce_oi_chg": total_ce_oi_chg,
			"total_pe_oi_chg": total_pe_oi_chg,
			"pcr": round(pcr, 3),
			"max_pain": max_pain_strike,
		},
		"as_of": now_datetime().isoformat(),
	}


# ──────────────────────────── per-strike analyzer ────────────────────────────

@frappe.whitelist()
def analyze_strike(underlying: str, expiry: str, strike, option_type: str) -> dict:
	"""Greek-informed "what if I traded this strike" analysis.

	Returns a structured payload the frontend can render: current snapshot,
	IV rank within this expiry's chain, scenario P&L matrix, breakeven,
	probability ITM, and flat fact-based "buy verdict" / "sell verdict"
	statements grounded purely in the numbers we computed (no directional
	prediction — greeks don't tell you which way price moves).
	"""
	uw = UNDERLYINGS.get(underlying)
	if not uw:
		frappe.throw(f"Unknown underlying '{underlying}'.")
	option_type = (option_type or "").upper()
	if option_type not in ("CE", "PE"):
		frappe.throw("option_type must be 'CE' or 'PE'.")
	strike = flt(strike)
	if strike <= 0:
		frappe.throw("Invalid strike.")

	bhav_ymd, rows = _resolve_latest_bhavcopy()
	subset = _filter_underlying(rows, uw["tsym"], expiry=expiry)
	if not subset:
		frappe.throw(f"No contracts for {underlying} {expiry}.")

	# Find target row
	target = next((r for r in subset
	               if flt(r.get("StrkPric") or 0) == strike
	               and r.get("OptnTp") == option_type), None)
	if not target:
		frappe.throw(f"{underlying} {strike} {option_type} {expiry} not in bhavcopy.")

	spot = flt(subset[0].get("UndrlygPric") or 0)
	ltp = flt(target.get("ClsPric") or 0) or flt(target.get("SttlmPric") or 0)
	oi = flt(target.get("OpnIntrst") or 0)
	d_oi = flt(target.get("ChngInOpnIntrst") or 0)
	vol = flt(target.get("TtlTradgVol") or 0)
	lot = flt(target.get("NewBrdLotQty") or LOT_SIZE.get(underlying, 0))

	bhav_close = _datetime.strptime(bhav_ymd, "%Y%m%d").replace(hour=15, minute=30)
	exp_close = _datetime.fromisoformat(expiry).replace(hour=15, minute=30)
	T = max((exp_close - bhav_close).total_seconds() / (365.0 * 86400), 1e-6)
	days = (exp_close.date() - bhav_close.date()).days

	iv = (option_greeks.implied_vol(ltp, spot, strike, T, RISK_FREE,
	                                q=DIV_YIELD, option_type=option_type)
	      if ltp > 0 else 0)
	gks = (option_greeks.greeks(spot, strike, T, RISK_FREE, iv,
	                            q=DIV_YIELD, option_type=option_type)
	       if iv > 0 else {"delta": 0, "gamma": 0, "theta": 0, "vega": 0, "rho": 0})

	# IV rank within the chain — ATM-band IVs only (avoid skew tails distorting).
	# Take strikes within ±10% of spot for the comparison set.
	band_lo, band_hi = spot * 0.9, spot * 1.1
	band_ivs = []
	for r in subset:
		k = flt(r.get("StrkPric") or 0)
		if not (band_lo <= k <= band_hi):
			continue
		px = flt(r.get("ClsPric") or 0) or flt(r.get("SttlmPric") or 0)
		if px <= 0:
			continue
		band_iv = option_greeks.implied_vol(px, spot, k, T, RISK_FREE,
		                                    q=DIV_YIELD, option_type=r.get("OptnTp"))
		if band_iv > 0:
			band_ivs.append(band_iv)
	band_ivs.sort()
	if iv > 0 and band_ivs:
		below = sum(1 for v in band_ivs if v < iv)
		iv_percentile = round(below / len(band_ivs) * 100, 1)
	else:
		iv_percentile = None
	band_iv_median = (band_ivs[len(band_ivs) // 2] if band_ivs else 0)

	# Breakeven, % move needed, prob ITM (delta proxy)
	if option_type == "CE":
		breakeven = strike + ltp
		breakeven_pct = ((breakeven - spot) / spot * 100) if spot else 0
	else:
		breakeven = strike - ltp
		breakeven_pct = ((breakeven - spot) / spot * 100) if spot else 0
	prob_itm = abs(gks["delta"]) * 100  # rough; delta ≈ N(d2) for risk-neutral, but |Δ| is the working proxy

	# Scenario matrix: rows = spot moves, columns = days from now.
	# Day buckets capped at expiry. At expiry, T = 0 ⇒ option = intrinsic value.
	day_buckets = [0, 2, 5, days]
	day_buckets = sorted(set(d for d in day_buckets if 0 <= d <= days))
	matrix = []
	for move in SPOT_MOVES:
		new_spot = spot * (1 + move)
		row = {"spot_move_pct": round(move * 100, 1), "spot": round(new_spot, 2), "cells": []}
		for d in day_buckets:
			t_left = max((days - d) / 365.0, 0)
			if t_left <= 0:
				# Intrinsic at expiry
				if option_type == "CE":
					theo = max(new_spot - strike, 0)
				else:
					theo = max(strike - new_spot, 0)
			else:
				theo = option_greeks.bs_price(new_spot, strike, t_left, RISK_FREE, iv,
				                              q=DIV_YIELD, option_type=option_type)
			pnl_buy = (theo - ltp) * lot
			pnl_sell = (ltp - theo) * lot
			row["cells"].append({
				"day": d, "premium": round(theo, 2),
				"pnl_buy": round(pnl_buy, 0), "pnl_sell": round(pnl_sell, 0),
			})
		matrix.append(row)

	# Verdicts — keep them factual, not directional.
	# IV "expensive" / "cheap" relative to ATM-band median.
	iv_label = "—"
	if band_iv_median:
		if iv > band_iv_median * 1.10:
			iv_label = f"Rich (IV {iv*100:.1f}% vs band median {band_iv_median*100:.1f}%)"
		elif iv < band_iv_median * 0.90:
			iv_label = f"Cheap (IV {iv*100:.1f}% vs band median {band_iv_median*100:.1f}%)"
		else:
			iv_label = f"Fair (IV {iv*100:.1f}% ≈ band median {band_iv_median*100:.1f}%)"

	# Buy verdict — facts about being long this option
	buy_notes = []
	if days < 3:
		buy_notes.append(f"⚠ {days}d to expiry — theta crunch is severe (₹{abs(gks['theta'])*lot:.0f}/day decay)")
	elif days < 7:
		buy_notes.append(f"Theta cost ~₹{abs(gks['theta'])*lot:.0f}/day on {lot:.0f} lot")
	if abs(gks["delta"]) < 0.2:
		buy_notes.append(f"Far OTM (|Δ|={abs(gks['delta']):.2f}) — needs a big move to pay off")
	elif abs(gks["delta"]) > 0.7:
		buy_notes.append(f"Deep ITM (|Δ|={abs(gks['delta']):.2f}) — behaves like the underlying, low leverage")
	if iv_label.startswith("Rich"):
		buy_notes.append("IV is rich — buying volatility here pays a premium")
	if iv_label.startswith("Cheap"):
		buy_notes.append("IV is cheap relative to chain — favourable for premium buyers")

	# Sell verdict — facts about being short this option
	sell_notes = []
	if abs(gks["delta"]) > 0.4:
		sell_notes.append(f"|Δ|={abs(gks['delta']):.2f} — meaningful assignment risk")
	if days < 3:
		sell_notes.append(f"Only {days}d left — gamma is large, P&L can swing fast on small spot moves")
	elif days < 7:
		sell_notes.append(f"Theta income ~₹{abs(gks['theta'])*lot:.0f}/day decay favours the seller")
	if iv_label.startswith("Rich"):
		sell_notes.append("IV is rich — selling premium has a tailwind")
	if iv_label.startswith("Cheap"):
		sell_notes.append("IV is cheap — selling premium has a smaller cushion than usual")
	# Margin & risk warning is fundamental for shorts
	if option_type == "CE":
		sell_notes.append("Short CE = unlimited upside loss; size accordingly")
	else:
		sell_notes.append(f"Short PE = max loss ≈ ₹{strike*lot:.0f} if spot → 0 (cap with hedge)")

	return {
		"ok": True,
		"underlying": underlying,
		"expiry": expiry,
		"strike": strike,
		"option_type": option_type,
		"bhavcopy_date": f"{bhav_ymd[:4]}-{bhav_ymd[4:6]}-{bhav_ymd[6:]}",
		"spot": spot,
		"ltp": ltp,
		"lot_size": lot,
		"premium_per_lot": round(ltp * lot, 2),
		"oi": oi,
		"oi_change": d_oi,
		"volume": vol,
		"days_to_expiry": days,
		"iv": round(iv * 100, 2),
		"iv_label": iv_label,
		"iv_percentile_in_band": iv_percentile,
		"delta": gks["delta"],
		"gamma": gks["gamma"],
		"theta": gks["theta"],
		"vega": gks["vega"],
		"rho": gks["rho"],
		"breakeven": round(breakeven, 2),
		"breakeven_move_pct": round(breakeven_pct, 2),
		"prob_itm": round(prob_itm, 1),
		"daily_theta_cost": round(abs(gks["theta"]) * lot, 0),
		"max_loss_long": round(ltp * lot, 0),
		"day_buckets": day_buckets,
		"scenarios": matrix,
		"buy_notes": buy_notes,
		"sell_notes": sell_notes,
	}
