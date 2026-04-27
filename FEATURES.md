# Trading Journal — Feature Catalog

A comprehensive Frappe v16 application for Indian retail equity traders. Built around end-of-day decision making, Mark Minervini momentum screening, and disciplined journaling.

**Stack:** Frappe v16.16, Python 3.14, MariaDB, Redis. Charting via TradingView Lightweight Charts. Data via NSE bhavcopy + Yahoo Finance. AI via Google Gemini.

---

## 1. Trade Capture & Tracking

### Trade Doctype
The core record of every trade: entry, exit, stop, target, screenshots, notes, mistake tags, R-multiple, P&L, P&L %.

- **Trade Type** — Long / Short
- **Final Status** — Open / Closed
- **Outcome** — Win / Loss / Breakeven (auto-classified)
- **Setup Type** — VCP, Trend, Breakout, etc. (your taxonomy)
- **Trade Grade** — A/B/C ranking for execution quality
- **Auto-computed fields:** P&L, P&L %, R-multiple, hold days, risk:reward, charges
- **Before / after screenshots** (entry + exit)
- **Current Price** field with on-form refresh button — see "where the stock went after you sold"
- **News + AI Analysis** buttons in the form's menu

### Holding & Position
- **Holding** — current per-broker, per-symbol position (qty, avg cost, last traded price)
- **Position** — multi-leg accumulation tracking (scale-ins / scale-outs across multiple Trade legs)

### Broker Integration
- **Broker** doctype — multi-broker support with API credentials
- **Dhan API** integration for live data
- **Zerodha** support (legacy; user has migrated to Dhan)
- **Trade Import (CSV)** at `/app/trade-import` — auto-detects broker format (Dhan / Zerodha)
  - Routes legs through `trades_sync.promote_legs()` so buys + sells across exchanges accumulate into one closed Long trade
  - Catches errors as JSON instead of HTML 500
  - Includes qty × price totals in the post-exit hint banner

### Indian Charges Calculator
- **STT, exchange fees, brokerage, GST, SEBI fees, stamp duty** — all computed automatically per trade
- **Tax Export** — financial year P&L summary for ITR filing

### Stock Master Data
- **Stock Symbol** — symbol, company name, exchange (NSE/BSE), industry
- **Mistake Tag** — taxonomy of execution mistakes (overstayed loser, FOMO entry, etc.) seeded with a starter set

---

## 2. Visualization Pages

| Page | URL | Purpose |
|---|---|---|
| **Trade Dashboard** | `/app/trade-dashboard` | KPI tiles, equity curve, monthly P&L, best/worst trades, win rate, avg R, attribution by sell date |
| **Trade Kanban** | `/app/trade-kanban` | Visual board grouped by status with drag-to-update |
| **Trade Charts** | `/app/trade-charts` | Before/after screenshot side-by-side review for closed trades. Filter by win/loss/breakeven, mark "chart reviewed" |
| **Trade Review** | `/app/trade-review` | Week-by-week review tool |
| **Portfolio Holdings** | `/app/trade-holdings` | Current positions snapshot across all brokers |
| **Trade Import** | `/app/trade-import` | CSV uploader with broker autodetect |

### Dashboard Cards (highlights)
- Win rate, total P&L, avg R-multiple, total trades
- Equity curve (cumulative ₹P&L over time)
- Monthly P&L bars
- Best / Worst trade cards (correctly handled when only winners exist — no duplicate "worst")
- All cards use `sell_date` (close date) for attribution, not buy_date

---

## 3. Journal & Reflection

### Trading Day
Daily journal with:
- Pre-market plan + watchlist (child table)
- Reflection / lessons
- Linked closed trades for the day
- Mood / energy tracking

### Trade Improvement Note
Standalone notes for lessons that span multiple trades.

### Trade Charts page
Mark trades as "chart reviewed" so they drop out of the backlog. 1W and 1M timeframe support.

---

## 4. Screeners (Nifty 500, Sub-Second)

All screeners run against pre-computed `Stock Daily Snapshot` data. **First scan: < 1 second. All 4 scans: ~2 seconds.**

### Momentum Screener — Mark Minervini Trend Template
`/app/momentum-screener`

Filters Nifty 500 against Minervini's 8 rules:
1. Price > 150-day SMA AND > 200-day SMA
2. 150-day SMA > 200-day SMA
3. 200-day SMA trending up for ≥ 1 month (vs 22 bars ago)
4. 50-day SMA > 150-day SMA > 200-day SMA (proper stack)
5. Price > 50-day SMA
6. Price ≥ 30% above 52-week low
7. Price within 25% of 52-week high
8. RS Rating ≥ 70 (percentile rank of weighted 3/6/9/12-month returns)

Returns symbols passing ≥ 6 of 8. UI filter shows full pass / 7+ / 6+. Click any row to expand the per-rule breakdown.

### VCP Screener — Volatility Contraction Pattern
`/app/vcp-screener`

Detects:
- ≥ 2 successive H→L contractions, each tighter than the previous
- Final contraction ≤ 15%
- Price within ~8% of the most recent pivot high
- Bonus: volume dry-up in the last 10 bars vs prior 40

Expandable detail row shows contraction depths as bars + pivot + volume status.

### Tight Consolidation Screener
`/app/consolidation-screener`

1-month base candidates:
- 22-day range ≤ 8% (configurable: 3% / 5% / 8%)
- Latest close within 5% of range high (breakout-ready)
- Price > 50-SMA AND 50-SMA > 200-SMA (clean uptrend filter)
- Reports volume dry-up ratio

### Near 52w High Screener
`/app/near-high-screener`

Stocks within 20% of their 52-week high in a clean uptrend:
- `pct_from_52w_high ≥ -20%` (configurable: 3% / 5% / 10% / 15% / 20%)
- Price > 50-SMA AND 50-SMA > 200-SMA
- Sorted by closest to high first, then by RS

### Common screener UX
- Hero strip with **Snapshot date**, **Refresh Snapshot**, **Run All 4 Scans**, **Run This Scan** buttons
- **+ Watch** button on every row → adds to Watchlist with current price as pivot
- **Open** link → Stock Symbol form
- **Chart** link → hover for live mini-chart popup, click for TradingView
- Search filter, sort, expandable detail rows
- Polled progress with status badge

### Run All N Scans
Single button on every screener page. One worker job runs all four scans against the same snapshot in 2 seconds, persists 4 separate `Screener Run` docs.

### Screener Run History
`/app/screener-run` — every scan you've run with its results child table preserved.

---

## 5. Speed Layer — Stock Daily Snapshot

The architectural breakthrough: every screener / heatmap / backtest now reads from a pre-computed local table instead of fetching live from Yahoo per symbol.

### Stock Daily Snapshot doctype
One row per (symbol, date), with all indicators pre-computed:
- OHLCV (open / high / low / close / volume)
- SMAs: 50, 150, 200, plus 200-SMA at 22 and 44 bars ago (for trend slope)
- 52-week high / low + % distance from each
- Returns: 3M, 6M, 9M, 12M
- RS score (raw weighted return) + RS rating (1-99 percentile rank)
- 22-day range (high, low, range %)
- Volume ratio (last 10 bars / prior 20 bars)

Unique index on (symbol, date) for instant upserts.

### Daily refresh pipeline
- **NSE bhavcopy fetch** — one HTTP call (~600 KB CSV with all 2,486 traded EQ stocks). 0.13 sec.
- **Bulk upsert** — 500 Nifty 500 rows in 0.25 sec via INSERT ... ON DUPLICATE KEY UPDATE.
- **Indicator compute** — load 280 days of closes from DB into memory, compute everything in Python, bulk write back. 1.6 sec for 500 symbols.

**Total daily refresh: ~2 seconds** (down from 8-10 minutes).

### Bootstrap
On first run if the DB has < 252 days of history: pulls 280 days from Yahoo (~8-10 min, one-time only). Subsequent days come from bhavcopy.

### Manual refresh
**↻ Refresh Snapshot** button on every screener page hero. Queues background job, polls status, shows current snapshot date.

### CLI
```bash
bench --site trade.com execute trading_journal.trading_journal.utils.snapshot.refresh_daily_snapshot
```

---

## 6. Watchlist with Alerts

### Watchlist Item doctype
- Symbol, company, exchange
- Pivot / buy trigger, stop, target
- Source (which screener flagged it, or Manual)
- Status: Active / Triggered / Dismissed / Traded
- Auto-stamped alerted_at timestamp
- Notes

### `/app/watchlist` page
- Hero with refresh-prices button
- Status filter (Active / Triggered / Dismissed / Traded / All)
- KPI cards: total / triggered / near pivot ±2% / ready to trade
- Inline edit dialog for pivot / stop / target / status / notes
- Chart hover preview on every symbol
- "+ Add Symbol" manual add dialog

### Add to Watchlist from screeners
**+ Watch** button on every screener row (Momentum / VCP / Tight Consolidation / Near 52w High). One click → adds with sensible defaults (current price or pivot as buy trigger). Idempotent — re-clicking the same symbol updates instead of duplicating.

### Alert engine (15-min cron, market hours only)
- **Pivot breakout** — price ≥ pivot → Telegram ping + status flip to "Triggered"
- **Stop hit** — informational ping after a triggered item
- **Target hit** — informational ping after a triggered item
- Mon-Fri only, 09:00-15:45 IST window (skips weekends + after-hours)

---

## 7. Telegram Bot

### Telegram Settings (Single doctype)
- Bot token (from @BotFather)
- Chat ID (from @userinfobot)
- Toggle each notification type independently:
  - Daily screener digest
  - Watchlist breakout alerts
  - Open trade stop/target alerts
- HTML help block in the form
- "Test Telegram" action sends a verification message

### Daily digest
After the 8 AM scheduled scan completes, pushes a formatted message:
- Top 5 hits per scanner sorted by RS
- Pass count, current price, link to each screener page
- Skips if no completed runs from today

### Instant alerts
- **Watchlist:** breakout / stop / target with pivot, stop, target, source
- **Open Trades:** stop or target hit on any open `Trade` (Long or Short, exchange-aware)
- 6-hour throttle per Trade to avoid spam

---

## 8. Sector Rotation Heatmap

`/app/sector-heatmap`

Per-Nifty-500-industry returns over 1W / 1M / 3M / 6M:
- Color-coded tiles (deep green for strong outperformance, deep red for strong underperformance)
- Sortable by any window
- Top 3 leaders per sector listed
- 30-min cache (re-runs are sub-second now via snapshot data)
- ~50+ industries shown

---

## 9. Earnings Calendar

`/app/earnings-calendar`

Upcoming results dates for symbols you actually care about:
- Open Trades + Holdings + Active Watchlist (filters down from 500 to ~10-50)
- Source: Yahoo Finance v10 quoteSummary (free, no auth)
- Bucketed: This Week / Next Week / This Month / Later
- Tags showing why each symbol matters (Holding / Open Trade / Watchlist)
- 24h cache per symbol
- "Estimated" badge for unconfirmed dates

---

## 10. Screener Backtest

`/app/screener-backtest`

Replay every scan over the last 6 / 12 / 18 months on monthly snapshots:
- Sample size: 50 / 100 / 200 / 500 (full universe)
- For each test date: re-evaluate filter using only data ≤ that date
- Forward 30-day and 90-day returns measure how the hits actually performed
- Per-scan stats: total hits, hit dates, win rate 30d / 90d, avg return, best, worst

**Now snapshot-backed:** entire backtest reads one SQL query upfront, no Yahoo calls. ~3 seconds for 12 months × 100 symbols.

12-hour cache per (months, sample_size) combo.

---

## 11. AI Integration (Google Gemini, Free Tier)

### AI Settings (Single doctype)
- Gemini API key
- Model selector (Data field, supports any current Gemini model)
- "List Available Models" button — calls Google's ListModels endpoint with your key
- "Test AI Connection" button
- News cache duration, max news items

### Free News (Google News RSS, no auth)
Fetches the top 5-8 headlines for any symbol — Indian-biased (NSE/BSE/stock terms in query). Cached 30 min.

### Stock Analysis
Click "Analyse" on any Trade / Holding / Stock Symbol form → Gemini analyses with full grounding:
- Live price (Yahoo)
- Your trade history on that name (win rate, R, mistakes, avg hold)
- Open positions
- Recent news
- Industry context

Returns formatted Markdown with sections: Snapshot / News Pulse / Technical View / Your Trading Record / Risks & Catalysts / Action Suggestion / Disclaimer.

Cached 30 min per (symbol, model).

---

## 12. Charts & Charts Hover Preview

### Live Price Refresh
`fetch_price()` — Yahoo chart endpoint, free, no auth. Used by:
- Trade form's "Refresh Price" button
- Watchlist alert engine
- AI analysis context
- Open trade stop/target monitor

### Hover Chart Preview (`tj_charts_v2.js`)
On every screener / watchlist row, hover the **Chart** link:
- 620×380 floating popup with TradingView Lightweight Charts (open-source, no widget gating)
- Candlestick + volume histogram
- 6 months of daily data fetched from our own snapshot table (no per-symbol Yahoo calls during hover)
- Live last close + change vs prior close in the header
- "Open in TradingView ↗" link for the full charting experience
- 25-min browser-side data cache so re-hovers are instant

### Trade Charts page (different feature)
Side-by-side before/after screenshot comparison for closed trades. Mark "chart reviewed" so completed reviews drop out of the backlog. Filter by outcome, symbol, date range.

---

## 13. Reports

| Report | Type | Purpose |
|---|---|---|
| **Trade Performance** | Script Report | Cumulative P&L, win rate, avg R by setup type / trade grade / month |
| **Day Wise Results** | Script Report | Per-day P&L breakdown |

Both routed via `is_query_report: 1` (Script Report semantics) so they open correctly from the workspace.

---

## 14. Scheduled Jobs (Crons)

All registered in `hooks.py` `scheduler_events`. Timezone: Asia/Kolkata (System Settings).

| Schedule | Cron | Job |
|---|---|---|
| **Daily 7:00 AM** | `0 7 * * *` | `snapshot.scheduled_daily_snapshot` — pulls bhavcopy, computes indicators (~2 sec) |
| **Daily 8:00 AM** | `0 8 * * *` | `screener.scheduled_daily_scan_all` — runs all 4 screeners, pushes Telegram digest |
| **Every 15 min** | `*/15 * * * *` | `watchlist.check_watchlist_alerts` + `watchlist.check_open_trade_alerts` (market hours only) |

---

## 15. Workspace Layout

`/app/trading-journal` — main hub with:

### Quick Access shortcuts
Trade Dashboard, Trade Kanban, Trade Charts, Trade Review, Trade, Portfolio Holdings, Trade Import, Broker

### Modules cards
- **Trading** — Trade, Trade Kanban, Trade Import (CSV)
- **Portfolio** — Portfolio Holdings, Holding, Position
- **Screeners** — Momentum, VCP, Tight Consolidation, Near 52w High, Screener Run History
- **Tools** — Watchlist, Sector Heatmap, Earnings Calendar, Screener Backtest, Telegram Settings
- **Masters** — Broker, Stock Symbol, Mistake Tag
- **Review & Journal** — Trading Day, Trade Improvement Note
- **Analytics** — Trade Dashboard, Trade Review, Trade Charts, Trade Performance, Day Wise Results

---

## 16. Settings

| Doctype | Type | Purpose |
|---|---|---|
| **AI Settings** | Single | Gemini API key, model, cache durations |
| **Telegram Settings** | Single | Bot token, chat ID, notification toggles |

---

## 17. Performance Summary

| Operation | Implementation | Speed |
|---|---|---|
| Run one screener | SQL filter on `Stock Daily Snapshot` | **~0.3 sec** |
| Run all 4 screeners | One pass over snapshot table | **~2 sec** |
| Sector heatmap | Per-symbol close history from snapshot | **< 1 sec** |
| Backtest 12mo × 100 syms | In-memory replay over snapshot | **~3 sec** |
| Daily snapshot refresh | Bhavcopy CSV + bulk upsert + Python compute | **~2 sec** |
| Earnings calendar | Yahoo quoteSummary for ~10-50 tracked symbols | **5-30 sec** (cached 24h) |
| Watchlist alerts | Yahoo per-symbol price ping | ~10 sec / 100 watchlist items |
| AI analysis | Gemini call with full context | 5-15 sec (cached 30 min) |

---

## 18. Data Sources

All free, no API key required (except Gemini which is free tier).

- **NSE Bhavcopy** — `nsearchives.nseindia.com/products/content/sec_bhavdata_full_DDMMYYYY.csv` — daily OHLCV for every NSE EQ stock
- **NSE Nifty 500 list** — `nsearchives.nseindia.com/content/indices/ind_nifty500list.csv` (with bundled fallback CSV in `data/nifty500.csv`)
- **Yahoo Finance Chart** — `query1.finance.yahoo.com/v8/finance/chart/{symbol}.NS` — OHLC history for bootstrap, hover charts, single price refresh
- **Yahoo Finance QuoteSummary** — `query1.finance.yahoo.com/v10/finance/quoteSummary/{symbol}.NS?modules=calendarEvents,earnings` — earnings dates
- **Google News RSS** — `news.google.com/rss/search` — Indian financial news per symbol
- **Google Gemini API** — free tier, used for stock analysis

---

## 19. File / Module Map

```
trading_journal/
├── hooks.py                          — app config, app_include_js, scheduler_events
├── data/
│   └── nifty500.csv                  — bundled snapshot of Nifty 500 (501 lines)
├── public/js/
│   ├── tj_ai.js                      — global AI buttons (News + Analyse)
│   └── tj_charts_v2.js               — hover chart popup (Lightweight Charts)
├── trading_journal/
│   ├── doctype/                      (DocTypes)
│   │   ├── trade/                    — core trade record
│   │   ├── holding/                  — broker holdings
│   │   ├── position/                 — multi-leg accumulation
│   │   ├── broker/                   — broker config
│   │   ├── stock_symbol/             — symbol master
│   │   ├── mistake_tag/              — mistake taxonomy
│   │   ├── trading_day/              — daily plan + reflection
│   │   ├── trade_improvement_note/   — standalone lessons
│   │   ├── ai_settings/              — Gemini config
│   │   ├── telegram_settings/        — bot config
│   │   ├── screener_run/             — screener result history
│   │   ├── screener_result/          — screener result child rows
│   │   ├── stock_daily_snapshot/     — pre-computed indicator table
│   │   ├── watchlist_item/           — watchlist with alerts
│   │   └── ...
│   ├── page/                         (Custom pages)
│   │   ├── trade_dashboard/
│   │   ├── trade_kanban/
│   │   ├── trade_charts/
│   │   ├── trade_review/
│   │   ├── trade_holdings/
│   │   ├── trade_import/
│   │   ├── momentum_screener/        — Trend Template
│   │   ├── vcp_screener/             — VCP
│   │   ├── consolidation_screener/   — Tight Consolidation
│   │   ├── near_high_screener/       — Near 52w High
│   │   ├── watchlist/
│   │   ├── sector_heatmap/
│   │   ├── earnings_calendar/
│   │   ├── screener_backtest/
│   │   └── zerodha_callback/
│   ├── utils/                        (Engine modules)
│   │   ├── snapshot.py               — bhavcopy + indicator pipeline
│   │   ├── screener.py               — 4 scan types, snapshot-backed
│   │   ├── sector_heatmap.py         — sector aggregation
│   │   ├── earnings.py               — Yahoo quoteSummary
│   │   ├── backtest.py               — historical replay
│   │   ├── watchlist.py              — alert engine
│   │   ├── telegram.py               — Telegram helpers
│   │   ├── ai_assistant.py           — Gemini + Google News
│   │   ├── market_data.py            — Yahoo price fetcher
│   │   ├── trades_sync.py            — leg accumulation engine
│   │   ├── broker_import.py          — CSV import (Dhan/Zerodha)
│   │   ├── dhan_client.py            — Dhan API client
│   │   ├── zerodha_client.py         — Zerodha API client (legacy)
│   │   ├── indian_charges.py         — STT/brokerage/GST calculator
│   │   ├── tax_export.py             — FY P&L export
│   │   ├── scrip_sync.py             — Stock Symbol seeding
│   │   └── seed_mistakes.py          — Mistake Tag seeding
│   ├── workspace/
│   │   └── trading_journal/          — main workspace JSON
│   └── report/                       (Script Reports)
│       ├── trade_performance/
│       └── day_wise_results/
```

---

## 20. Key Architectural Decisions

1. **Pre-compute > re-compute** — Stock Daily Snapshot table makes every read-heavy operation sub-second by paying the cost once a day in the cron, not on every user click.

2. **Bulk fetch > per-symbol fetch** — One NSE bhavcopy call (600 KB) replaces 500 Yahoo calls. ~600× speedup for daily refresh.

3. **SQL where possible, Python where necessary** — Trend Template, Tight Consolidation, and Near 52w High are pure column-comparison filters expressed in SQL. VCP needs swing-pivot detection so it stays per-symbol but reads from the snapshot table (still no Yahoo).

4. **Free-tier first** — every external API used is free: NSE archives, Yahoo Finance, Google News RSS, Gemini free tier. No paid subscriptions required.

5. **One snapshot = one source of truth** — every downstream feature (screeners, sector heatmap, backtest) reads the same pre-computed table. Add a new column, get it everywhere.

6. **Frappe-native** — uses Frappe's permission system, list views, form views, scheduler, background jobs, cache, and audit log. No external app server.

---

*Generated 2026-04-27. Last meaningful refactor: snapshot-backed scans (2026-04-27).*
