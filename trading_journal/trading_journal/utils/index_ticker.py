"""Live index quotes for the desk-wide ticker strip.

Source: Yahoo Finance v7/quote endpoint. We piggyback on the cookie+crumb
session helper in `earnings.py` (Yahoo's bot defences flip every few quarters,
so keeping a single auth path means we only fix that in one place).

Cached 30 s in Redis so a busy multi-tab desktop doesn't hammer Yahoo.
"""

import json
import frappe
from frappe.utils import flt

from trading_journal.trading_journal.utils import earnings


YAHOO_QUOTE = "https://query1.finance.yahoo.com/v7/finance/quote"
CACHE_KEY = "tj:index_ticker:v1"
CACHE_TTL = 30  # seconds

# Symbols + display labels. Yahoo's `shortName` is occasionally stale (e.g.
# ^CNXFIN comes back as "NIFTY FINSRV25 50"), so we always override with our
# own labels. Symbols that returned null in the live probe (^CNX500,
# ^NIFTYHEALTH, ^NIFTYOILGAS, ^CNXCMCPT, ^CNXCOMMOD, ^CNXALPHA) are excluded.
# Order: broad → market-cap → sectoral → strategic → volatility → currency.
INDICES = [
	# Broad
	{"symbol": "^NSEI",         "label": "NIFTY 50"},
	{"symbol": "^NSEBANK",      "label": "BANK NIFTY"},
	{"symbol": "^CNXFIN",       "label": "FINNIFTY"},
	{"symbol": "^BSESN",        "label": "SENSEX"},
	# Market-cap
	{"symbol": "^CNX100",       "label": "NIFTY 100"},
	{"symbol": "^CNX200",       "label": "NIFTY 200"},
	{"symbol": "^NSMIDCP",      "label": "NIFTY NEXT 50"},
	{"symbol": "^NSEMDCP50",    "label": "NIFTY MIDCAP 50"},
	{"symbol": "^CNXSC",        "label": "NIFTY SMALLCAP 100"},
	# Sectoral
	{"symbol": "^CNXIT",        "label": "NIFTY IT"},
	{"symbol": "^CNXMETAL",     "label": "NIFTY METAL"},
	{"symbol": "^CNXPHARMA",    "label": "NIFTY PHARMA"},
	{"symbol": "^CNXAUTO",      "label": "NIFTY AUTO"},
	{"symbol": "^CNXFMCG",      "label": "NIFTY FMCG"},
	{"symbol": "^CNXENERGY",    "label": "NIFTY ENERGY"},
	{"symbol": "^CNXREALTY",    "label": "NIFTY REALTY"},
	{"symbol": "^CNXMEDIA",     "label": "NIFTY MEDIA"},
	{"symbol": "^CNXPSUBANK",   "label": "NIFTY PSU BANK"},
	{"symbol": "NIFTY_PVT_BANK.NS", "label": "NIFTY PVT BANK"},
	{"symbol": "^CNXPSE",       "label": "NIFTY PSE"},
	{"symbol": "^CNXINFRA",     "label": "NIFTY INFRA"},
	{"symbol": "^CNXCONSUM",    "label": "NIFTY CONSUMPTION"},
	{"symbol": "^CNXSERVICE",   "label": "NIFTY SERVICES"},
	{"symbol": "^CNXMNC",       "label": "NIFTY MNC"},
	{"symbol": "^CNXDIVOP",     "label": "NIFTY DIV OPPS 50"},
	# Volatility + currency
	{"symbol": "^INDIAVIX",     "label": "INDIA VIX"},
	{"symbol": "INR=X",         "label": "USD/INR"},
]


@frappe.whitelist()
def get_indices() -> dict:
	cache = frappe.cache()
	cached = cache.get_value(CACHE_KEY)
	if cached:
		try:
			return json.loads(cached)
		except Exception:
			pass

	try:
		session, crumb = earnings._yahoo_session()
		syms = ",".join(i["symbol"] for i in INDICES)
		r = session.get(
			YAHOO_QUOTE,
			headers={"Accept": "*/*", "User-Agent": earnings.UA},
			params={"symbols": syms, "crumb": crumb},
			timeout=10,
		)
		payload = r.json()
		results = (payload.get("quoteResponse") or {}).get("result") or []
		by_sym = {x.get("symbol"): x for x in results}
		items = []
		for spec in INDICES:
			x = by_sym.get(spec["symbol"]) or {}
			items.append({
				"symbol": spec["symbol"],
				"label": spec["label"],
				"price": flt(x.get("regularMarketPrice") or 0),
				"change": flt(x.get("regularMarketChange") or 0),
				"change_pct": flt(x.get("regularMarketChangePercent") or 0),
				"prev_close": flt(x.get("regularMarketPreviousClose") or 0),
				"market_state": x.get("marketState") or "",
			})
		out = {"ok": True, "items": items, "as_of": frappe.utils.now()}
	except Exception as e:
		# Don't blow up the page — return empty payload, the JS handles it.
		out = {"ok": False, "items": [], "error": str(e)}

	cache.set_value(CACHE_KEY, json.dumps(out), expires_in_sec=CACHE_TTL)
	return out
