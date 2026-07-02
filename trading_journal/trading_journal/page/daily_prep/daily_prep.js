frappe.pages["daily-prep"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Daily Market Prep",
		single_column: true,
	});
	new DailyPrepPage(page);
};

class DailyPrepPage {
	constructor(page) {
		this.page = page;
		this.data = null;
		this._inject_styles();
		this._render_skeleton();
		this._load();
	}

	_inject_styles() {
		if (document.getElementById("tj-dp-css")) return;
		const css = `
		.tj-dp-wrap { padding: 14px; }

		/* ── Hero ── */
		.tj-dp-hero {
			background: linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #1a1035 100%);
			border-radius: 14px; padding: 22px 28px; color: #fff; margin-bottom: 18px;
			display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;
			position: relative; overflow: hidden;
		}
		.tj-dp-hero::before {
			content: ""; position: absolute; inset: 0;
			background: radial-gradient(900px 250px at 85% -20%, rgba(139,92,246,.2), transparent 55%);
			pointer-events: none;
		}
		.tj-dp-hero-left h2 { margin: 0; font-size: 24px; font-weight: 900; }
		.tj-dp-hero-left .date { font-size: 13px; opacity: .7; margin-top: 3px; }
		.tj-dp-refresh {
			background: rgba(255,255,255,.12); color: #fff; font-weight: 700;
			padding: 9px 18px; border-radius: 8px; border: 1px solid rgba(255,255,255,.25);
			cursor: pointer; font-size: 12px; transition: background .15s;
		}
		.tj-dp-refresh:hover { background: rgba(255,255,255,.22); }
		.tj-dp-quicklinks { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
		.tj-dp-qlink {
			font-size: 11px; font-weight: 700; padding: 5px 12px; border-radius: 6px;
			background: rgba(255,255,255,.1); color: rgba(255,255,255,.8);
			text-decoration: none; border: 1px solid rgba(255,255,255,.15);
			transition: background .15s;
		}
		.tj-dp-qlink:hover { background: rgba(255,255,255,.2); color: #fff; }

		/* ── Section cards ── */
		.tj-dp-section {
			background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
			margin-bottom: 16px; overflow: hidden;
		}
		.tj-dp-section-head {
			padding: 14px 20px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
			font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .6px; color: #475569;
			display: flex; align-items: center; gap: 10px; justify-content: space-between;
		}
		.tj-dp-section-head .left { display: flex; align-items: center; gap: 8px; }
		.tj-dp-section-head .left::before { content: ""; width: 4px; height: 14px; border-radius: 2px;
			background: var(--tj-dp-accent, linear-gradient(180deg, #6366f1, #8b5cf6)); }
		.tj-dp-section-body { padding: 16px 20px; }

		/* ── Market Pulse grid ── */
		.tj-dp-pulse-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
		.tj-dp-pulse-card {
			background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 14px; text-align: center;
		}
		.tj-dp-pulse-card .icon { font-size: 20px; margin-bottom: 4px; }
		.tj-dp-pulse-card .val { font-size: 22px; font-weight: 900; }
		.tj-dp-pulse-card .lbl { font-size: 10px; font-weight: 700; text-transform: uppercase;
			letter-spacing: .4px; color: #64748b; margin-top: 2px; }
		.tj-dp-sma-bars { margin-top: 10px; }
		.tj-dp-sma-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
		.tj-dp-sma-label { font-size: 10px; color: #94a3b8; font-weight: 700; width: 52px; }
		.tj-dp-sma-track { flex: 1; height: 6px; background: #f1f5f9; border-radius: 999px; overflow: hidden; }
		.tj-dp-sma-fill { height: 100%; border-radius: 999px; }
		.tj-dp-sma-val { font-size: 11px; font-weight: 800; width: 36px; text-align: right; }

		/* ── Regime badge ── */
		.tj-dp-regime {
			display: inline-flex; align-items: center; gap: 6px;
			padding: 6px 16px; border-radius: 999px; font-size: 13px; font-weight: 800;
			letter-spacing: .3px;
		}

		/* ── Sectors ── */
		.tj-dp-sectors { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
		.tj-dp-sector-chip {
			background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
			padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;
		}
		.tj-dp-sector-name { font-size: 12px; font-weight: 700; color: #0f172a; }
		.tj-dp-sector-ret { font-size: 12px; font-weight: 800; }
		.tj-dp-sector-leaders { font-size: 10px; color: #64748b; margin-top: 2px; }

		/* ── Setups ── */
		.tj-dp-setup-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
		.tj-dp-setup-card {
			background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 14px; display: flex; flex-direction: column; gap: 4px;
		}
		.tj-dp-setup-sym { font-size: 14px; font-weight: 900; color: #4c1d95; }
		.tj-dp-setup-sym a { color: inherit; text-decoration: none; }
		.tj-dp-setup-price { font-size: 12px; font-weight: 700; color: #0f172a; }
		.tj-dp-setup-meta { font-size: 10px; color: #64748b; }
		.tj-dp-setup-badge { display: inline-block; padding: 2px 8px; border-radius: 999px;
			font-size: 10px; font-weight: 700; margin-top: 4px; }

		/* ── Open positions ── */
		.tj-dp-pos-table { width: 100%; border-collapse: collapse; font-size: 13px; }
		.tj-dp-pos-table th { font-size: 10px; font-weight: 700; text-transform: uppercase;
			letter-spacing: .4px; color: #64748b; padding: 8px 12px;
			background: #f8fafc; border-bottom: 1px solid #e2e8f0; text-align: left; }
		.tj-dp-pos-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
		.tj-dp-pos-table tr:last-child td { border-bottom: 0; }
		.tj-dp-pos-sym { font-weight: 800; font-size: 13px; }
		.tj-dp-pos-sym a { color: #4c1d95; text-decoration: none; }
		.tj-dp-pos-num { font-variant-numeric: tabular-nums; text-align: right; font-weight: 700; }
		.tj-dp-sl-bar { height: 6px; border-radius: 999px; background: #f1f5f9; overflow: hidden; margin-top: 3px; }
		.tj-dp-sl-fill { height: 100%; border-radius: 999px; }

		/* ── Watchlist ── */
		.tj-dp-wl-row { display: flex; justify-content: space-between; align-items: center;
			padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
		.tj-dp-wl-row:last-child { border-bottom: 0; }
		.tj-dp-wl-sym { font-size: 13px; font-weight: 800; color: #0f172a; }
		.tj-dp-wl-alert { font-size: 11px; color: #64748b; margin-top: 2px; }
		.tj-dp-wl-pct { font-size: 14px; font-weight: 900; }
		.tj-dp-near-chip { display: inline-block; padding: 2px 8px; border-radius: 999px;
			font-size: 10px; font-weight: 700; background: #fef3c7; color: #92400e; margin-left: 6px; }

		.tj-dp-empty { color: #94a3b8; font-size: 12px; font-style: italic; padding: 8px 0; }
		`;
		const s = document.createElement("style");
		s.id = "tj-dp-css";
		s.textContent = css;
		document.head.appendChild(s);
	}

	_render_skeleton() {
		const now = new Date();
		const dateStr = now.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
		const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";

		$(this.page.body).empty().append(`
			<div class="tj-dp-wrap">
				<div class="tj-dp-hero">
					<div class="tj-dp-hero-left">
						<h2>☀️ ${greeting}</h2>
						<div class="date">${dateStr} · Loading market data…</div>
						<div class="tj-dp-quicklinks">
							<a href="/app/position-sizer" class="tj-dp-qlink">⚖️ Position Sizer</a>
							<a href="/app/vcp-screener" class="tj-dp-qlink">🌀 VCP</a>
							<a href="/app/breakout-screener" class="tj-dp-qlink">🏔 Breakouts</a>
							<a href="/app/sector-heatmap" class="tj-dp-qlink">🗺 Sectors</a>
							<a href="/app/watchlist" class="tj-dp-qlink">👁 Watchlist</a>
							<a href="/app/trade-dashboard" class="tj-dp-qlink">📊 Dashboard</a>
						</div>
					</div>
					<button class="tj-dp-refresh" id="tj-dp-reload">↻ Refresh</button>
				</div>

				<div id="tj-dp-content" style="color:#94a3b8;text-align:center;padding:40px;">Loading briefing…</div>
			</div>
		`);
		$(this.page.body).find("#tj-dp-reload").on("click", () => this._load());
	}

	_load() {
		$(this.page.body).find("#tj-dp-content").html(`<div style="text-align:center;padding:30px;color:#94a3b8;">Loading…</div>`);
		frappe.call({
			method: "trading_journal.trading_journal.utils.daily_prep.get_daily_prep_data",
			callback: (r) => {
				const m = r.message || {};
				this.data = m;
				this._render(m);
			},
			error: () => {
				$(this.page.body).find("#tj-dp-content").html(`<div style="color:#ef4444;padding:20px;">Failed to load — check error logs.</div>`);
			},
		});
	}

	_render(d) {
		const $c = $(this.page.body).find("#tj-dp-content");
		const b = d.breadth || {};
		const sl = d.sector_leaders || {};
		const positions = d.open_positions || [];
		const watchlist = d.watchlist || [];
		const vcpScan = d.vcp_scan;
		const boScan  = d.breakout_scan;

		const fmtR = (v) => v === null || v === undefined ? "—" : `${v >= 0 ? "+" : ""}${parseFloat(v).toFixed(2)}%`;
		const pnlColor = (v) => v >= 0 ? "#10b981" : "#ef4444";

		$c.html(`
			${this._render_market_pulse(b)}
			${this._render_sectors(sl)}
			${this._render_setups(vcpScan, boScan)}
			${this._render_positions(positions)}
			${this._render_watchlist(watchlist)}
		`);
	}

	_market_regime(b) {
		const sma50  = b.above_sma50_pct  || 0;
		const sma200 = b.above_sma200_pct || 0;
		const adR    = b.ad_ratio || 0;
		if (sma50 >= 65 && sma200 >= 55 && adR >= 1.3)
			return { label: "🐂 Bull Market",   color: "#10b981", bg: "#d1fae5", border: "#6ee7b7" };
		if (sma50 >= 50 && sma200 >= 45)
			return { label: "😐 Neutral Market", color: "#f59e0b", bg: "#fef3c7", border: "#fde68a" };
		if (sma50 < 40 && sma200 < 40)
			return { label: "🐻 Bear Market",   color: "#ef4444", bg: "#fee2e2", border: "#fca5a5" };
		return { label: "🌫 Mixed",             color: "#64748b", bg: "#f1f5f9", border: "#cbd5e1" };
	}

	_render_market_pulse(b) {
		if (!b.ok) return `<div class="tj-dp-section"><div class="tj-dp-section-head"><div class="left">Market Pulse</div></div><div class="tj-dp-section-body"><div class="tj-dp-empty">No snapshot data available.</div></div></div>`;
		const regime = this._market_regime(b);
		const adColor = (b.ad_ratio || 0) >= 1.3 ? "#10b981" : ((b.ad_ratio || 0) < 0.8 ? "#ef4444" : "#f59e0b");
		const rsColor = (b.above_sma200_pct || 0) >= 55 ? "#10b981" : ((b.above_sma200_pct || 0) < 40 ? "#ef4444" : "#f59e0b");
		return `
			<div class="tj-dp-section" style="--tj-dp-accent: linear-gradient(180deg, #6366f1, #8b5cf6);">
				<div class="tj-dp-section-head">
					<div class="left">Market Pulse · ${b.date || ""}</div>
					<span class="tj-dp-regime" style="background:${regime.bg};color:${regime.color};border:1.5px solid ${regime.border};">${regime.label}</span>
				</div>
				<div class="tj-dp-section-body">
					<div class="tj-dp-pulse-grid">
						<div class="tj-dp-pulse-card">
							<div class="icon">📊</div>
							<div class="val" style="color:${rsColor}">${(b.above_sma50_pct || 0).toFixed(1)}%</div>
							<div class="lbl">Above SMA 50</div>
						</div>
						<div class="tj-dp-pulse-card">
							<div class="icon">📈</div>
							<div class="val" style="color:${rsColor}">${(b.above_sma200_pct || 0).toFixed(1)}%</div>
							<div class="lbl">Above SMA 200</div>
						</div>
						<div class="tj-dp-pulse-card">
							<div class="icon">⚡</div>
							<div class="val" style="color:${adColor}">${(b.ad_ratio || 0).toFixed(2)}</div>
							<div class="lbl">A/D Ratio</div>
						</div>
						<div class="tj-dp-pulse-card">
							<div class="icon">🏔</div>
							<div class="val" style="color:#0ea5e9">${b.near_52w_high || 0}</div>
							<div class="lbl">Near 52W High</div>
						</div>
						<div class="tj-dp-pulse-card">
							<div class="icon">🌀</div>
							<div class="val" style="color:#8b5cf6">${b.vcp_setups || 0}</div>
							<div class="lbl">VCP Setups</div>
						</div>
						<div class="tj-dp-pulse-card">
							<div class="icon">🎯</div>
							<div class="val" style="color:#6366f1">${b.rs_strong || 0}</div>
							<div class="lbl">RS ≥ 70</div>
						</div>
					</div>
					<div class="tj-dp-sma-bars" style="margin-top:14px;">
						${[
							{ label: "SMA 50",  val: b.above_sma50_pct  || 0, color: "#6366f1" },
							{ label: "SMA 150", val: b.above_sma150_pct || 0, color: "#8b5cf6" },
							{ label: "SMA 200", val: b.above_sma200_pct || 0, color: "#a78bfa" },
						].map(row => `
							<div class="tj-dp-sma-row">
								<span class="tj-dp-sma-label">${row.label}</span>
								<div class="tj-dp-sma-track">
									<div class="tj-dp-sma-fill" style="width:${row.val}%;background:${row.color};"></div>
								</div>
								<span class="tj-dp-sma-val" style="color:${row.color}">${row.val.toFixed(1)}%</span>
							</div>
						`).join("")}
					</div>
					<div style="display:flex;gap:12px;margin-top:10px;font-size:12px;color:#64748b;font-weight:600;">
						<span style="color:#10b981;font-weight:700;">▲ ${b.advancing || 0} advancing</span>
						<span>·</span>
						<span style="color:#ef4444;font-weight:700;">▼ ${b.declining || 0} declining</span>
						<span>·</span>
						<span>Avg RS: <b style="color:#6366f1">${(b.avg_rs || 0).toFixed(1)}</b></span>
					</div>
				</div>
			</div>
		`;
	}

	_render_sectors(sl) {
		const leading   = sl.leading   || [];
		const improving = sl.improving || [];
		if (!leading.length && !improving.length) return "";
		const fmtR = (v) => v === null || v === undefined ? "" : ` (${v >= 0 ? "+" : ""}${v.toFixed(1)}%)`;
		const chip = (s, accentColor) => `
			<div class="tj-dp-sector-chip">
				<div>
					<div class="tj-dp-sector-name">${frappe.utils.escape_html(s.industry || "")}</div>
					<div class="tj-dp-sector-leaders">${(s.top_3_1m || []).slice(0, 3).map(l => l.symbol).join(" · ")}</div>
				</div>
				<div class="tj-dp-sector-ret" style="color:${accentColor}">${fmtR(s.ret_1M)}</div>
			</div>
		`;
		return `
			<div class="tj-dp-section" style="--tj-dp-accent: linear-gradient(180deg, #10b981, #0ea5e9);">
				<div class="tj-dp-section-head"><div class="left">Sector Rotation</div><a href="/app/sector-heatmap" style="font-size:11px;color:#64748b;text-decoration:none;font-weight:700;">Full RRG →</a></div>
				<div class="tj-dp-section-body">
					<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
						<div>
							<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#10b981;margin-bottom:8px;">🚀 Leading</div>
							<div class="tj-dp-sectors">${leading.map(s => chip(s, "#10b981")).join("") || `<div class="tj-dp-empty">—</div>`}</div>
						</div>
						<div>
							<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#3b82f6;margin-bottom:8px;">📈 Improving</div>
							<div class="tj-dp-sectors">${improving.map(s => chip(s, "#3b82f6")).join("") || `<div class="tj-dp-empty">—</div>`}</div>
						</div>
					</div>
				</div>
			</div>
		`;
	}

	_render_setups(vcpScan, boScan) {
		const vcpResults = (vcpScan && vcpScan.results) || [];
		const boResults  = (boScan  && boScan.results)  || [];
		const allSetups  = [
			...vcpResults.slice(0, 5).map(r => ({ ...r, _src: "VCP", _color: "#7c3aed", _bg: "#ede9fe" })),
			...boResults.slice(0, 5).map(r => ({ ...r, _src: "Breakout", _color: "#065f46", _bg: "#d1fae5" })),
		];
		if (!allSetups.length) return "";
		const cards = allSetups.map(r => `
			<div class="tj-dp-setup-card">
				<div class="tj-dp-setup-sym">
					<a href="#" class="tj-chart-hover" data-symbol="${r.symbol}" data-exchange="NSE">${r.symbol}</a>
				</div>
				<div class="tj-dp-setup-price">₹${(r.current_price || 0).toFixed(2)}</div>
				<div class="tj-dp-setup-meta">
					RS: <b>${(r.rs_rating || 0).toFixed(0)}</b>
					&nbsp;· ${(r.pct_from_52w_high || 0).toFixed(1)}% from high
				</div>
				<span class="tj-dp-setup-badge" style="background:${r._bg};color:${r._color};">${r._src}</span>
			</div>
		`).join("");
		return `
			<div class="tj-dp-section" style="--tj-dp-accent: linear-gradient(180deg, #7c3aed, #065f46);">
				<div class="tj-dp-section-head">
					<div class="left">Today's Setups</div>
					<div style="display:flex;gap:8px;">
						<a href="/app/vcp-screener" style="font-size:11px;color:#64748b;text-decoration:none;font-weight:700;">VCP →</a>
						<a href="/app/breakout-screener" style="font-size:11px;color:#64748b;text-decoration:none;font-weight:700;">Breakouts →</a>
					</div>
				</div>
				<div class="tj-dp-section-body">
					<div class="tj-dp-setup-grid">${cards}</div>
				</div>
			</div>
		`;
	}

	_render_positions(positions) {
		if (!positions.length) return `
			<div class="tj-dp-section" style="--tj-dp-accent: linear-gradient(180deg, #f59e0b, #f97316);">
				<div class="tj-dp-section-head"><div class="left">Open Positions</div></div>
				<div class="tj-dp-section-body"><div class="tj-dp-empty">No open positions.</div></div>
			</div>
		`;

		const totalUnreal = positions.reduce((s, p) => s + (p.unrealized_pnl || 0), 0);
		const totalRisk   = positions.reduce((s, p) => s + (p.risk_amount || 0), 0);
		const pColor      = (v) => v >= 0 ? "#10b981" : "#ef4444";
		const rows = positions.map(p => {
			const slDist  = p.sl_distance_pct || 0;
			const tgtDist = p.target_distance_pct;
			const aboveEntry = p.above_entry;
			const isLong = (p.trade_type || "Long").toLowerCase() !== "short";

			// Color of SL distance bar: green if far from SL, red if close
			const slBarColor = slDist > 5 ? "#10b981" : slDist > 2 ? "#f59e0b" : "#ef4444";
			const slBarWidth = Math.min(100, (slDist / 15) * 100);

			return `
				<tr>
					<td><div class="tj-dp-pos-sym"><a href="/app/trade/${p.name}">${frappe.utils.escape_html(p.symbol)}</a></div>
						<div style="font-size:10px;color:#94a3b8;margin-top:1px;">${p.trade_type || "Long"} · ${p.setup_type || ""}</div>
					</td>
					<td class="tj-dp-pos-num">₹${(p.entry || 0).toFixed(2)}</td>
					<td class="tj-dp-pos-num" style="color:#ef4444;">₹${(p.sl || 0).toFixed(2)}</td>
					<td class="tj-dp-pos-num" style="font-weight:900;color:${p.current ? "#0f172a" : "#94a3b8"}">
						₹${(p.current || p.entry || 0).toFixed(2)}
						<div style="font-size:10px;color:${aboveEntry ? '#10b981' : '#ef4444'};font-weight:700;">
							${aboveEntry ? "▲ above entry" : "▼ below entry"}
						</div>
					</td>
					<td class="tj-dp-pos-num" style="color:${pColor(p.unrealized_pnl)}">
						${p.unrealized_pnl >= 0 ? "+" : ""}₹${Math.abs(p.unrealized_pnl || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
					</td>
					<td>
						<div style="font-size:11px;font-weight:700;color:${slBarColor};">${slDist.toFixed(2)}% cushion</div>
						<div class="tj-dp-sl-bar">
							<div class="tj-dp-sl-fill" style="width:${slBarWidth}%;background:${slBarColor};"></div>
						</div>
					</td>
					<td class="tj-dp-pos-num" style="color:#10b981;">${tgtDist !== null && tgtDist !== undefined ? tgtDist.toFixed(2) + "% to tgt" : "—"}</td>
				</tr>
			`;
		}).join("");

		return `
			<div class="tj-dp-section" style="--tj-dp-accent: linear-gradient(180deg, #f59e0b, #f97316);">
				<div class="tj-dp-section-head">
					<div class="left">Open Positions (${positions.length})</div>
					<div style="font-size:12px;font-weight:700;">
						Unrealized: <span style="color:${totalUnreal >= 0 ? '#10b981' : '#ef4444'}">${totalUnreal >= 0 ? "+" : ""}₹${Math.abs(totalUnreal).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
						&nbsp;·&nbsp; Total Risk: <span style="color:#ef4444">₹${totalRisk.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
					</div>
				</div>
				<div class="tj-dp-section-body" style="padding: 0;">
					<table class="tj-dp-pos-table">
						<thead><tr>
							<th>Symbol</th><th>Entry</th><th>Stop Loss</th><th>Current</th>
							<th>Unrealized P&L</th><th>SL Cushion</th><th>Target</th>
						</tr></thead>
						<tbody>${rows}</tbody>
					</table>
				</div>
			</div>
		`;
	}

	_render_watchlist(items) {
		const nearItems = items.filter(i => Math.abs(i.pct_to_alert || 999) <= 5);
		const otherItems = items.filter(i => Math.abs(i.pct_to_alert || 999) > 5).slice(0, 6);
		const allItems = [...nearItems, ...otherItems];
		if (!allItems.length) return `
			<div class="tj-dp-section" style="--tj-dp-accent: linear-gradient(180deg, #0ea5e9, #6366f1);">
				<div class="tj-dp-section-head"><div class="left">Watchlist Alerts</div></div>
				<div class="tj-dp-section-body"><div class="tj-dp-empty">Nothing on watchlist.</div></div>
			</div>
		`;
		const rows = allItems.map(i => {
			const pct = i.pct_to_alert;
			const near = Math.abs(pct || 999) <= 3;
			const pctStr = pct !== null && pct !== undefined ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% to alert` : "No alert set";
			const pctColor = pct !== null ? (Math.abs(pct) <= 3 ? "#f59e0b" : (pct < 0 ? "#10b981" : "#64748b")) : "#94a3b8";
			return `
				<div class="tj-dp-wl-row">
					<div>
						<div class="tj-dp-wl-sym">
							<a href="#" class="tj-chart-hover" data-symbol="${i.symbol}" data-exchange="NSE">${frappe.utils.escape_html(i.symbol)}</a>
							${near ? `<span class="tj-dp-near-chip">⚡ Near Alert</span>` : ""}
						</div>
						<div class="tj-dp-wl-alert">
							${i.alert_price ? `Alert: ₹${i.alert_price}` : "No alert"}
							${i.scan_source ? ` · from ${i.scan_source}` : ""}
						</div>
					</div>
					<div style="text-align:right;">
						<div class="tj-dp-wl-pct" style="color:${pctColor}">${pctStr}</div>
						<div style="font-size:12px;font-weight:700;color:#0f172a;margin-top:2px;">₹${(i.current_price || 0).toFixed(2)}</div>
					</div>
				</div>
			`;
		}).join("");

		return `
			<div class="tj-dp-section" style="--tj-dp-accent: linear-gradient(180deg, #0ea5e9, #6366f1);">
				<div class="tj-dp-section-head">
					<div class="left">Watchlist (${allItems.length})</div>
					<a href="/app/watchlist" style="font-size:11px;color:#64748b;text-decoration:none;font-weight:700;">Full list →</a>
				</div>
				<div class="tj-dp-section-body">${rows}</div>
			</div>
		`;
	}
}
