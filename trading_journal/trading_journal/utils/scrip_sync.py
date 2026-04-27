"""
Sync NSE and BSE stock symbols from their official CSV sources.

NSE: https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv
     Columns: SYMBOL, NAME OF COMPANY, SERIES, DATE OF LISTING,
              PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE

BSE: https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&segment=Equity&status=Active
     JSON response with: SCRIP_CD, LONG_NAME, ISIN_NUMBER, GROUP_NAME, FACE_VALUE
"""

import csv
import io
import frappe
import requests

NSE_CSV_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
BSE_API_URL = (
	"https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w"
	"?Group=&Scripcode=&industry=&segment=Equity&status=Active"
)

NSE_HEADERS = {
	"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
	"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	"Referer": "https://www.nseindia.com/",
}
BSE_HEADERS = {
	"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
	"Referer": "https://www.bseindia.com/",
}

BATCH_SIZE = 500


def sync_nse() -> int:
	resp = requests.get(NSE_CSV_URL, headers=NSE_HEADERS, timeout=30)
	resp.raise_for_status()

	reader = csv.DictReader(io.StringIO(resp.text))
	rows = list(reader)
	count = 0

	for i in range(0, len(rows), BATCH_SIZE):
		batch = rows[i : i + BATCH_SIZE]
		for row in batch:
			symbol = (row.get("SYMBOL") or "").strip()
			if not symbol:
				continue

			company = (row.get("NAME OF COMPANY") or "").strip().title()
			series = (row.get("SERIES") or "").strip()
			isin = (row.get("ISIN NUMBER") or "").strip()
			face_value = _safe_float(row.get("FACE VALUE"))
			date_of_listing = _parse_date(row.get("DATE OF LISTING"))

			_upsert_symbol(
				symbol=symbol,
				company_name=company,
				exchange="NSE",
				series=series,
				isin=isin,
				face_value=face_value,
				date_of_listing=date_of_listing,
			)
			count += 1

		frappe.db.commit()

	return count


def sync_bse() -> int:
	resp = requests.get(BSE_API_URL, headers=BSE_HEADERS, timeout=30)
	resp.raise_for_status()

	data = resp.json()
	# BSE API returns {"Table": [...]} structure
	rows = data if isinstance(data, list) else data.get("Table", [])
	count = 0

	for i in range(0, len(rows), BATCH_SIZE):
		batch = rows[i : i + BATCH_SIZE]
		for row in batch:
			symbol = str(row.get("SCRIP_CD") or row.get("scripCd") or "").strip()
			if not symbol:
				continue

			company = (row.get("LONG_NAME") or row.get("scrip_name") or "").strip().title()
			isin = (row.get("ISIN_NUMBER") or row.get("isin_number") or "").strip()
			series = (row.get("GROUP_NAME") or "").strip()
			face_value = _safe_float(row.get("FACE_VALUE") or row.get("face_value"))

			_upsert_symbol(
				symbol=symbol,
				company_name=company,
				exchange="BSE",
				series=series,
				isin=isin,
				face_value=face_value,
			)
			count += 1

		frappe.db.commit()

	return count


def _upsert_symbol(symbol, company_name, exchange, series="", isin="", face_value=None, date_of_listing=None):
	existing = frappe.db.get_value("Stock Symbol", symbol, ["name", "exchange"], as_dict=True)

	if existing:
		# Merge: if same symbol exists on other exchange, mark as NSE & BSE
		if existing.exchange != exchange and existing.exchange != "NSE & BSE":
			frappe.db.set_value("Stock Symbol", symbol, "exchange", "NSE & BSE")
		# Always refresh company name / ISIN if missing
		if isin:
			frappe.db.set_value("Stock Symbol", symbol, "isin", isin)
		return

	doc = frappe.get_doc({
		"doctype": "Stock Symbol",
		"symbol": symbol,
		"company_name": company_name,
		"exchange": exchange,
		"series": series,
		"isin": isin,
		"face_value": face_value,
		"date_of_listing": date_of_listing,
		"is_active": 1,
	})
	doc.insert(ignore_permissions=True, ignore_if_duplicate=True)


def _safe_float(val):
	try:
		return float(str(val).replace(",", "").strip())
	except Exception:
		return None


def _parse_date(val):
	if not val:
		return None
	val = str(val).strip()
	for fmt in ("%d-%b-%Y", "%d/%m/%Y", "%Y-%m-%d"):
		try:
			from datetime import datetime
			return datetime.strptime(val, fmt).strftime("%Y-%m-%d")
		except ValueError:
			continue
	return None


@frappe.whitelist()
def sync_scrips_from_ui(exchange="all"):
	"""Called from the UI — runs as background job."""
	frappe.enqueue(
		"trading_journal.trading_journal.utils.scrip_sync._run_sync_job",
		exchange=exchange,
		queue="long",
		timeout=600,
	)
	return {"status": "queued", "message": f"Syncing {exchange.upper()} symbols in background…"}


def _run_sync_job(exchange="all"):
	results = {}
	if exchange in ("nse", "all"):
		results["nse"] = sync_nse()
	if exchange in ("bse", "all"):
		results["bse"] = sync_bse()
	frappe.db.commit()
	frappe.publish_realtime(
		"scrip_sync_done",
		{"results": results},
		user=frappe.session.user,
	)
