frappe.pages["trade-analytics"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({ parent: wrapper, title: "Trade Analytics", single_column: true });
	new TradeAnalyticsPage(wrapper);
};

class TradeAnalyticsPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.period  = "ALL";
		this._build_skeleton();
		this._load();
	}

	_build_skeleton() {
		const style = `
		<style>
		.tj-ana-wrap { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
		.tj-ana-hero {
			background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0c1426 100%);
			padding: 28px 32px 24px;
			margin: -16px -16px 24px;
			border-radius: 0 0 16px 16px;
			color: #fff;
		}
		.tj-ana-hero h1 { margin: 0 0 4px; font-size: 1.6rem; font-weight: 700; letter-spacing: -0.5px; color: #fff; }
		.tj-ana-hero p  { margin: 0 0 20px; color: #94a3b8; font-size: 0.9rem; }
		.tj-ana-periods { display:flex; gap:8px; flex-wrap:wrap; }
		.tj-ana-period {
			padding: 6px 16px; border-radius: 20px; border: 1px solid #334155;
			background: transparent; color: #94a3b8; cursor: pointer; font-size: 0.82rem;
			transition: all 0.15s;
		}
		.tj-ana-period.active,
		.tj-ana-period:hover { background: #3b82f6; border-color: #3b82f6; color: #fff; }

		.tj-ana-cards { display:grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap:12px; margin-bottom:20px; }
		.tj-ana-card {
			background: #1e293b; border-radius: 12px; padding: 16px;
			border: 1px solid #334155; position: relative; overflow: hidden;
		}
		.tj-ana-card-label { font-size: 0.72rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
		.tj-ana-card-val   { font-size: 1.5rem; font-weight: 700; color: #f1f5f9; line-height: 1; }
		.tj-ana-card-sub   { font-size: 0.72rem; color: #64748b; margin-top: 4px; }
		.tj-ana-card.green .tj-ana-card-val { color: #4ade80; }
		.tj-ana-card.red   .tj-ana-card-val { color: #f87171; }
		.tj-ana-card.blue  .tj-ana-card-val { color: #60a5fa; }
		.tj-ana-card.gold  .tj-ana-card-val { color: #fbbf24; }

		.tj-ana-section { background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155; }
		.tj-ana-section h3 { margin: 0 0 16px; font-size: 0.95rem; font-weight: 600; color: #e2e8f0; }

		/* Equity curve */
		.tj-equity-svg { width:100%; height:200px; display:block; }

		/* Monthly bars */
		.tj-monthly-svg { width:100%; height:160px; display:block; }

		/* Calendar heatmap */
		.tj-cal-wrap { display:flex; gap:3px; flex-wrap:nowrap; overflow-x:auto; padding-bottom:4px; }
		.tj-cal-week { display:flex; flex-direction:column; gap:3px; }
		.tj-cal-day  { width:12px; height:12px; border-radius:2px; background:#1e293b; cursor:default; }
		.tj-cal-day:hover { outline: 1px solid #60a5fa; }
		.tj-cal-months { display:flex; margin-bottom:4px; }

		/* Breakdown tables */
		.tj-breakdown { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; }
		@media(max-width:900px){ .tj-breakdown { grid-template-columns: 1fr 1fr; } }
		@media(max-width:600px){ .tj-breakdown { grid-template-columns: 1fr; } }
		.tj-bdown-table { width:100%; border-collapse:collapse; font-size:0.82rem; }
		.tj-bdown-table th { text-align:left; padding:6px 8px; color:#64748b; border-bottom:1px solid #334155; font-weight:500; font-size:0.72rem; text-transform:uppercase; }
		.tj-bdown-table td { padding:7px 8px; border-bottom:1px solid #1e3a5f22; color:#cbd5e1; }
		.tj-bdown-table tr:last-child td { border-bottom:none; }
		.tj-bdown-pnl.pos { color:#4ade80; }
		.tj-bdown-pnl.neg { color:#f87171; }

		/* Streak widget */
		.tj-streak { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
		.tj-streak-badge {
			padding: 8px 20px; border-radius: 24px; font-size: 1.1rem; font-weight: 700;
		}
		.tj-streak-badge.win  { background: #14532d; color: #4ade80; }
		.tj-streak-badge.loss { background: #450a0a; color: #f87171; }

		/* Recent trades table */
		.tj-recent-table { width:100%; border-collapse:collapse; font-size:0.82rem; }
		.tj-recent-table th { text-align:left; padding:8px 10px; color:#64748b; border-bottom:1px solid #334155; font-weight:500; font-size:0.72rem; text-transform:uppercase; position:sticky; top:0; background:#1e293b; }
		.tj-recent-table td { padding:8px 10px; border-bottom:1px solid #1e3a5f22; color:#cbd5e1; }
		.tj-recent-table tr:hover td { background:#263347; }
		.tj-recent-table tr:last-child td { border:none; }
		.tj-badge { display:inline-block; padding:2px 8px; border-radius:4px; font-size:0.72rem; font-weight:600; }
		.tj-badge.win  { background:#14532d; color:#4ade80; }
		.tj-badge.loss { background:#450a0a; color:#f87171; }
		.tj-badge.swing   { background:#1e3a5f; color:#60a5fa; }
		.tj-badge.intra   { background:#2d1b69; color:#a78bfa; }
		.tj-badge.positional { background:#1c2d35; color:#22d3ee; }
		.tj-recent-wrap { max-height:400px; overflow-y:auto; }

		.tj-empty { text-align:center; padding:60px 20px; color:#475569; }
		.tj-ana-tooltip {
			position:fixed; background:#0f172a; border:1px solid #334155; border-radius:8px;
			padding:8px 12px; font-size:0.78rem; color:#e2e8f0; pointer-events:none;
			z-index:9999; display:none; white-space:nowrap;
		}
		</style>`;

		$(this.wrapper).find(".page-content").html(style + `
		<div class="tj-ana-wrap">
		  <div class="tj-ana-hero">
		    <h1>Trade Analytics</h1>
		    <p>Performance stats across all closed trades</p>
		    <div class="tj-ana-periods" id="tj-ana-periods"></div>
		    <div class="tj-ana-custom-range" id="tj-ana-custom-range" style="display:none;margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
		      <input type="date" id="tj-ana-from" style="background:transparent;border:1px solid #334155;color:#fff;border-radius:6px;padding:5px 10px;font-size:0.8rem;">
		      <span style="color:#94a3b8;font-size:0.8rem;">to</span>
		      <input type="date" id="tj-ana-to" style="background:transparent;border:1px solid #334155;color:#fff;border-radius:6px;padding:5px 10px;font-size:0.8rem;">
		      <button id="tj-ana-apply" class="tj-ana-period" style="background:#3b82f6;border-color:#3b82f6;color:#fff;">Apply</button>
		    </div>
		  </div>
		  <div id="tj-ana-body"><div class="tj-empty">Loading…</div></div>
		</div>
		<div class="tj-ana-tooltip" id="tj-ana-tip"></div>`);

		["ALL", "1Y", "6M", "3M", "1M", "Custom"].forEach(p => {
			const btn = $(`<button class="tj-ana-period${p === "ALL" ? " active" : ""}">${p}</button>`);
			btn.on("click", () => {
				$(".tj-ana-period").removeClass("active");
				btn.addClass("active");
				if (p === "Custom") {
					$("#tj-ana-custom-range").css("display", "flex");
					return;
				}
				$("#tj-ana-custom-range").hide();
				this.period = p;
				this.from_date = null;
				this.to_date = null;
				this._load();
			});
			$("#tj-ana-periods").append(btn);
		});

		$("#tj-ana-apply").on("click", () => {
			const from = $("#tj-ana-from").val();
			const to   = $("#tj-ana-to").val();
			if (!from || !to) {
				frappe.show_alert({ message: "Pick both start and end dates", indicator: "orange" }, 3);
				return;
			}
			this.period = "CUSTOM";
			this.from_date = from;
			this.to_date = to;
			this._load();
		});
	}

	_load() {
		$("#tj-ana-body").html(`<div class="tj-empty">Loading…</div>`);
		frappe.call({
			method: "trading_journal.trading_journal.utils.trade_analytics.get_trade_analytics",
			args: { period: this.period, from_date: this.from_date, to_date: this.to_date },
			callback: r => {
				const d = r.message;
				if (!d || !d.total) {
					$("#tj-ana-body").html(`<div class="tj-empty">No closed trades found for this period.</div>`);
					return;
				}
				this._render(d);
			},
		});
	}

	_render(d) {
		const pnl_color = n => n >= 0 ? "green" : "red";
		const fmt = n => "₹" + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
		const fmtN = n => (n >= 0 ? "+" : "") + "₹" + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });

		// ── Key stats cards ──
		const streak  = d.current_streak || {};
		const cards1  = [
			{ label: "Total Net P&L", val: fmtN(d.total_pnl), cls: pnl_color(d.total_pnl), sub: `${d.total} closed trades` },
			{ label: "Win Rate",      val: d.win_rate + "%",   cls: d.win_rate >= 55 ? "green" : d.win_rate >= 45 ? "gold" : "red", sub: `${d.win_count}W / ${d.loss_count}L` },
			{ label: "Profit Factor", val: d.profit_factor != null ? d.profit_factor : "∞", cls: (d.profit_factor||0) >= 1.5 ? "green" : (d.profit_factor||0) >= 1 ? "gold" : "red", sub: "gross wins / gross losses" },
			{ label: "Expectancy",    val: fmtN(d.expectancy || 0), cls: pnl_color(d.expectancy || 0), sub: "per trade avg P&L" },
			{ label: "Avg R:R",       val: d.avg_rr != null ? d.avg_rr + "x" : "—", cls: (d.avg_rr||0) >= 1.5 ? "green" : "gold", sub: "avg win / avg loss" },
			{ label: "Avg Hold",      val: d.avg_hold_days + "d", cls: "blue", sub: "trading days" },
		];
		const cards2 = [
			{ label: "Avg Win",    val: fmt(d.avg_win),   cls: "green", sub: "per winning trade" },
			{ label: "Avg Loss",   val: fmt(d.avg_loss),  cls: "red",   sub: "per losing trade" },
			{ label: "Best Trade", val: fmt(d.best_trade?.pnl || 0),  cls: "green", sub: d.best_trade?.symbol || "" },
			{ label: "Worst Trade",val: fmt(d.worst_trade?.pnl || 0), cls: "red",   sub: d.worst_trade?.symbol || "" },
			{ label: "Max Drawdown",val: fmt(d.max_drawdown || 0),    cls: "red",   sub: d.max_drawdown_pct + "% of peak" },
			{ label: "Best Streak", val: d.max_win_streak + " wins",  cls: "gold",  sub: "consecutive" },
		];

		const card_html = (cards) => cards.map(c =>
			`<div class="tj-ana-card ${c.cls}">
			  <div class="tj-ana-card-label">${c.label}</div>
			  <div class="tj-ana-card-val">${c.val}</div>
			  <div class="tj-ana-card-sub">${c.sub}</div>
			</div>`
		).join("");

		// ── Breakdown tables ──
		const breakdown_table = (rows, key, keyLabel) => {
			if (!rows || !rows.length) return `<em style="color:#475569">No data</em>`;
			return `<table class="tj-bdown-table">
			  <thead><tr>
			    <th>${keyLabel}</th><th>Trades</th><th>Win%</th><th>Net P&L</th>
			  </tr></thead>
			  <tbody>${rows.map(r => `
			  <tr>
			    <td>${r[key]}</td>
			    <td>${r.trades}</td>
			    <td>${r.win_rate}%</td>
			    <td class="tj-bdown-pnl ${r.pnl >= 0 ? "pos" : "neg"}">${fmtN(r.pnl)}</td>
			  </tr>`).join("")}
			  </tbody></table>`;
		};

		// ── Streak badge ──
		const s_type = streak.type === "Win" ? "win" : "loss";
		const streak_html = `<div class="tj-streak">
		  <span class="tj-streak-badge ${s_type}">${streak.count} ${streak.type}s in a row</span>
		  <span style="color:#64748b;font-size:0.8rem">Max win streak: <b style="color:#4ade80">${d.max_win_streak}</b> &nbsp;|&nbsp; Max loss streak: <b style="color:#f87171">${d.max_loss_streak}</b></span>
		</div>`;

		// ── Recent trades table ──
		const nature_cls = n => ({ Intraday:"intra", Swing:"swing", Positional:"positional" })[n] || "swing";
		const recent_rows = (d.recent || []).slice(0, 50).map(t => `
		  <tr>
		    <td>${t.symbol}</td>
		    <td>${t.trade_date}</td>
		    <td><span class="tj-badge ${t.status.toLowerCase()}">${t.status}</span></td>
		    <td><span class="tj-badge ${nature_cls(t.nature)}">${t.nature}</span></td>
		    <td>${t.setup_type}</td>
		    <td style="color:${t.net_pnl >= 0 ? "#4ade80":"#f87171"};font-weight:600">${fmtN(t.net_pnl)}</td>
		    <td style="color:#64748b">${t.hold_days}d</td>
		  </tr>`).join("");

		const body = `
		<div class="tj-ana-cards">${card_html(cards1)}</div>
		<div class="tj-ana-cards">${card_html(cards2)}</div>

		<div class="tj-ana-section">
		  <h3>Equity Curve</h3>
		  <svg class="tj-equity-svg" id="tj-equity-svg"></svg>
		</div>

		<div class="tj-ana-section">
		  <h3>Monthly P&L</h3>
		  <svg class="tj-monthly-svg" id="tj-monthly-svg"></svg>
		</div>

		<div class="tj-ana-section">
		  <h3>P&L Calendar</h3>
		  <div id="tj-cal-container"></div>
		</div>

		<div class="tj-ana-section">
		  <h3>Current Streak</h3>
		  ${streak_html}
		</div>

		<div class="tj-ana-section">
		  <h3>Performance Breakdown</h3>
		  <div class="tj-breakdown">
		    <div>
		      <div style="font-size:0.78rem;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">By Trade Nature</div>
		      ${breakdown_table(d.by_nature, "nature", "Nature")}
		    </div>
		    <div>
		      <div style="font-size:0.78rem;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">By Setup Type</div>
		      ${breakdown_table(d.by_setup, "setup_type", "Setup")}
		    </div>
		    <div>
		      <div style="font-size:0.78rem;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">By Broker</div>
		      ${breakdown_table(d.by_broker, "broker", "Broker")}
		    </div>
		  </div>
		</div>

		<div class="tj-ana-section">
		  <h3>Recent Trades</h3>
		  <div class="tj-recent-wrap">
		    <table class="tj-recent-table">
		      <thead><tr>
		        <th>Symbol</th><th>Date</th><th>Result</th><th>Nature</th><th>Setup</th><th>Net P&L</th><th>Hold</th>
		      </tr></thead>
		      <tbody>${recent_rows}</tbody>
		    </table>
		  </div>
		</div>`;

		$("#tj-ana-body").html(body);

		// Render charts after DOM is ready
		setTimeout(() => {
			this._render_equity(d.equity_curve || []);
			this._render_monthly(d.monthly || []);
			this._render_calendar(d.daily_pnl || {});
		}, 50);
	}

	_render_equity(points) {
		const svg = document.getElementById("tj-equity-svg");
		if (!svg || !points.length) return;
		const W = svg.clientWidth || 600;
		const H = 200;
		const PAD = { top: 20, right: 20, bottom: 30, left: 60 };
		const iW = W - PAD.left - PAD.right;
		const iH = H - PAD.top - PAD.bottom;

		const vals = points.map(p => p.cumulative);
		const minV = Math.min(...vals);
		const maxV = Math.max(...vals);
		const range = maxV - minV || 1;

		const xScale = i => PAD.left + (i / (points.length - 1)) * iW;
		const yScale = v => PAD.top + iH - ((v - minV) / range) * iH;

		const pathD  = points.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(i).toFixed(1)},${yScale(p.cumulative).toFixed(1)}`).join(" ");
		const fillD  = pathD + ` L${xScale(points.length - 1)},${(PAD.top + iH).toFixed(1)} L${PAD.left},${(PAD.top + iH).toFixed(1)} Z`;
		const last   = vals[vals.length - 1];
		const lineColor = last >= 0 ? "#4ade80" : "#f87171";
		const fillColor = last >= 0 ? "#4ade8022" : "#f8717122";

		// Zero line
		const zeroY = yScale(Math.max(0, minV));

		const ns = "http://www.w3.org/2000/svg";
		svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

		const el = (tag, attrs) => {
			const e = document.createElementNS(ns, tag);
			Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
			return e;
		};

		svg.innerHTML = "";

		// Grid lines
		[0, 0.25, 0.5, 0.75, 1].forEach(f => {
			const y = PAD.top + f * iH;
			svg.appendChild(el("line", { x1: PAD.left, y1: y, x2: PAD.left + iW, y2: y, stroke: "#1e3a5f", "stroke-width": 1 }));
			const val = maxV - f * range;
			const t = document.createElementNS(ns, "text");
			t.setAttribute("x", PAD.left - 6); t.setAttribute("y", y + 4);
			t.setAttribute("text-anchor", "end"); t.setAttribute("fill", "#475569"); t.setAttribute("font-size", "10");
			t.textContent = "₹" + Math.round(val / 1000) + "k";
			svg.appendChild(t);
		});

		// Zero line highlight
		if (minV < 0 && maxV > 0) {
			svg.appendChild(el("line", { x1: PAD.left, y1: zeroY, x2: PAD.left + iW, y2: zeroY, stroke: "#475569", "stroke-width": 1, "stroke-dasharray": "4,4" }));
		}

		// Fill + line
		svg.appendChild(el("path", { d: fillD, fill: fillColor }));
		svg.appendChild(el("path", { d: pathD, fill: "none", stroke: lineColor, "stroke-width": 2, "stroke-linejoin": "round" }));

		// Dots at each point (hover targets)
		const tip = document.getElementById("tj-ana-tip");
		points.forEach((p, i) => {
			const cx = xScale(i); const cy = yScale(p.cumulative);
			const dot = el("circle", { cx, cy, r: 3, fill: lineColor, opacity: 0, style: "cursor:default" });
			dot.addEventListener("mouseenter", e => {
				dot.setAttribute("opacity", 1);
				tip.style.display = "block";
				tip.textContent = `${p.date}  ₹${p.cumulative.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
			});
			dot.addEventListener("mousemove", e => {
				tip.style.left = (e.clientX + 12) + "px";
				tip.style.top  = (e.clientY - 28) + "px";
			});
			dot.addEventListener("mouseleave", () => { dot.setAttribute("opacity", 0); tip.style.display = "none"; });
			svg.appendChild(dot);
		});

		// Date labels (first + last)
		[[0, "start"], [points.length - 1, "end"]].forEach(([i, anchor]) => {
			const t = document.createElementNS(ns, "text");
			t.setAttribute("x", xScale(i)); t.setAttribute("y", H - 8);
			t.setAttribute("text-anchor", anchor === "start" ? "start" : "end");
			t.setAttribute("fill", "#475569"); t.setAttribute("font-size", "10");
			t.textContent = points[i].date.slice(5);  // "MM-DD"
			svg.appendChild(t);
		});
	}

	_render_monthly(monthly) {
		const svg = document.getElementById("tj-monthly-svg");
		if (!svg || !monthly.length) return;
		const W = svg.clientWidth || 600;
		const H = 160;
		const PAD = { top: 20, right: 10, bottom: 30, left: 55 };
		const iW = W - PAD.left - PAD.right;
		const iH = H - PAD.top - PAD.bottom;

		const pnls = monthly.map(m => m.pnl);
		const maxAbs = Math.max(...pnls.map(Math.abs), 1);
		const barW = Math.max(6, iW / monthly.length - 4);
		const ns = "http://www.w3.org/2000/svg";
		const tip = document.getElementById("tj-ana-tip");
		svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
		svg.innerHTML = "";

		// Zero line (center)
		const zeroY = PAD.top + iH / 2;
		svg.appendChild((() => { const e = document.createElementNS(ns, "line"); e.setAttribute("x1", PAD.left); e.setAttribute("y1", zeroY); e.setAttribute("x2", PAD.left + iW); e.setAttribute("y2", zeroY); e.setAttribute("stroke", "#334155"); e.setAttribute("stroke-width", 1); return e; })());

		// Axis values
		[maxAbs, 0, -maxAbs].forEach((v, i) => {
			const y = i === 0 ? PAD.top : i === 1 ? zeroY : PAD.top + iH;
			const t = document.createElementNS(ns, "text");
			t.setAttribute("x", PAD.left - 4); t.setAttribute("y", y + 4);
			t.setAttribute("text-anchor", "end"); t.setAttribute("fill", "#475569"); t.setAttribute("font-size", "10");
			t.textContent = "₹" + Math.round(v / 1000) + "k";
			svg.appendChild(t);
		});

		monthly.forEach((m, i) => {
			const x  = PAD.left + i * (iW / monthly.length) + (iW / monthly.length - barW) / 2;
			const h  = Math.abs(m.pnl) / maxAbs * (iH / 2);
			const y  = m.pnl >= 0 ? zeroY - h : zeroY;
			const clr = m.pnl >= 0 ? "#4ade80" : "#f87171";

			const rect = document.createElementNS(ns, "rect");
			rect.setAttribute("x", x); rect.setAttribute("y", y);
			rect.setAttribute("width", barW); rect.setAttribute("height", h);
			rect.setAttribute("fill", clr); rect.setAttribute("rx", 2);
			rect.style.cursor = "default";
			rect.addEventListener("mouseenter", e => {
				rect.setAttribute("opacity", 0.7);
				tip.style.display = "block";
				tip.textContent = `${m.month}  ₹${m.pnl.toLocaleString("en-IN")}  (${m.win_rate}% WR, ${m.trades} trades)`;
			});
			rect.addEventListener("mousemove", e => {
				tip.style.left = (e.clientX + 12) + "px"; tip.style.top = (e.clientY - 28) + "px";
			});
			rect.addEventListener("mouseleave", () => { rect.setAttribute("opacity", 1); tip.style.display = "none"; });
			svg.appendChild(rect);

			// Month label
			const t = document.createElementNS(ns, "text");
			t.setAttribute("x", x + barW / 2); t.setAttribute("y", H - 6);
			t.setAttribute("text-anchor", "middle"); t.setAttribute("fill", "#475569"); t.setAttribute("font-size", "9");
			t.textContent = m.month.slice(5);  // "MM"
			svg.appendChild(t);
		});
	}

	_render_calendar(daily_pnl) {
		const container = document.getElementById("tj-cal-container");
		if (!container) return;

		const dates = Object.keys(daily_pnl).sort();
		if (!dates.length) { container.innerHTML = `<em style="color:#475569">No trade data</em>`; return; }

		const start = new Date(dates[0]);
		const end   = new Date(dates[dates.length - 1]);

		// Start from Monday of the first week
		const startMon = new Date(start);
		startMon.setDate(startMon.getDate() - ((startMon.getDay() + 6) % 7));

		const pnlMap = {};
		Object.entries(daily_pnl).forEach(([d, v]) => { pnlMap[d] = v; });

		const maxAbs = Math.max(...Object.values(daily_pnl).map(Math.abs), 1);
		const tipEl  = document.getElementById("tj-ana-tip");

		const color = (v) => {
			if (v === undefined) return "#1e293b";
			if (v === 0) return "#334155";
			const intensity = Math.min(1, Math.abs(v) / maxAbs);
			if (v > 0) return `rgba(74, 222, 128, ${0.2 + 0.8 * intensity})`;
			return `rgba(248, 113, 113, ${0.2 + 0.8 * intensity})`;
		};

		// Build week columns
		let html = `<div style="font-size:0.72rem;color:#475569;margin-bottom:4px;display:flex;gap:3px;">
		  ${["M","T","W","T","F","S","S"].map(d => `<span style="width:12px;text-align:center">${d}</span>`).join("")}
		</div><div class="tj-cal-wrap">`;

		let cur = new Date(startMon);
		let weekHtml = "";
		let weekCount = 0;

		while (cur <= end || weekCount === 0) {
			if (weekCount % 7 === 0 && weekCount > 0) {
				html += `<div class="tj-cal-week">${weekHtml}</div>`;
				weekHtml = "";
			}
			const iso = cur.toISOString().slice(0, 10);
			const v   = pnlMap[iso];
			const bg  = color(v);
			const title = v !== undefined ? `${iso}: ₹${v.toLocaleString("en-IN")}` : iso;
			weekHtml += `<div class="tj-cal-day" style="background:${bg}" title="${title}"></div>`;
			cur.setDate(cur.getDate() + 1);
			weekCount++;
			if (weekCount > 400) break;  // safety
		}
		if (weekHtml) html += `<div class="tj-cal-week">${weekHtml}</div>`;
		html += "</div>";

		// Legend
		html += `<div style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:0.72rem;color:#475569;">
		  <span>Less</span>
		  ${[0.2, 0.4, 0.6, 0.8, 1].map(i => `<div style="width:12px;height:12px;border-radius:2px;background:rgba(74,222,128,${i})"></div>`).join("")}
		  <span>More (green=profit, red=loss)</span>
		</div>`;

		container.innerHTML = html;
	}
}
