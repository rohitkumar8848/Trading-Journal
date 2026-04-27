frappe.pages["trade-kanban"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Trade Kanban",
		single_column: true,
	});
	new TradeKanban(page);
};

class TradeKanban {
	constructor(page) {
		this.page = page;
		this.from_date = frappe.datetime.add_months(frappe.datetime.get_today(), -1);
		this.to_date = frappe.datetime.get_today();
		this.symbol = "";
		this.page.add_button(__("Sync NSE/BSE"), () => this._sync_scrips(), { icon: "refresh" });
		this.page.add_button(__("New Trade"), () => frappe.new_doc("Trade"), { btn_class: "btn-primary" });
		this._inject_styles();
		this._render_shell();
		this._render_filters();
		this.refresh();
	}

	_render_filters() {
		const $bar = this.page.main.find(".tk-filter-bar");

		const makeDatePicker = (key, label) => {
			const $wrap = $(`
				<div class="tk-filter">
					<label>${label}</label>
					<input type="date" class="form-control input-sm tk-date" data-key="${key}" value="${this[key]}" />
				</div>
			`);
			$wrap.find("input").on("change", (e) => {
				this[key] = e.target.value;
				this.refresh();
			});
			$bar.append($wrap);
		};

		makeDatePicker("from_date", "From");
		makeDatePicker("to_date", "To");

		// Symbol filter — mount a Frappe Link control for autocomplete
		const $symWrap = $(`
			<div class="tk-filter">
				<label>Symbol</label>
				<div class="tk-sym-slot"></div>
			</div>
		`);
		$bar.append($symWrap);
		this.symbol_field = frappe.ui.form.make_control({
			parent: $symWrap.find(".tk-sym-slot")[0],
			df: {
				fieldtype: "Link", fieldname: "symbol", options: "Stock Symbol",
				placeholder: __("All Symbols"),
				onchange: () => { this.symbol = this.symbol_field.get_value(); this.refresh(); },
			},
			render_input: true,
		});

		const presets = [
			{ label: "Today", from: () => frappe.datetime.get_today() },
			{ label: "7D", from: () => frappe.datetime.add_days(frappe.datetime.get_today(), -6) },
			{ label: "1M", from: () => frappe.datetime.add_months(frappe.datetime.get_today(), -1) },
			{ label: "3M", from: () => frappe.datetime.add_months(frappe.datetime.get_today(), -3) },
			{ label: "6M", from: () => frappe.datetime.add_months(frappe.datetime.get_today(), -6) },
			{ label: "YTD", from: () => frappe.datetime.get_today().substring(0, 4) + "-01-01" },
			{ label: "1Y", from: () => frappe.datetime.add_months(frappe.datetime.get_today(), -12) },
		];
		const $presets = $('<div class="tk-presets"></div>');
		presets.forEach(p => {
			const $btn = $(`<button class="btn btn-xs btn-default tk-preset-btn">${p.label}</button>`);
			$btn.on("click", () => {
				this.from_date = p.from();
				this.to_date = frappe.datetime.get_today();
				$bar.find('[data-key="from_date"]').val(this.from_date);
				$bar.find('[data-key="to_date"]').val(this.to_date);
				this.refresh();
			});
			$presets.append($btn);
		});
		$bar.append($presets);
	}

	_sync_scrips() {
		frappe.confirm(
			__("This will sync all NSE & BSE symbols in the background. Continue?"),
			() => {
				frappe.call({
					method: "trading_journal.trading_journal.utils.scrip_sync.sync_scrips_from_ui",
					args: { exchange: "all" },
					callback: (r) => {
						if (r.message) frappe.show_alert({ message: r.message.message, indicator: "blue" });
					},
				});
				frappe.realtime.on("scrip_sync_done", (data) => {
					const r = data.results || {};
					frappe.show_alert({
						message: `Sync done! NSE: ${r.nse || 0}, BSE: ${r.bse || 0} symbols`,
						indicator: "green",
					}, 6);
				});
			}
		);
	}

	_render_shell() {
		this.page.main.html(`
			<div class="tk-root" style="padding:16px 20px">
				<!-- Filter bar -->
				<div class="tk-filter-bar"></div>

				<!-- Summary strip -->
				<div class="tk-summary-strip"></div>

				<!-- Equity curve -->
				<div class="tk-card" style="margin:14px 0">
					<div class="tk-card-title">Cumulative P&L Curve</div>
					<div class="tk-equity" style="height:180px"></div>
				</div>

				<!-- Column headers -->
				<div class="tk-col-headers" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:6px">
					<div class="tk-col-hdr profit-hdr">
						<span class="tk-col-dot"></span> Profit Days
						<span class="tk-col-count profit-count badge"></span>
					</div>
					<div class="tk-col-hdr loss-hdr">
						<span class="tk-col-dot"></span> Loss Days
						<span class="tk-col-count loss-count badge"></span>
					</div>
					<div class="tk-col-hdr be-hdr">
						<span class="tk-col-dot"></span> Breakeven Days
						<span class="tk-col-count be-count badge"></span>
					</div>
				</div>

				<!-- Kanban columns -->
				<div class="tk-board" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;align-items:start">
					<div class="tk-col" data-col="profit"></div>
					<div class="tk-col" data-col="loss"></div>
					<div class="tk-col" data-col="breakeven"></div>
				</div>
			</div>
		`);
	}

	refresh() {
		frappe.call({
			method: "trading_journal.trading_journal.page.trade_kanban.trade_kanban.get_kanban_data",
			args: { from_date: this.from_date, to_date: this.to_date, symbol: this.symbol },
			freeze: false,
			callback: (r) => {
				if (!r.exc && r.message) this._render(r.message);
			},
		});
	}

	_render(data) {
		this._render_summary(data.summary);
		this._render_equity(data.summary.cumulative);
		this._render_board(data.days, data.summary);
	}

	_render_summary(s) {
		const items = [
			{ label: "Net P&L", value: _fmt_pnl(s.total_pnl), cls: s.total_pnl >= 0 ? "pos" : "neg" },
			{ label: "Profit Days", value: s.profit_days, cls: "pos" },
			{ label: "Loss Days", value: s.loss_days, cls: "neg" },
			{ label: "Total Trades", value: s.total_trades, cls: "" },
			{ label: "Best Day", value: _fmt_pnl(s.best_day), cls: "pos" },
			{ label: "Worst Day", value: _fmt_pnl(s.worst_day), cls: "neg" },
		];
		this.page.main.find(".tk-summary-strip").html(`
			<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px">
				${items.map(i => `
					<div class="tk-stat">
						<div class="tk-stat-label">${i.label}</div>
						<div class="tk-stat-value ${i.cls}">${i.value}</div>
					</div>
				`).join("")}
			</div>
		`);
	}

	_render_equity(curve) {
		const el = this.page.main.find(".tk-equity")[0];
		if (!el || !curve || !curve.length) return;
		new frappe.Chart(el, {
			type: "line",
			data: {
				labels: curve.map(p => _short_date(p.date)),
				datasets: [{ name: "Equity", values: curve.map(p => p.value), chartType: "line" }],
			},
			colors: [curve[curve.length - 1]?.value >= 0 ? "#10b981" : "#f43f5e"],
			height: 160,
			lineOptions: { regionFill: 1, hideDots: curve.length > 20 ? 1 : 0 },
			tooltipOptions: { formatTooltipY: d => _fmt_pnl(d) },
		});
	}

	_render_board(days, summary) {
		const groups = { profit: [], loss: [], breakeven: [] };
		days.forEach(d => groups[d.column].push(d));

		this.page.main.find(".profit-count").text(groups.profit.length);
		this.page.main.find(".loss-count").text(groups.loss.length);
		this.page.main.find(".be-count").text(groups.breakeven.length);

		["profit", "loss", "breakeven"].forEach(col => {
			const cards = groups[col].map(d => this._make_card(d)).join("");
			this.page.main.find(`.tk-col[data-col="${col}"]`).html(
				cards || `<div class="tk-empty">No ${col} days</div>`
			);
		});
	}

	_make_card(day) {
		const pnlColor = day.total_pnl > 0 ? "#10b981" : day.total_pnl < 0 ? "#f43f5e" : "#64748b";

		// Mini sparkline bars
		const sparkline = _sparkline(day.trade_pnls);

		// Trade rows
		const tradeRows = day.trades.map(t => `
			<div class="tk-trade-row">
				<a href="/app/trade/${t.name}" class="tk-trade-sym">${t.symbol}</a>
				<span class="tk-badge-${(t.status || "open").toLowerCase()}">${t.status}</span>
				<span class="tk-trade-type ${t.type === "Long" ? "long" : "short"}">${t.type}</span>
				<span class="tk-trade-pnl" style="color:${t.pnl >= 0 ? "#10b981" : "#f43f5e"}">${_fmt_pnl(t.pnl)}</span>
				<span class="tk-trade-pct" style="color:${t.pnl >= 0 ? "#10b981" : "#f43f5e"}">${t.pnl_pct.toFixed(2)}%</span>
			</div>
		`).join("");

		return `
			<div class="tk-day-card">
				<!-- Card header -->
				<div class="tk-day-header">
					<div class="tk-day-date">${_format_date(day.date)}</div>
					<div class="tk-day-pnl" style="color:${pnlColor}">${_fmt_pnl(day.total_pnl)}</div>
				</div>

				<!-- P&L % and win rate -->
				<div class="tk-day-meta">
					<span class="tk-pnl-pct" style="color:${pnlColor}">
						${day.pnl_percent >= 0 ? "▲" : "▼"} ${Math.abs(day.pnl_percent).toFixed(2)}%
					</span>
					<span class="tk-win-rate">Win Rate: <b>${day.win_rate}%</b></span>
				</div>

				<!-- Badges row -->
				<div class="tk-badges">
					${day.wins ? `<span class="tk-chip green">${day.wins}W</span>` : ""}
					${day.losses ? `<span class="tk-chip red">${day.losses}L</span>` : ""}
					${day.breakeven ? `<span class="tk-chip yellow">${day.breakeven}BE</span>` : ""}
					${day.open ? `<span class="tk-chip blue">${day.open} Open</span>` : ""}
					<span class="tk-chip gray">${day.total_trades} total</span>
				</div>

				<!-- Sparkline mini chart -->
				<div class="tk-sparkline-wrap">
					<div class="tk-sparkline-label">P&L per trade</div>
					${sparkline}
				</div>

				<!-- Collapsible trades -->
				<details class="tk-details">
					<summary class="tk-summary-toggle">Trades</summary>
					<div class="tk-trades-section">
						<div class="tk-trade-header">
							<span>Symbol</span><span>Status</span><span>Type</span><span>P&L</span><span>P&L%</span>
						</div>
						${tradeRows}
					</div>
				</details>
			</div>
		`;
	}

	_inject_styles() {
		if ($("#tk-styles").length) return;
		$("head").append(`<style id="tk-styles">
		/* ─── Design tokens ─── */
		:root {
			--tk-bg: #f6f7fb;
			--tk-card: #ffffff;
			--tk-border: #e6e8f0;
			--tk-text: #0f172a;
			--tk-muted: #64748b;
			--tk-primary: #6366f1;
			--tk-primary-2: #8b5cf6;
			--tk-win: #10b981;
			--tk-win-soft: #d1fae5;
			--tk-loss: #f43f5e;
			--tk-loss-soft: #ffe4e6;
			--tk-warn: #f59e0b;
			--tk-warn-soft: #fef3c7;
			--tk-info: #0ea5e9;
			--tk-info-soft: #e0f2fe;
			--tk-shadow-sm: 0 1px 2px rgba(15,23,42,.04), 0 1px 3px rgba(15,23,42,.06);
			--tk-shadow-md: 0 4px 16px rgba(15,23,42,.06), 0 2px 6px rgba(15,23,42,.04);
			--tk-shadow-lg: 0 12px 36px rgba(99,102,241,.18);
		}

		/* Full-width page */
		body [data-page-route="trade-kanban"] .container,
		body [data-page-route="trade-kanban"] .page-body,
		body [data-page-route="trade-kanban"] .page-wrapper,
		body [data-page-route="trade-kanban"] .page-head .container,
		body [data-page-route="trade-kanban"] .row.layout-main,
		body [data-page-route="trade-kanban"] .layout-main-section-wrapper,
		body [data-page-route="trade-kanban"] .layout-main-section { max-width:100% !important; width:100% !important; flex:1 1 100% !important; padding-left:12px !important; padding-right:12px !important; margin-left:0 !important; margin-right:0 !important; }
		body [data-page-route="trade-kanban"] .page-body { background:var(--tk-bg); }
		.tk-root { font-family: var(--font-stack); max-width:100% !important; width:100% !important; box-sizing:border-box; color:var(--tk-text); font-feature-settings: "tnum" 1; }

		/* ─── Filter bar (gradient hero) ─── */
		.tk-filter-bar {
			display:flex; flex-wrap:wrap; gap:14px; align-items:flex-end;
			padding:16px 20px; margin-bottom:20px; border-radius:14px;
			background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%);
			box-shadow: var(--tk-shadow-lg);
			position:relative; overflow:hidden;
		}
		.tk-filter-bar::before {
			content:""; position:absolute; inset:0;
			background: radial-gradient(800px 200px at 90% -20%, rgba(255,255,255,.25), transparent 60%);
			pointer-events:none;
		}
		.tk-filter-bar .tk-filter { display:flex; flex-direction:column; gap:4px; min-width:150px; position:relative; }
		.tk-filter-bar .tk-filter label { font-size:10px; color:rgba(255,255,255,.85); text-transform:uppercase; letter-spacing:.6px; font-weight:700; margin:0; }
		.tk-filter-bar .tk-date {
			height:34px; font-size:12px; padding:6px 10px; width:160px;
			border:1px solid rgba(255,255,255,.3) !important;
			background:rgba(255,255,255,.95) !important; color:var(--tk-text) !important;
			border-radius:8px; font-weight:600;
		}
		.tk-filter-bar .tk-date:focus { outline:none; box-shadow:0 0 0 3px rgba(255,255,255,.35); }
		.tk-filter-bar .tk-sym-slot .form-group { margin:0; }
		.tk-filter-bar .tk-sym-slot .control-label { display:none; }
		.tk-filter-bar .tk-sym-slot input {
			height:34px; font-size:12px; width:190px;
			border:1px solid rgba(255,255,255,.3) !important;
			background:rgba(255,255,255,.95) !important; color:var(--tk-text) !important;
			border-radius:8px !important; font-weight:600;
		}
		.tk-filter-bar .tk-presets { display:flex; gap:6px; flex-wrap:wrap; margin-left:auto; position:relative; }
		.tk-filter-bar .tk-preset-btn {
			font-size:11px; padding:6px 14px; min-width:44px; font-weight:700; letter-spacing:.3px;
			background:rgba(255,255,255,.18); color:#fff;
			border:1px solid rgba(255,255,255,.25); border-radius:999px;
			backdrop-filter: blur(6px);
			transition: background .18s, transform .1s, box-shadow .18s;
		}
		.tk-filter-bar .tk-preset-btn:hover { background:rgba(255,255,255,.95); color:var(--tk-primary); transform:translateY(-1px); box-shadow:0 4px 12px rgba(0,0,0,.15); }
		.tk-filter-bar .tk-preset-btn:active { transform:translateY(0); }

		/* Stats strip cards */
		.tk-stat {
			position:relative; background:var(--tk-card); border:1px solid var(--tk-border);
			border-radius:14px; padding:16px 20px;
			box-shadow: var(--tk-shadow-sm); overflow:hidden;
			transition: transform .18s, box-shadow .2s;
		}
		.tk-stat::before {
			content:""; position:absolute; top:0; left:0; right:0; height:3px;
			background: linear-gradient(90deg, var(--tk-primary), var(--tk-primary-2));
		}
		.tk-stat:hover { transform:translateY(-2px); box-shadow: var(--tk-shadow-md); }
		.tk-stat-label { font-size:10px; text-transform:uppercase; letter-spacing:.6px; color:var(--tk-muted); font-weight:700; }
		.tk-stat-value { font-size:24px; font-weight:800; margin-top:4px; letter-spacing:-.4px; }
		.tk-stat-value.pos { color:var(--tk-win); }
		.tk-stat-value.neg { color:var(--tk-loss); }

		/* Equity card */
		.tk-card { background:var(--tk-card); border:1px solid var(--tk-border); border-radius:14px; padding:20px; box-shadow: var(--tk-shadow-sm); transition: box-shadow .2s; }
		.tk-card:hover { box-shadow: var(--tk-shadow-md); }
		.tk-card-title {
			font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.7px;
			color:var(--tk-muted); margin-bottom:12px;
			display:flex; align-items:center; gap:8px;
		}
		.tk-card-title::before {
			content:""; width:4px; height:14px; border-radius:2px;
			background: linear-gradient(180deg, var(--tk-primary), var(--tk-primary-2));
		}

		/* Column headers */
		.tk-col-hdr {
			font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.7px;
			padding:10px 14px; border-radius:10px;
			display:flex; align-items:center; gap:10px;
			box-shadow: var(--tk-shadow-sm);
		}
		.profit-hdr { background:linear-gradient(135deg, #d1fae5, #a7f3d0); color:#065f46; }
		.loss-hdr   { background:linear-gradient(135deg, #ffe4e6, #fecdd3); color:#9f1239; }
		.be-hdr     { background:linear-gradient(135deg, #fef3c7, #fde68a); color:#92400e; }
		.tk-col-dot { width:8px; height:8px; border-radius:50%; background:currentColor; box-shadow:0 0 0 3px rgba(255,255,255,.5); }
		.tk-col-count { font-size:11px; margin-left:auto; padding:3px 10px; border-radius:999px; background:rgba(255,255,255,.6); font-weight:700; }

		/* Day card */
		.tk-day-card {
			background:var(--tk-card); border:1px solid var(--tk-border); border-radius:14px;
			padding:16px 18px; margin-bottom:14px;
			box-shadow: var(--tk-shadow-sm);
			transition: transform .15s, box-shadow .2s, border-color .2s;
			position:relative; overflow:hidden;
		}
		.tk-day-card::before {
			content:""; position:absolute; top:0; left:0; bottom:0; width:4px;
		}
		.tk-day-card:hover { transform:translateY(-2px); box-shadow: var(--tk-shadow-md); }
		.tk-col[data-col="profit"] .tk-day-card::before { background: linear-gradient(180deg, var(--tk-win), #34d399); }
		.tk-col[data-col="loss"] .tk-day-card::before { background: linear-gradient(180deg, var(--tk-loss), #fb7185); }
		.tk-col[data-col="breakeven"] .tk-day-card::before { background: linear-gradient(180deg, var(--tk-warn), #fbbf24); }

		/* Card header */
		.tk-day-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px; }
		.tk-day-date { font-weight:700; font-size:14px; color:var(--tk-text); }
		.tk-day-pnl { font-size:22px; font-weight:800; letter-spacing:-.4px; }

		/* Meta */
		.tk-day-meta { display:flex; justify-content:space-between; font-size:12px; margin-bottom:10px; color:var(--tk-muted); }
		.tk-pnl-pct { font-weight:700; }

		/* Chips */
		.tk-badges { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:12px; }
		.tk-chip { font-size:11px; padding:3px 10px; border-radius:999px; font-weight:700; letter-spacing:.2px; }
		.tk-chip.green  { background:var(--tk-win-soft);  color:#065f46; }
		.tk-chip.red    { background:var(--tk-loss-soft); color:#9f1239; }
		.tk-chip.yellow { background:var(--tk-warn-soft); color:#92400e; }
		.tk-chip.blue   { background:var(--tk-info-soft); color:#075985; }
		.tk-chip.gray   { background:#eef1f7; color:#475569; }

		/* Sparkline */
		.tk-sparkline-wrap { margin-bottom:12px; }
		.tk-sparkline-label { font-size:10px; color:var(--tk-muted); margin-bottom:5px; text-transform:uppercase; letter-spacing:.4px; font-weight:600; }
		.tk-spark-bars { display:flex; gap:2px; align-items:flex-end; height:40px; }
		.tk-spark-bar { flex:1; min-width:4px; border-radius:3px 3px 0 0; transition: opacity .2s, transform .15s; }
		.tk-spark-bar:hover { opacity:.8; transform: translateY(-2px); }

		/* Details toggle */
		.tk-details { margin-top:6px; }
		.tk-summary-toggle {
			font-size:11px; color:var(--tk-muted); cursor:pointer;
			list-style:none; padding:6px 10px; border-radius:8px;
			font-weight:600; letter-spacing:.3px; text-transform:uppercase;
			background:#f4f5fa; display:inline-block;
			transition:background .15s;
		}
		.tk-summary-toggle:hover { background:#e8ebf4; color:var(--tk-primary); }
		.tk-summary-toggle::-webkit-details-marker { display:none; }
		.tk-summary-toggle::before { content:"▶ "; font-size:9px; }
		details[open] .tk-summary-toggle::before { content:"▼ "; }

		/* Trade table */
		.tk-trades-section { margin-top:10px; border-radius:10px; overflow:hidden; border:1px solid var(--tk-border); }
		.tk-trade-header, .tk-trade-row {
			display:grid; grid-template-columns:80px 65px 50px 80px 60px;
			gap:4px; font-size:11px; padding:8px 10px;
			align-items:center;
		}
		.tk-trade-row:not(:last-child) { border-bottom:1px solid #f0f1f7; }
		.tk-trade-row:hover { background:#f8f9fd; }
		.tk-trade-header { background:#f4f5fa; font-weight:700; color:var(--tk-muted); font-size:10px; text-transform:uppercase; letter-spacing:.4px; }
		.tk-trade-sym { font-weight:700; color:var(--tk-primary); text-decoration:none; }
		.tk-trade-sym:hover { text-decoration:underline; }
		.tk-trade-type.long  { color:var(--tk-info); font-weight:600; }
		.tk-trade-type.short { color:#fb923c; font-weight:600; }
		.tk-trade-pnl { font-weight:700; }
		.tk-trade-pct { font-size:10px; }

		/* Status badges */
		.tk-badge-win        { background:var(--tk-win-soft);  color:#065f46; padding:2px 8px; border-radius:999px; font-size:10px; font-weight:700; }
		.tk-badge-loss       { background:var(--tk-loss-soft); color:#9f1239; padding:2px 8px; border-radius:999px; font-size:10px; font-weight:700; }
		.tk-badge-open       { background:var(--tk-info-soft); color:#075985; padding:2px 8px; border-radius:999px; font-size:10px; font-weight:700; }
		.tk-badge-breakeven  { background:var(--tk-warn-soft); color:#92400e; padding:2px 8px; border-radius:999px; font-size:10px; font-weight:700; }

		/* Empty state */
		.tk-empty {
			color:var(--tk-muted); font-size:12px; text-align:center; padding:28px 20px;
			background:rgba(255,255,255,.5); border:2px dashed var(--tk-border); border-radius:12px;
		}
		</style>`);
	}
}

/* ── Helpers ── */

function _fmt_pnl(v) {
	if (v === null || v === undefined) return "₹0";
	const abs = Math.abs(v);
	const sign = v < 0 ? "-" : "";
	if (abs >= 1e7) return sign + "₹" + (abs / 1e7).toFixed(2) + "Cr";
	if (abs >= 1e5) return sign + "₹" + (abs / 1e5).toFixed(2) + "L";
	if (abs >= 1000) return sign + "₹" + (abs / 1000).toFixed(1) + "K";
	return sign + "₹" + abs.toFixed(2);
}

function _short_date(d) {
	if (!d) return "";
	const [y, m, day] = d.split("-");
	const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
	return `${parseInt(day)} ${months[parseInt(m) - 1]}`;
}

function _format_date(d) {
	if (!d) return "";
	const dt = new Date(d);
	const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
	const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
	return `${days[dt.getDay()]} ${dt.getDate()} ${months[dt.getMonth()]} ${dt.getFullYear()}`;
}

function _sparkline(pnlValues) {
	if (!pnlValues || !pnlValues.length) return '<div style="height:36px;color:var(--text-muted);font-size:10px">–</div>';
	const maxAbs = Math.max(...pnlValues.map(Math.abs), 1);
	const bars = pnlValues.map(v => {
		const h = Math.max(4, Math.round(Math.abs(v) / maxAbs * 32));
		const color = v >= 0 ? "#10b981" : "#f43f5e";
		const pnlTip = _fmt_pnl(v);
		return `<div class="tk-spark-bar" style="height:${h}px;background:${color}" title="${pnlTip}"></div>`;
	}).join("");
	return `<div class="tk-spark-bars">${bars}</div>`;
}

