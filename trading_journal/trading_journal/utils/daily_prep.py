"""Daily prep data aggregator — morning briefing for the trader."""

import json
import frappe
from frappe.utils import flt, now_datetime, nowdate


@frappe.whitelist()
def get_daily_prep_data() -> dict:
	"""Single call returning everything needed for the morning briefing page."""
	from trading_journal.trading_journal.utils.screener import get_market_breadth, get_run_status
	from trading_journal.trading_journal.utils.sector_heatmap import get_cached_heatmap
	from trading_journal.trading_journal.utils.snapshot import latest_snapshot_date

	out = {}

	# ── Market breadth ─────────────────────────────────────────────────────
	try:
		out["breadth"] = get_market_breadth()
	except Exception:
		out["breadth"] = {"ok": False}

	# ── Sector leaders ──────────────────────────────────────────────────────
	try:
		hm = get_cached_heatmap()
		sectors = hm.get("sectors") or []
		leading   = [s for s in sectors if s.get("quadrant") == "Leading"]
		improving = [s for s in sectors if s.get("quadrant") == "Improving"]
		leading.sort(key=lambda s: -(s.get("rotation_score") or -999))
		improving.sort(key=lambda s: -(s.get("momentum_delta") or -999))
		out["sector_leaders"] = {
			"leading":   leading[:4],
			"improving": improving[:4],
			"snapshot_date": hm.get("snapshot_date"),
		}
	except Exception:
		out["sector_leaders"] = {}

	# ── Latest VCP + Breakout scan results ─────────────────────────────────
	try:
		def _latest_completed(scan_type):
			rows = frappe.get_all(
				"Screener Run",
				filters={"scan_type": scan_type, "status": "Completed"},
				fields=["name", "completed_at", "passed_count"],
				order_by="completed_at desc",
				limit=1,
			)
			if not rows:
				return None
			r = rows[0]
			detail = get_run_status(r.name)
			return {
				"name": r.name,
				"completed_at": str(r.completed_at),
				"passed_count": r.passed_count,
				"results": (detail.get("results") or [])[:8],
			}

		out["vcp_scan"]      = _latest_completed("VCP")
		out["breakout_scan"] = _latest_completed("52W Breakout")
	except Exception:
		out["vcp_scan"] = out["breakout_scan"] = None

	# ── Open positions ──────────────────────────────────────────────────────
	try:
		target = latest_snapshot_date()
		snap_date = target.isoformat() if target else nowdate()
		open_trades = frappe.db.sql(
			"""
			SELECT t.name, t.symbol, t.trade_type, t.entry_price, t.stop_loss,
			       t.target, t.quantity, t.broker, t.setup_type, t.trade_date,
			       COALESCE(s_direct.close_price, s_alias.close_price, t.current_price) AS current_price,
			       t.entry_price - t.stop_loss AS risk_per_share
			FROM `tabTrade` t
			/* direct ticker match */
			LEFT JOIN `tabStock Daily Snapshot` s_direct
			  ON s_direct.symbol = t.symbol AND s_direct.date = %s
			/* alias lookup: if trade stores a company name, resolve via Stock Symbol */
			LEFT JOIN `tabStock Symbol` ss ON ss.name = t.symbol AND ss.symbol != t.symbol
			LEFT JOIN `tabStock Daily Snapshot` s_alias
			  ON s_alias.symbol = ss.symbol AND s_alias.date = %s
			WHERE t.status = 'Open'
			ORDER BY t.trade_date ASC
			""",
			(snap_date, snap_date),
			as_dict=True,
		)
		positions = []
		for t in open_trades:
			entry  = flt(t.entry_price)
			sl     = flt(t.stop_loss)
			tgt    = flt(t.target)
			curr   = flt(t.current_price) or entry
			qty    = flt(t.quantity) or 1
			is_long = (t.trade_type or "Long").lower() != "short"

			if is_long:
				unreal_pnl = (curr - entry) * qty
				sl_pct     = round((curr - sl) / curr * 100, 2) if curr else 0
				tgt_pct    = round((tgt - curr) / curr * 100, 2) if curr and tgt else None
			else:
				unreal_pnl = (entry - curr) * qty
				sl_pct     = round((sl - curr) / curr * 100, 2) if curr else 0
				tgt_pct    = round((curr - tgt) / curr * 100, 2) if curr and tgt else None

			risk_amt = abs(entry - sl) * qty if sl else 0
			positions.append({
				"name": t.name,
				"symbol": t.symbol,
				"trade_type": t.trade_type,
				"entry": entry,
				"sl": sl,
				"target": tgt,
				"current": curr,
				"qty": qty,
				"unrealized_pnl": round(unreal_pnl, 2),
				"sl_distance_pct": sl_pct,
				"target_distance_pct": tgt_pct,
				"risk_amount": round(risk_amt, 2),
				"setup_type": t.setup_type,
				"broker": t.broker,
				"trade_date": str(t.trade_date) if t.trade_date else "",
				"above_entry": curr > entry if is_long else curr < entry,
			})
		out["open_positions"] = positions
	except Exception as e:
		out["open_positions"] = []

	# ── Watchlist items near alert ──────────────────────────────────────────
	try:
		wl = frappe.db.sql(
			"""
			SELECT w.symbol, w.alert_price, w.notes, w.scan_source,
			       COALESCE(s.close_price, 0) AS current_price
			FROM `tabWatchlist Item` w
			LEFT JOIN `tabStock Daily Snapshot` s
			  ON s.symbol = w.symbol AND s.date = (
			     SELECT MAX(date) FROM `tabStock Daily Snapshot` WHERE symbol = w.symbol AND is_nifty500 = 1
			  )
			WHERE w.status = 'Active'
			ORDER BY w.creation DESC
			LIMIT 30
			""",
			as_dict=True,
		)
		for item in wl:
			curr  = flt(item.current_price)
			alert = flt(item.alert_price)
			item["pct_to_alert"] = round((alert - curr) / curr * 100, 2) if curr and alert else None
			item["near_alert"]   = abs(item["pct_to_alert"] or 999) <= 3
		out["watchlist"] = sorted(wl, key=lambda x: abs(x.get("pct_to_alert") or 999))
	except Exception:
		out["watchlist"] = []

	# ── Today's earnings ────────────────────────────────────────────────────
	try:
		today = nowdate()
		earnings = frappe.db.sql(
			"""
			SELECT symbol, result_date, result_type, consensus_estimate
			FROM `tabEarnings Event`
			WHERE result_date BETWEEN %s AND DATE_ADD(%s, INTERVAL 5 DAY)
			ORDER BY result_date ASC
			LIMIT 20
			""",
			(today, today),
			as_dict=True,
		)
		out["upcoming_earnings"] = [dict(e) for e in earnings]
	except Exception:
		out["upcoming_earnings"] = []

	out["generated_at"] = now_datetime().isoformat()
	return out
