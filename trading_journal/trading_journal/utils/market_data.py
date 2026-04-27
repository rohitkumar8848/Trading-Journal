"""Fetch current stock price from Yahoo Finance.

Yahoo's chart endpoint works without auth and covers NSE (.NS) / BSE (.BO).
Used to see "where did the stock go after I sold it" on closed Trades.
"""
import frappe
import requests
from frappe.utils import flt, now_datetime

YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
TIMEOUT = 10


def _yahoo_symbol(symbol: str, exchange: str = None) -> str:
	symbol = (symbol or "").strip().upper()
	ex = (exchange or "NSE").upper()
	suffix = ".BO" if ex == "BSE" else ".NS"
	return f"{symbol}{suffix}"


def fetch_price(symbol: str, exchange: str = None) -> dict:
	"""Return {price, currency, market_state} for an Indian equity."""
	ys = _yahoo_symbol(symbol, exchange)
	try:
		r = requests.get(
			YAHOO.format(symbol=ys),
			headers={"User-Agent": "Mozilla/5.0"},
			params={"interval": "1d", "range": "5d"},
			timeout=TIMEOUT,
		)
		payload = r.json()
		result = (payload.get("chart") or {}).get("result") or []
		if not result:
			err = (payload.get("chart") or {}).get("error") or {}
			return {"ok": False, "error": err.get("description") or "No data from Yahoo"}
		meta = result[0].get("meta") or {}
		price = meta.get("regularMarketPrice")
		if price is None:
			return {"ok": False, "error": "No market price in Yahoo response"}
		return {
			"ok": True,
			"price": flt(price),
			"currency": meta.get("currency") or "INR",
			"market_state": meta.get("marketState") or "",
			"exchange": meta.get("exchangeName") or "",
			"yahoo_symbol": ys,
		}
	except requests.Timeout:
		return {"ok": False, "error": "Yahoo request timed out"}
	except Exception as e:
		return {"ok": False, "error": str(e)}


@frappe.whitelist()
def refresh_trade_price(trade: str) -> dict:
	doc = frappe.get_doc("Trade", trade)
	if not doc.symbol:
		return {"ok": False, "error": "No symbol set on this trade"}
	exchange = doc.exchange
	if not exchange and frappe.db.exists("Stock Symbol", doc.symbol):
		exchange = frappe.db.get_value("Stock Symbol", doc.symbol, "exchange")
	result = fetch_price(doc.symbol, exchange)
	if not result.get("ok"):
		return result
	doc.current_price = result["price"]
	doc.price_fetched_at = now_datetime()
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {
		"ok": True,
		"price": result["price"],
		"currency": result["currency"],
		"market_state": result["market_state"],
		"yahoo_symbol": result["yahoo_symbol"],
		"fetched_at": str(doc.price_fetched_at),
	}
