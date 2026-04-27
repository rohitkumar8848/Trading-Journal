"""Free AI integration: Google News (no auth) + Gemini API for analysis.

Two whitelisted entry points the frontend uses:
  - fetch_news(symbol)       — Google News RSS, cached
  - analyse_stock(symbol)    — gathers context (price, news, your trade history) → Gemini
"""

import json
import re
import urllib.parse
from datetime import datetime
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree as ET

import frappe
import requests
from frappe.utils import flt, now_datetime

from trading_journal.trading_journal.utils import market_data

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
GOOGLE_NEWS = "https://news.google.com/rss/search?q={q}&hl=en-IN&gl=IN&ceid=IN:en"
TIMEOUT = 25


# ─────────────────────── settings helpers ───────────────────────

def _settings():
	return frappe.get_single("AI Settings")


def _get_api_key():
	doc = _settings()
	if not doc.enable_ai:
		raise RuntimeError("AI Analysis is disabled in AI Settings.")
	key = doc.get_password("gemini_api_key", raise_exception=False)
	if not key:
		raise RuntimeError("Gemini API key not set. Open AI Settings and paste your key.")
	return key, doc.model or "gemini-2.0-flash"


# ─────────────────────── Google News RSS ───────────────────────

def _resolve_symbol(symbol: str):
	"""Look up the Stock Symbol record for company name + exchange."""
	if frappe.db.exists("Stock Symbol", symbol):
		row = frappe.db.get_value(
			"Stock Symbol", symbol,
			["company_name", "exchange"], as_dict=True,
		)
		return row or frappe._dict({"company_name": symbol, "exchange": "NSE"})
	return frappe._dict({"company_name": symbol, "exchange": "NSE"})


def _news_query(symbol: str, company_name: str = None) -> str:
	"""Build a search query that biases toward Indian financial news."""
	# Search for both ticker and company name; Google News is more reliable on company.
	parts = [symbol]
	if company_name and company_name.strip().lower() != symbol.strip().lower():
		parts.append(f'"{company_name}"')
	parts.append("(NSE OR BSE OR stock OR shares)")
	return " ".join(parts)


def _parse_rss(xml_text: str, max_items: int):
	out = []
	try:
		root = ET.fromstring(xml_text)
	except ET.ParseError:
		return out
	channel = root.find("channel")
	if channel is None:
		return out
	for item in channel.findall("item")[:max_items]:
		title = (item.findtext("title") or "").strip()
		link = (item.findtext("link") or "").strip()
		pub = (item.findtext("pubDate") or "").strip()
		source_el = item.find("source")
		source = (source_el.text.strip() if source_el is not None and source_el.text else "")
		# Parse pubDate to ISO + relative
		pub_dt = None
		try:
			pub_dt = parsedate_to_datetime(pub)
		except Exception:
			pass
		out.append({
			"title": title,
			"link": link,
			"source": source,
			"published_at": pub_dt.isoformat() if pub_dt else "",
			"published_raw": pub,
		})
	return out


def _news_cache_key(symbol):
	return f"tj:news:{symbol.upper()}"


@frappe.whitelist()
def fetch_news(symbol: str, force: int = 0) -> dict:
	"""Return a list of news items for the symbol. Cached per AI Settings."""
	if not symbol:
		return {"ok": False, "error": "No symbol provided"}
	symbol = symbol.strip().upper()
	doc = _settings()
	max_items = int(doc.max_news_items or 8)
	cache_min = int(doc.news_cache_minutes or 30)

	cache = frappe.cache()
	key = _news_cache_key(symbol)

	if not int(force or 0):
		cached = cache.get_value(key)
		if cached:
			try:
				data = json.loads(cached)
				data["from_cache"] = True
				return data
			except Exception:
				pass

	resolved = _resolve_symbol(symbol)
	q = _news_query(symbol, resolved.company_name)
	url = GOOGLE_NEWS.format(q=urllib.parse.quote(q))

	try:
		r = requests.get(url, timeout=TIMEOUT, headers={"User-Agent": "Mozilla/5.0"})
		items = _parse_rss(r.text, max_items)
	except Exception as e:
		return {"ok": False, "error": f"News fetch failed: {e}"}

	result = {
		"ok": True,
		"symbol": symbol,
		"company_name": resolved.company_name,
		"items": items,
		"fetched_at": now_datetime().isoformat(),
		"from_cache": False,
	}
	if cache_min > 0:
		cache.set_value(key, json.dumps(result), expires_in_sec=cache_min * 60)
	return result


# ─────────────────────── stock context for AI ───────────────────────

def _gather_context(symbol: str) -> dict:
	"""Pull everything we know about a symbol so Gemini has real grounding."""
	resolved = _resolve_symbol(symbol)
	ctx = {
		"symbol": symbol,
		"company_name": resolved.company_name,
		"exchange": resolved.exchange,
	}

	# Live price
	try:
		px = market_data.fetch_price(symbol, resolved.exchange)
		if px.get("ok"):
			ctx["current_price"] = px["price"]
			ctx["price_currency"] = px.get("currency", "INR")
			ctx["market_state"] = px.get("market_state", "")
	except Exception:
		pass

	# Open Holdings (across all brokers)
	holdings = frappe.get_all(
		"Holding",
		filters={"trading_symbol": symbol},
		fields=["broker", "total_qty", "avg_cost_price", "last_traded_price"],
	)
	if holdings:
		ctx["holdings"] = [
			{
				"broker": h.broker,
				"qty": flt(h.total_qty),
				"avg_cost": flt(h.avg_cost_price),
				"ltp": flt(h.last_traded_price),
			}
			for h in holdings
		]

	# Closed trades — performance summary
	closed = frappe.get_all(
		"Trade",
		filters={"symbol": symbol, "final_status": "Closed"},
		fields=["name", "trade_type", "status", "pnl", "r_multiple", "hold_days", "setup_type", "trade_grade", "buy_date", "sell_date"],
		order_by="sell_date desc",
		limit=20,
	)
	if closed:
		wins = [t for t in closed if t.status == "Win"]
		losses = [t for t in closed if t.status == "Loss"]
		total_pnl = sum(flt(t.pnl) for t in closed)
		ctx["history"] = {
			"total_trades": len(closed),
			"wins": len(wins),
			"losses": len(losses),
			"win_rate": round(len(wins) / len(closed) * 100, 1) if closed else 0,
			"total_pnl": round(total_pnl, 2),
			"avg_r_multiple": round(sum(flt(t.r_multiple) for t in closed) / len(closed), 2),
			"avg_hold_days": round(sum(flt(t.hold_days) for t in closed) / len(closed), 2),
			"recent_trades": [
				{
					"date": str(t.sell_date or t.buy_date),
					"type": t.trade_type,
					"outcome": t.status,
					"pnl": flt(t.pnl),
					"r": flt(t.r_multiple),
					"setup": t.setup_type or "",
					"grade": t.trade_grade or "",
				}
				for t in closed[:8]
			],
		}

	# Mistakes most often tagged on this name
	mistake_rows = frappe.db.sql(
		"""
		SELECT tm.mistake, COUNT(*) AS cnt
		FROM `tabTrade Mistake` tm
		JOIN `tabTrade` t ON t.name = tm.parent
		WHERE t.symbol = %s
		GROUP BY tm.mistake
		ORDER BY cnt DESC
		LIMIT 5
		""",
		(symbol,),
		as_dict=True,
	)
	if mistake_rows:
		ctx["common_mistakes"] = [{"mistake": r.mistake, "count": r.cnt} for r in mistake_rows]

	# Open Trade
	open_trade = frappe.db.get_value(
		"Trade",
		filters={"symbol": symbol, "final_status": "Open"},
		fieldname=["name", "trade_type", "entry_price", "quantity", "stop_loss", "target", "buy_date"],
		as_dict=True,
	)
	if open_trade:
		ctx["open_position"] = open_trade

	# Recent news
	news = fetch_news(symbol)
	if news.get("ok"):
		ctx["news_headlines"] = [
			{"title": n["title"], "source": n["source"], "published": n.get("published_at", "")}
			for n in news.get("items", [])[:8]
		]

	return ctx


# ─────────────────────── Gemini call ───────────────────────

_PROMPT_TEMPLATE = """You are a disciplined Indian equity analyst speaking to a retail trader.
Analyse the stock based ONLY on the context below. Be concise and concrete.
Use Indian rupees (₹). If a section has no data, say "No data".
End with a clear DISCLAIMER that this is not financial advice.

Format your response in well-structured Markdown with these EXACT section headers:

## 📊 Snapshot
1-2 lines on the current price, market state, and exchange.

## 📰 News Pulse
What the headlines collectively suggest. 3-5 bullet points. Don't repeat headlines verbatim.

## 📈 Technical View
Based on current price and any historical context. Mention support/resistance hints if visible.

## 👤 Your Trading Record on This Stock
Read the user's history. Cite their win rate, avg R-multiple, common mistakes. Be honest about
patterns (e.g. "you tend to overstay losers in this name").

## ⚠ Risks & Catalysts
Bullet list. Drawn from news + position size if relevant.

## 🎯 Action Suggestion
One paragraph. Hold / Add / Trim / Avoid — with reasoning. Reference R:R if entry levels exist.

## ⚖ Disclaimer
Standard not-financial-advice line.

CONTEXT:
{context_json}
"""


def _gemini_error_message(r) -> str:
	"""Pull the human-readable error from a Gemini error response."""
	try:
		j = r.json()
		err = j.get("error", {})
		msg = err.get("message") or ""
		# Quota errors include details with quotaMetric/quotaValue
		details = err.get("details") or []
		for det in details:
			if det.get("@type", "").endswith("QuotaFailure"):
				violations = det.get("violations") or []
				if violations:
					q = violations[0]
					msg += f"  ·  quota: {q.get('quotaId') or q.get('quotaMetric')}, value: {q.get('quotaValue')}"
		return msg or r.text[:400]
	except Exception:
		return r.text[:400]


def _call_gemini(prompt: str, api_key: str, model: str) -> str:
	url = GEMINI_URL.format(model=model, key=api_key)
	body = {
		"contents": [{"parts": [{"text": prompt}]}],
		"generationConfig": {
			"temperature": 0.4,
			"topP": 0.9,
			"maxOutputTokens": 2048,
		},
	}
	r = requests.post(url, json=body, timeout=TIMEOUT)
	if r.status_code == 429:
		raise RuntimeError(f"Gemini 429 (rate limit / quota): {_gemini_error_message(r)}")
	if r.status_code == 400:
		raise RuntimeError(f"Gemini 400 (bad request): {_gemini_error_message(r)}")
	if r.status_code == 403:
		raise RuntimeError(f"Gemini 403 (auth): {_gemini_error_message(r)}")
	if r.status_code == 404:
		raise RuntimeError(f"Gemini 404 (model '{model}' not found or not available on free tier): {_gemini_error_message(r)}")
	if not r.ok:
		raise RuntimeError(f"Gemini {r.status_code}: {_gemini_error_message(r)}")
	payload = r.json()
	candidates = payload.get("candidates") or []
	if not candidates:
		blocked = payload.get("promptFeedback", {}).get("blockReason")
		if blocked:
			raise RuntimeError(f"Gemini blocked the request: {blocked}")
		raise RuntimeError("Gemini returned no content")
	parts = candidates[0].get("content", {}).get("parts") or []
	return "".join(p.get("text", "") for p in parts).strip()


@frappe.whitelist()
def test_gemini() -> dict:
	"""One-shot ping of the configured Gemini model with a 5-token prompt — diagnoses key/quota."""
	try:
		api_key, model = _get_api_key()
	except Exception as e:
		return {"ok": False, "error": str(e)}
	try:
		text = _call_gemini("Reply with just OK", api_key, model)
		return {"ok": True, "model": model, "reply": text[:200]}
	except Exception as e:
		return {"ok": False, "error": str(e), "model": model}


@frappe.whitelist()
def list_models() -> dict:
	"""Call Google ListModels with the saved key — returns models that support generateContent."""
	doc = _settings()
	api_key = doc.get_password("gemini_api_key", raise_exception=False)
	if not api_key:
		return {"ok": False, "error": "Gemini API key not set."}
	try:
		r = requests.get(
			f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}",
			timeout=TIMEOUT,
		)
		if not r.ok:
			return {"ok": False, "error": f"{r.status_code}: {_gemini_error_message(r)}"}
		payload = r.json()
		out = []
		for m in payload.get("models") or []:
			methods = m.get("supportedGenerationMethods") or []
			if "generateContent" not in methods:
				continue
			# Strip the "models/" prefix Google returns
			name = (m.get("name") or "").replace("models/", "")
			out.append({
				"name": name,
				"display_name": m.get("displayName") or name,
				"description": (m.get("description") or "")[:200],
				"input_token_limit": m.get("inputTokenLimit"),
				"output_token_limit": m.get("outputTokenLimit"),
			})
		# Sort: prefer flash > pro > others, newest version first
		def _rank(m):
			n = m["name"].lower()
			tier = 0 if "flash-lite" in n else (1 if "flash" in n else (2 if "pro" in n else 3))
			# rough version extraction
			try:
				ver = -float(n.split("gemini-")[1].split("-")[0]) if "gemini-" in n else 0
			except Exception:
				ver = 0
			return (tier, ver, n)
		out.sort(key=_rank)
		return {"ok": True, "models": out, "count": len(out)}
	except Exception as e:
		return {"ok": False, "error": str(e)}


@frappe.whitelist()
def clear_cache() -> dict:
	"""Drop all cached AI analyses and news from Redis."""
	cache = frappe.cache()
	deleted = 0
	for prefix in ("tj:ai:analysis:", "tj:news:"):
		# frappe.cache wraps redis with a site-prefix; iterate via keys lookup.
		try:
			keys = cache.get_keys(prefix + "*")
		except Exception:
			keys = []
		for k in keys:
			cache.delete_value(k.decode("utf-8") if isinstance(k, bytes) else k)
			deleted += 1
	return {"ok": True, "deleted": deleted}


def _analysis_cache_key(symbol: str, model: str) -> str:
	return f"tj:ai:analysis:{model}:{symbol.upper()}"


@frappe.whitelist()
def analyse_stock(symbol: str, force: int = 0) -> dict:
	"""Build a context bundle for `symbol` and send to Gemini for analysis.

	Cached for 30 minutes per (symbol, model) to protect the free-tier quota.
	Pass force=1 to bust the cache.
	"""
	if not symbol:
		return {"ok": False, "error": "No symbol provided"}
	symbol = symbol.strip().upper()

	try:
		api_key, model = _get_api_key()
	except Exception as e:
		return {"ok": False, "error": str(e)}

	cache = frappe.cache()
	key = _analysis_cache_key(symbol, model)
	if not int(force or 0):
		cached = cache.get_value(key)
		if cached:
			try:
				data = json.loads(cached)
				data["from_cache"] = True
				return data
			except Exception:
				pass

	context = _gather_context(symbol)
	prompt = _PROMPT_TEMPLATE.format(context_json=json.dumps(context, default=str, indent=2))

	try:
		text = _call_gemini(prompt, api_key, model)
	except Exception as e:
		err = str(e)
		frappe.log_error(frappe.get_traceback(), "AI Analyse Failed")
		# Friendlier hint for the most common failure modes.
		if "429" in err or "rate" in err.lower() or "quota" in err.lower():
			err += (
				"  ·  Likely causes: (1) per-minute rate hit — wait ~60s; "
				"(2) daily quota exhausted — wait until midnight Pacific Time; "
				"(3) wrong model id — try Tools → Test AI Connection on AI Settings."
			)
		return {"ok": False, "error": err}

	result = {
		"ok": True,
		"symbol": symbol,
		"company_name": context.get("company_name"),
		"analysis": text,
		"model": model,
		"generated_at": now_datetime().isoformat(),
		"from_cache": False,
		"context_brief": {
			"current_price": context.get("current_price"),
			"open_position": bool(context.get("open_position")),
			"closed_trade_count": context.get("history", {}).get("total_trades", 0),
			"news_count": len(context.get("news_headlines", [])),
		},
	}
	# Cache successful analyses for 30 minutes — protects the free-tier quota.
	cache.set_value(key, json.dumps(result), expires_in_sec=1800)
	return result
