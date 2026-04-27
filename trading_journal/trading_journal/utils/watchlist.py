"""Watchlist + alert engine.

- @frappe.whitelist endpoints used by the screener pages and the watchlist UI
- A market-hours cron checks price vs pivot/stop/target and sends Telegram alerts
"""

from datetime import datetime, time as dtime, timezone, timedelta

import frappe
from frappe.utils import flt, now_datetime

from trading_journal.trading_journal.utils import market_data, telegram


# ───────────────── add / list / refresh ─────────────────

@frappe.whitelist()
def add_to_watchlist(symbol: str, company_name: str = None, exchange: str = "NSE",
                     pivot_price: float = None, stop_price: float = None,
                     target_price: float = None, scan_source: str = "Manual",
                     notes: str = None) -> dict:
	"""Create a Watchlist Item. If the same active symbol already exists, return it."""
	symbol = (symbol or "").strip().upper()
	if not symbol:
		return {"ok": False, "error": "No symbol"}

	existing = frappe.get_all(
		"Watchlist Item",
		filters={"symbol": symbol, "status": "Active"},
		fields=["name"], limit=1,
	)
	if existing:
		# Update pivot if a new one was supplied (e.g. re-flagged from a different scan)
		if pivot_price is not None:
			doc = frappe.get_doc("Watchlist Item", existing[0].name)
			if not doc.pivot_price or flt(pivot_price) != flt(doc.pivot_price):
				doc.pivot_price = flt(pivot_price)
				doc.scan_source = scan_source or doc.scan_source
				doc.save(ignore_permissions=True)
		return {"ok": True, "name": existing[0].name, "existed": True}

	doc = frappe.new_doc("Watchlist Item")
	doc.symbol = symbol
	doc.company_name = company_name or symbol
	doc.exchange = (exchange or "NSE").upper()
	doc.scan_source = scan_source or "Manual"
	doc.pivot_price = flt(pivot_price) if pivot_price is not None else 0
	doc.stop_price = flt(stop_price) if stop_price is not None else 0
	doc.target_price = flt(target_price) if target_price is not None else 0
	doc.notes = notes or ""
	doc.status = "Active"
	doc.added_at = now_datetime()
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return {"ok": True, "name": doc.name, "existed": False}


@frappe.whitelist()
def get_watchlist(status: str = "Active") -> list:
	rows = frappe.get_all(
		"Watchlist Item",
		filters={"status": status} if status else {},
		fields=[
			"name", "symbol", "company_name", "exchange", "scan_source",
			"pivot_price", "stop_price", "target_price", "current_price",
			"price_fetched_at", "status", "alerted_at", "added_at", "notes",
		],
		order_by="added_at desc",
	)
	for r in rows:
		r["pivot_price"] = flt(r.get("pivot_price"))
		r["stop_price"] = flt(r.get("stop_price"))
		r["target_price"] = flt(r.get("target_price"))
		r["current_price"] = flt(r.get("current_price"))
		r["added_at"] = str(r["added_at"]) if r.get("added_at") else ""
		r["alerted_at"] = str(r["alerted_at"]) if r.get("alerted_at") else ""
		r["price_fetched_at"] = str(r["price_fetched_at"]) if r.get("price_fetched_at") else ""
		# Distance to pivot
		if r["pivot_price"] and r["current_price"]:
			r["pct_to_pivot"] = round((r["current_price"] - r["pivot_price"]) / r["pivot_price"] * 100, 2)
		else:
			r["pct_to_pivot"] = 0
	return rows


@frappe.whitelist()
def refresh_prices(names: str = None) -> dict:
	"""Bulk-refresh current prices for active items (or specific names)."""
	import json
	if names:
		try:
			lst = json.loads(names) if isinstance(names, str) else names
		except Exception:
			lst = [names]
	else:
		lst = [r.name for r in frappe.get_all("Watchlist Item", filters={"status": "Active"}, fields=["name"])]
	updated = 0
	for n in lst:
		doc = frappe.get_doc("Watchlist Item", n)
		px = market_data.fetch_price(doc.symbol, doc.exchange)
		if px.get("ok"):
			doc.current_price = flt(px["price"])
			doc.price_fetched_at = now_datetime()
			doc.save(ignore_permissions=True)
			updated += 1
	frappe.db.commit()
	return {"ok": True, "updated": updated, "total": len(lst)}


@frappe.whitelist()
def update_item(name: str, **kwargs) -> dict:
	doc = frappe.get_doc("Watchlist Item", name)
	for f in ("pivot_price", "stop_price", "target_price", "notes", "status"):
		if f in kwargs and kwargs[f] is not None:
			setattr(doc, f, kwargs[f])
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"ok": True, "name": name, "status": doc.status}


@frappe.whitelist()
def remove_item(name: str) -> dict:
	frappe.delete_doc("Watchlist Item", name, ignore_permissions=True)
	frappe.db.commit()
	return {"ok": True}


# ───────────────── alert cron ─────────────────

def _is_market_hours() -> bool:
	"""Mon-Fri, 09:00-15:45 IST. Conservative buffer around 09:15-15:30."""
	now = datetime.now(timezone(timedelta(hours=5, minutes=30)))
	if now.weekday() >= 5:
		return False
	return dtime(9, 0) <= now.time() <= dtime(15, 45)


def _send_alert(symbol: str, kind: str, price: float, doc):
	"""Compose + send a Telegram alert for one item."""
	from frappe.utils import get_url
	site = get_url()
	if kind == "pivot":
		head = f"🚀 <b>BREAKOUT</b> — {symbol}"
		body = (
			f"Price <b>₹{price:.2f}</b> crossed pivot ₹{flt(doc.pivot_price):.2f}\n"
			f"Stop: ₹{flt(doc.stop_price):.2f}  ·  Target: ₹{flt(doc.target_price):.2f}\n"
			f"Source: {doc.scan_source or 'Manual'}"
		)
	elif kind == "stop":
		head = f"🛑 <b>STOP HIT</b> — {symbol}"
		body = f"Price <b>₹{price:.2f}</b> hit stop ₹{flt(doc.stop_price):.2f}"
	elif kind == "target":
		head = f"🎯 <b>TARGET HIT</b> — {symbol}"
		body = f"Price <b>₹{price:.2f}</b> hit target ₹{flt(doc.target_price):.2f}"
	else:
		return
	msg = f"{head}\n{body}\n\n<a href='{site}/app/watchlist'>Open watchlist</a>"
	telegram.send_message(msg)


def check_watchlist_alerts():
	"""Cron entry. Runs every 15 min during market hours; refreshes prices and pings."""
	if not _is_market_hours():
		return
	settings_doc = frappe.get_single("Telegram Settings")
	if not settings_doc.enabled or not settings_doc.send_watchlist_alerts:
		# Still refresh prices for the UI even if telegram is off
		refresh_prices()
		return

	items = frappe.get_all(
		"Watchlist Item",
		filters={"status": "Active"},
		fields=["name", "symbol", "exchange", "pivot_price", "stop_price", "target_price", "alerted_at"],
	)
	for it in items:
		px = market_data.fetch_price(it.symbol, it.exchange or "NSE")
		if not px.get("ok"):
			continue
		price = flt(px["price"])
		# Persist current price
		frappe.db.set_value("Watchlist Item", it.name, {
			"current_price": price,
			"price_fetched_at": now_datetime(),
		}, update_modified=False)
		# Decide the strongest alert (in priority order)
		alerted = bool(it.alerted_at)
		doc = None  # lazy load
		# Pivot breakout — only if not already alerted
		if it.pivot_price and price >= flt(it.pivot_price) and not alerted:
			doc = frappe.get_doc("Watchlist Item", it.name)
			_send_alert(it.symbol, "pivot", price, doc)
			doc.alerted_at = now_datetime()
			doc.status = "Triggered"
			doc.save(ignore_permissions=True)
			continue
		# Stop hit (downside) — even if pivot already triggered (so set up after take, this is informational)
		if it.stop_price and price <= flt(it.stop_price) and alerted:
			doc = doc or frappe.get_doc("Watchlist Item", it.name)
			_send_alert(it.symbol, "stop", price, doc)
			doc.status = "Dismissed"
			doc.save(ignore_permissions=True)
			continue
		# Target hit (upside)
		if it.target_price and price >= flt(it.target_price) and alerted:
			doc = doc or frappe.get_doc("Watchlist Item", it.name)
			_send_alert(it.symbol, "target", price, doc)
			# Don't change status — user decides whether to trim/exit
	frappe.db.commit()


def check_open_trade_alerts():
	"""Cron — pings Telegram when an open Trade's price crosses its stop or target."""
	if not _is_market_hours():
		return
	doc = frappe.get_single("Telegram Settings")
	if not doc.enabled or not doc.send_open_trade_alerts:
		return

	trades = frappe.get_all(
		"Trade",
		filters={"final_status": "Open"},
		fields=["name", "symbol", "exchange", "trade_type", "stop_loss", "target", "entry_price"],
	)
	for t in trades:
		if not t.symbol:
			continue
		# Skip when stop/target both unset
		if not (t.stop_loss or t.target):
			continue
		# Throttle: don't re-alert same trade within 6h
		last_key = f"tj:trade_alert:{t.name}"
		cache = frappe.cache()
		if cache.get_value(last_key):
			continue
		px = market_data.fetch_price(t.symbol, t.exchange or "NSE")
		if not px.get("ok"):
			continue
		price = flt(px["price"])
		hit = None
		if (t.trade_type or "Long") == "Long":
			if t.stop_loss and price <= flt(t.stop_loss):
				hit = ("stop", flt(t.stop_loss))
			elif t.target and price >= flt(t.target):
				hit = ("target", flt(t.target))
		else:  # Short
			if t.stop_loss and price >= flt(t.stop_loss):
				hit = ("stop", flt(t.stop_loss))
			elif t.target and price <= flt(t.target):
				hit = ("target", flt(t.target))
		if not hit:
			continue
		from frappe.utils import get_url
		site = get_url()
		kind, ref = hit
		icon = "🛑" if kind == "stop" else "🎯"
		msg = (
			f"{icon} <b>OPEN TRADE — {kind.upper()} HIT</b>\n"
			f"<code>{t.symbol}</code> ({t.trade_type}) at <b>₹{price:.2f}</b>\n"
			f"{kind.title()}: ₹{ref:.2f}  ·  Entry: ₹{flt(t.entry_price):.2f}\n\n"
			f"<a href='{site}/app/trade/{t.name}'>Open trade</a>"
		)
		telegram.send_message(msg)
		cache.set_value(last_key, "1", expires_in_sec=6 * 3600)
