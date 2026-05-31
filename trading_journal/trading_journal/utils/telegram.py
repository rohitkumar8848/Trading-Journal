"""Telegram bot helpers.

Free push-notification channel: send daily screener digests and instant
watchlist / open-trade alerts. Configure via "Telegram Settings" (Single).
"""

import frappe
import requests

API = "https://api.telegram.org/bot{token}/sendMessage"
TIMEOUT = 15


def _settings():
	return frappe.get_single("Telegram Settings")


def _get_creds(require_enabled: bool = True):
	doc = _settings()
	if require_enabled and not doc.enabled:
		raise RuntimeError("Telegram is disabled in settings.")
	token = doc.get_password("bot_token", raise_exception=False)
	chat = (doc.chat_id or "").strip()
	if not token or not chat:
		raise RuntimeError("Telegram bot token or chat ID not set.")
	return token, chat, doc


def send_message(text: str, parse_mode: str = "HTML", quiet: bool = True) -> dict:
	"""Send a message. `quiet=True` swallows errors so callers (cron jobs) don't fail."""
	try:
		token, chat, _ = _get_creds()
	except Exception as e:
		if quiet:
			return {"ok": False, "error": str(e)}
		raise
	try:
		r = requests.post(
			API.format(token=token),
			json={
				"chat_id": chat,
				"text": text[:4000],  # Telegram limit
				"parse_mode": parse_mode,
				"disable_web_page_preview": True,
			},
			timeout=TIMEOUT,
		)
		ok = r.ok
		payload = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
		if not ok:
			frappe.log_error(f"{r.status_code}: {r.text[:500]}", "Telegram send failed")
			return {"ok": False, "error": f"{r.status_code}: {payload.get('description') or r.text[:200]}"}
		return {"ok": True, "message_id": (payload.get("result") or {}).get("message_id")}
	except Exception as e:
		if quiet:
			frappe.log_error(frappe.get_traceback(), "Telegram send exception")
			return {"ok": False, "error": str(e)}
		raise


@frappe.whitelist()
def test_telegram() -> dict:
	"""User-facing test from the settings form."""
	try:
		token, chat, doc = _get_creds(require_enabled=False)
	except Exception as e:
		return {"ok": False, "error": str(e)}
	r = requests.post(
		API.format(token=token),
		json={"chat_id": chat, "text": "✅ Trading Journal connected. You'll get screener digests and alerts here."},
		timeout=TIMEOUT,
	)
	if r.ok:
		return {"ok": True, "message": "Test message sent. Check Telegram."}
	try:
		err = r.json().get("description") or r.text[:300]
	except Exception:
		err = r.text[:300]
	return {"ok": False, "error": f"{r.status_code}: {err}"}


def _format_screener_digest(runs: dict) -> str:
	"""Format the 3 most-recent screener runs into a single Telegram message.

	`runs` is a dict {scan_type: run_doc}.
	"""
	from frappe.utils import get_url
	site_url = get_url()
	parts = ["<b>📊 Daily Screener Digest</b>", ""]
	icons = {
		"Trend Template": "🚀", "VCP": "📈", "Turnaround": "🔄",
		"Rocket Base": "🚀",
		"Intraday Momentum": "⚡", "FnO Momentum": "📊",
		"Intraday Short": "🔻",
	}
	urls = {
		"Trend Template": "/app/momentum-screener",
		"VCP": "/app/vcp-screener",
		"Turnaround": "/app/turnaround-screener",
		"Rocket Base": "/app/rocket-base-screener",
		"Intraday Momentum": "/app/intraday-momentum-screener",
		"FnO Momentum": "/app/fno-screener",
		"Intraday Short": "/app/intraday-short-screener",
	}
	for st in ("Trend Template", "VCP", "Turnaround"):
		doc = runs.get(st)
		icon = icons.get(st, "•")
		if not doc or doc.status != "Completed":
			parts.append(f"{icon} <b>{st}</b>: not available")
			continue
		results = doc.results or []
		passed = doc.passed_count or 0
		# Top 5 by RS
		top = sorted(results, key=lambda r: -(r.rs_rating or 0))[:5]
		parts.append(f"{icon} <b>{st}</b>: {passed} passed (of {doc.total_scanned or 0})")
		for r in top:
			rs = float(r.rs_rating or 0)
			parts.append(f"   • <code>{r.symbol}</code>  ₹{float(r.current_price or 0):.0f}  RS {rs:.0f}")
		link = f'<a href="{site_url}{urls[st]}">View all →</a>'
		parts.append(f"   {link}")
		parts.append("")
	return "\n".join(parts).strip()


def send_daily_digest():
	"""Cron entry — fired ~5 min after the 8 AM scheduled scan completes.

	Looks up today's most recent Completed runs for each scan_type. If a scan
	is still running we skip silently (next call will retry).
	"""
	try:
		doc = _settings()
	except Exception:
		return
	if not doc.enabled or not doc.send_daily_digest:
		return

	runs = {}
	from frappe.utils import nowdate
	for st in ("Trend Template", "VCP", "Turnaround"):
		row = frappe.get_all(
			"Screener Run",
			filters={"scan_type": st, "status": "Completed"},
			fields=["name"],
			order_by="completed_at desc",
			limit=1,
		)
		if row:
			# Only include runs from today (scheduler may run at 8 AM; if Yahoo
			# was down we don't want to push yesterday's data again)
			rd = frappe.get_doc("Screener Run", row[0].name)
			completed = str(rd.completed_at or "")[:10]
			if completed == nowdate():
				runs[st] = rd
	if not runs:
		return
	send_message(_format_screener_digest(runs))
