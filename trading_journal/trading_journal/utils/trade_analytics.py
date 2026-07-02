"""Trade performance analytics — retrospective stats for all closed trades."""

import frappe
from frappe.utils import flt
from collections import defaultdict


@frappe.whitelist()
def get_trade_analytics(period: str = "ALL", from_date: str = None, to_date: str = None) -> dict:
    """Aggregate closed-trade statistics across all dimensions."""
    params: list = []
    date_filter = ""

    if from_date and to_date:
        date_filter = "AND trade_date BETWEEN %s AND %s"
        params = [from_date, to_date]
    elif period != "ALL":
        days = {"1M": 30, "3M": 90, "6M": 180, "1Y": 365}.get(period, 9999)
        date_filter = "AND trade_date >= DATE_SUB(CURDATE(), INTERVAL %s DAY)"
        params = [days]

    sql = f"""
        SELECT symbol, company_name, trade_type, status, nature, setup_type,
               broker, timeframe, trade_grade, r_multiple,
               entry_price, exit_price, net_pnl, hold_days,
               trade_date, sell_date, quantity, stop_loss, target
        FROM `tabTrade`
        WHERE status IN ('Win', 'Loss') {date_filter}
        ORDER BY trade_date ASC, creation ASC
        """
    trades = frappe.db.sql(sql, params if params else (), as_dict=True)

    if not trades:
        return {"period": period, "total": 0, "ok": True}

    wins   = [t for t in trades if t.status == "Win"]
    losses = [t for t in trades if t.status == "Loss"]

    total      = len(trades)
    win_count  = len(wins)
    loss_count = len(losses)
    win_rate   = win_count / total * 100

    total_pnl  = sum(flt(t.net_pnl) for t in trades)
    wins_pnl   = sum(flt(t.net_pnl) for t in wins)
    losses_pnl = sum(flt(t.net_pnl) for t in losses)

    avg_win  = wins_pnl  / win_count  if win_count  else 0
    avg_loss = losses_pnl / loss_count if loss_count else 0

    profit_factor = wins_pnl / abs(losses_pnl) if losses_pnl else None
    expectancy    = (win_rate / 100 * avg_win) + ((1 - win_rate / 100) * avg_loss)
    avg_rr        = abs(avg_win / avg_loss) if avg_loss else None
    avg_hold      = sum(flt(t.hold_days) for t in trades) / total

    best  = max(trades, key=lambda t: flt(t.net_pnl))
    worst = min(trades, key=lambda t: flt(t.net_pnl))

    # ── Win/Loss streaks ─────────────────────────────────────────────────────
    max_w = max_l = cur_w = cur_l = 0
    for t in trades:          # oldest → newest
        if t.status == "Win":
            cur_w += 1; cur_l = 0; max_w = max(max_w, cur_w)
        else:
            cur_l += 1; cur_w = 0; max_l = max(max_l, cur_l)

    # Current streak (from most recent backwards)
    streak_type = trades[-1].status
    streak_cnt  = 0
    for t in reversed(trades):
        if t.status == streak_type:
            streak_cnt += 1
        else:
            break

    # ── Grouped breakdowns ───────────────────────────────────────────────────
    def _breakdown(key_fn, label):
        groups = defaultdict(lambda: {"trades": 0, "wins": 0, "pnl": 0.0})
        for t in trades:
            k = key_fn(t) or "—"
            groups[k]["trades"] += 1
            if t.status == "Win":
                groups[k]["wins"] += 1
            groups[k]["pnl"] += flt(t.net_pnl)
        result = []
        for k, g in groups.items():
            g[label] = k
            g["win_rate"] = round(g["wins"] / g["trades"] * 100, 1)
            g["pnl"]      = round(g["pnl"], 2)
            result.append(g)
        return sorted(result, key=lambda x: -x["pnl"])

    by_nature = _breakdown(lambda t: t.nature,      "nature")
    by_setup  = _breakdown(lambda t: t.setup_type,  "setup_type")
    by_broker = _breakdown(lambda t: t.broker,      "broker")

    # ── Monthly P&L ──────────────────────────────────────────────────────────
    monthly: dict = defaultdict(lambda: {"month": "", "trades": 0, "wins": 0, "pnl": 0.0})
    for t in trades:
        m = str(t.sell_date or t.trade_date)[:7]
        monthly[m]["month"]  = m
        monthly[m]["trades"] += 1
        if t.status == "Win":
            monthly[m]["wins"] += 1
        monthly[m]["pnl"] += flt(t.net_pnl)
    monthly_list = []
    for entry in sorted(monthly.values(), key=lambda x: x["month"]):
        entry["pnl"]      = round(entry["pnl"], 2)
        entry["win_rate"] = round(entry["wins"] / entry["trades"] * 100, 1)
        monthly_list.append(entry)

    # ── Daily P&L + Equity Curve ─────────────────────────────────────────────
    daily: dict = defaultdict(float)
    for t in trades:
        d = str(t.sell_date or t.trade_date)
        daily[d] += flt(t.net_pnl)

    running = 0.0
    equity_curve = []
    for d in sorted(daily):
        running += daily[d]
        equity_curve.append({"date": d, "cumulative": round(running, 2)})

    daily_pnl = {d: round(v, 2) for d, v in daily.items()}

    # ── Max Drawdown ─────────────────────────────────────────────────────────
    peak = 0.0
    max_dd = 0.0
    running_dd = 0.0
    for pt in equity_curve:
        val = pt["cumulative"]
        if val > peak:
            peak = val
        dd = peak - val
        if dd > max_dd:
            max_dd = dd
    max_drawdown_pct = round(max_dd / peak * 100, 1) if peak > 0 else 0

    # ── Recent trades (newest first) ─────────────────────────────────────────
    recent = []
    for t in reversed(trades):
        recent.append({
            "symbol":     t.symbol,
            "trade_type": t.trade_type,
            "status":     t.status,
            "nature":     t.nature or "—",
            "setup_type": t.setup_type or "—",
            "broker":     t.broker or "—",
            "trade_date": str(t.trade_date),
            "sell_date":  str(t.sell_date) if t.sell_date else "",
            "entry_price": flt(t.entry_price),
            "exit_price":  flt(t.exit_price),
            "net_pnl":     round(flt(t.net_pnl), 2),
            "hold_days":   flt(t.hold_days),
            "r_multiple":  flt(t.r_multiple),
        })

    return {
        "ok":          True,
        "period":      period,
        "total":       total,
        "win_count":   win_count,
        "loss_count":  loss_count,
        "win_rate":    round(win_rate, 1),
        "total_pnl":   round(total_pnl, 2),
        "wins_pnl":    round(wins_pnl, 2),
        "losses_pnl":  round(losses_pnl, 2),
        "avg_win":     round(avg_win, 2),
        "avg_loss":    round(avg_loss, 2),
        "profit_factor": round(profit_factor, 2) if profit_factor is not None else None,
        "expectancy":  round(expectancy, 2),
        "avg_rr":      round(avg_rr, 2) if avg_rr else None,
        "avg_hold_days": round(avg_hold, 1),
        "max_drawdown":  round(max_dd, 2),
        "max_drawdown_pct": max_drawdown_pct,
        "best_trade":  {"symbol": best.symbol,  "pnl": round(flt(best.net_pnl),  2)},
        "worst_trade": {"symbol": worst.symbol, "pnl": round(flt(worst.net_pnl), 2)},
        "max_win_streak":  max_w,
        "max_loss_streak": max_l,
        "current_streak":  {"type": streak_type, "count": streak_cnt},
        "by_nature":   by_nature,
        "by_setup":    by_setup,
        "by_broker":   by_broker,
        "monthly":     monthly_list,
        "daily_pnl":   daily_pnl,
        "equity_curve": equity_curve,
        "recent":      recent,
    }
