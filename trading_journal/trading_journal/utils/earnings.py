"""Earnings calendar — upcoming results dates for holdings + watchlist + open trades.

Source: Yahoo Finance v10 quoteSummary endpoint. Free, no auth.
  https://query1.finance.yahoo.com/v10/finance/quoteSummary/RELIANCE.NS?modules=calendarEvents,earnings

Cached 24h per symbol. Aggregated view fetches one symbol at a time
(slow but tractable since the universe of "interesting" symbols is small).
"""

import json
import time
from datetime import datetime, timezone, timedelta

import frappe
import requests
from frappe.utils import flt, now_datetime, getdate

YAHOO_QS = "https://query1.finance.yahoo.com/v10/finance/quoteSummary/{symbol}"
YAHOO_HOME = "https://finance.yahoo.com"
YAHOO_CRUMB = "https://query1.finance.yahoo.com/v1/test/getcrumb"
UA = (
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
	"(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
TIMEOUT = 15
INTER_SLEEP = 0.15


def _yahoo_symbol(symbol: str, exchange: str = "NSE") -> str:
	suffix = ".BO" if (exchange or "NSE").upper() == "BSE" else ".NS"
	return f"{symbol.upper()}{suffix}"


def _ts_to_iso(ts):
	if not ts:
		return None
	try:
		return datetime.fromtimestamp(int(ts), tz=timezone.utc).date().isoformat()
	except Exception:
		return None


def _yahoo_session():
	"""Build a requests.Session with Yahoo cookies + crumb. Yahoo's quoteSummary
	endpoint started requiring crumb auth in 2024; without it we get HTTP 401
	`Invalid Crumb`. Cookies expire so we rebuild per call (cheap: 2 requests).
	"""
	s = requests.Session()
	s.headers.update({"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9"})
	s.get(YAHOO_HOME, timeout=TIMEOUT, allow_redirects=True)
	r = s.get(YAHOO_CRUMB, headers={"Accept": "*/*", "User-Agent": UA}, timeout=TIMEOUT)
	crumb = (r.text or "").strip()
	if r.status_code != 200 or not crumb:
		raise RuntimeError(f"yahoo crumb fetch failed: status={r.status_code} body={r.text[:120]!r}")
	return s, crumb


def _fetch_one(symbol: str, exchange: str = "NSE", session=None, crumb: str = None) -> dict:
	"""Pull earnings dates for a single symbol from Yahoo. Cached 24h."""
	ys = _yahoo_symbol(symbol, exchange)
	cache = frappe.cache()
	key = f"tj:earnings:{ys}"
	cached = cache.get_value(key)
	if cached:
		try:
			return json.loads(cached)
		except Exception:
			pass

	try:
		if session is None or not crumb:
			session, crumb = _yahoo_session()
		r = session.get(
			YAHOO_QS.format(symbol=ys),
			headers={"Accept": "*/*", "User-Agent": UA},
			params={"modules": "calendarEvents,earnings", "crumb": crumb},
			timeout=TIMEOUT,
		)
		payload = r.json()
		result = ((payload.get("quoteSummary") or {}).get("result") or [])
		if not result:
			return {"ok": False}
		ce = (result[0].get("calendarEvents") or {})
		earnings_block = ce.get("earnings") or {}
		dates = earnings_block.get("earningsDate") or []
		date_strs = []
		for d in dates:
			# Yahoo gives {raw: ts, fmt: "..."} or just ts
			ts = d.get("raw") if isinstance(d, dict) else d
			iso = _ts_to_iso(ts)
			if iso:
				date_strs.append(iso)
		out = {
			"ok": True,
			"symbol": symbol.upper(),
			"yahoo_symbol": ys,
			"earnings_dates": date_strs,
			"is_estimated": bool(earnings_block.get("isEarningsDateEstimate")),
			"earnings_avg": (earnings_block.get("earningsAverage") or {}).get("raw"),
		}
		cache.set_value(key, json.dumps(out), expires_in_sec=24 * 3600)
		return out
	except Exception as e:
		return {"ok": False, "error": str(e)}


def _interesting_symbols() -> list:
	"""Symbols we care about: open Trades, Holdings, Active Watchlist."""
	syms = set()
	# Open Holdings
	for h in frappe.get_all("Holding", filters={"total_qty": [">", 0]}, fields=["trading_symbol"]):
		if h.trading_symbol:
			syms.add(h.trading_symbol.upper())
	# Open Trades
	for t in frappe.get_all("Trade", filters={"final_status": "Open"}, fields=["symbol"]):
		if t.symbol:
			syms.add(t.symbol.upper())
	# Active Watchlist
	for w in frappe.get_all("Watchlist Item", filters={"status": "Active"}, fields=["symbol"]):
		if w.symbol:
			syms.add(w.symbol.upper())
	return sorted(syms)


@frappe.whitelist()
def get_earnings_calendar(days_ahead: int = 60, force: int = 0) -> dict:
	"""Aggregate upcoming earnings for symbols you actually hold/watch."""
	symbols = _interesting_symbols()
	rows = []
	today = getdate()
	cutoff = today + timedelta(days=int(days_ahead or 60))
	errors = 0
	session = crumb = None
	for sym in symbols:
		# Force refresh by invalidating cache first
		if int(force or 0):
			frappe.cache().delete_value(f"tj:earnings:{_yahoo_symbol(sym)}")
		# Build the Yahoo session lazily — only if at least one symbol is uncached
		if session is None and not frappe.cache().get_value(f"tj:earnings:{_yahoo_symbol(sym)}"):
			try:
				session, crumb = _yahoo_session()
			except Exception:
				session, crumb = None, None
		data = _fetch_one(sym, session=session, crumb=crumb)
		if not data.get("ok"):
			errors += 1
			time.sleep(INTER_SLEEP)
			continue
		dates = data.get("earnings_dates") or []
		# Find the soonest future date
		future = []
		for d in dates:
			try:
				dt = getdate(d)
				if today <= dt <= cutoff:
					future.append(d)
			except Exception:
				pass
		if future:
			rows.append({
				"symbol": sym,
				"company_name": frappe.db.get_value("Stock Symbol", sym, "company_name") or sym,
				"earnings_date": sorted(future)[0],
				"is_estimated": data.get("is_estimated"),
				"earnings_avg": data.get("earnings_avg"),
				"in_holdings": frappe.db.exists("Holding", {"trading_symbol": sym, "total_qty": [">", 0]}) and True or False,
				"open_trade": frappe.db.exists("Trade", {"symbol": sym, "final_status": "Open"}) and True or False,
				"on_watchlist": frappe.db.exists("Watchlist Item", {"symbol": sym, "status": "Active"}) and True or False,
			})
		time.sleep(INTER_SLEEP)

	rows.sort(key=lambda r: r["earnings_date"])
	# Bucket by week
	buckets = {}
	for r in rows:
		dt = getdate(r["earnings_date"])
		days_away = (dt - today).days
		if days_away <= 7:
			b = "This Week (≤ 7d)"
		elif days_away <= 14:
			b = "Next Week (8-14d)"
		elif days_away <= 30:
			b = "This Month (15-30d)"
		else:
			b = f"Later (>30d)"
		buckets.setdefault(b, []).append(r)
	return {
		"ok": True,
		"as_of": now_datetime().isoformat(),
		"total_symbols_checked": len(symbols),
		"upcoming": rows,
		"buckets": buckets,
		"errors": errors,
	}
