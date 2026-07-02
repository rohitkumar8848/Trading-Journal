frappe.pages["trade-dashboard"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Trade Dashboard",
		single_column: true,
	});

	const app = new TradeDashboard(page);
	$(wrapper).data("app", app);
};

class TradeDashboard {
	constructor(page) {
		this.page = page;
		this.from_date = frappe.datetime.add_months(frappe.datetime.get_today(), -1);
		this.to_date = frappe.datetime.get_today();
		this.broker = "";
		this.page.add_button(__("Refresh"), () => this.refresh(), { icon: "reload" });
		this.page.add_button(__("Holdings"), () => frappe.set_route("trade-holdings"), { icon: "small-file" });
		this.page.add_button(__("Import CSV"), () => frappe.set_route("trade-import"), { icon: "upload" });
		this.page.add_button(__("Review"), () => frappe.set_route("trade-review"), { icon: "file" });
		this.page.add_button(__("New Trade"), () => frappe.new_doc("Trade"), {
			btn_class: "btn-primary",
		});
		this._render_skeleton();
		this._setup_filters();
		this.refresh();
		this._load_market_pulse();
		this._load_screener_widgets();
	}

	_setup_filters() {
		const $bar = this.page.main.find(".tj-filter-bar");

		const makeDatePicker = (key, label) => {
			const $wrap = $(`
				<div class="tj-filter">
					<label>${label}</label>
					<input type="date" class="form-control input-sm tj-date" data-key="${key}" value="${this[key]}" />
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

		// Broker filter — mount a Frappe Link control
		const $brokerWrap = $(`
			<div class="tj-filter">
				<label>Broker</label>
				<div class="tj-broker-slot"></div>
			</div>
		`);
		$bar.append($brokerWrap);
		this.broker_field = frappe.ui.form.make_control({
			parent: $brokerWrap.find(".tj-broker-slot")[0],
			df: {
				fieldtype: "Link", fieldname: "broker", options: "Broker",
				placeholder: __("All Brokers"),
				onchange: () => { this.broker = this.broker_field.get_value() || ""; this.refresh(); },
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
		const $presets = $('<div class="tj-presets"></div>');
		presets.forEach(p => {
			const $btn = $(`<button class="btn btn-xs btn-default tj-preset-btn">${p.label}</button>`);
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

	_render_skeleton() {
		this.page.main.html(`
			<div class="tj-dashboard" style="padding:16px">
				<div class="tj-market-pulse" style="margin-bottom:16px"></div>
				<div class="tj-quick-links" style="margin-bottom:16px"></div>
				<div class="tj-screener-row" style="margin-bottom:20px"></div>
				<div class="tj-hero-cards" style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px"></div>
				<div class="tj-filter-bar"></div>
				<div class="tj-brokers" style="margin-bottom:20px"></div>
				<div class="tj-summary-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px"></div>
				<div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:20px">
					<div class="tj-card">
						<div class="tj-card-title">Equity Curve</div>
						<div class="tj-equity-chart" style="height:260px"></div>
					</div>
					<div class="tj-card">
						<div class="tj-card-title">Win / Loss / Breakeven</div>
						<div class="tj-donut-chart" style="height:260px"></div>
					</div>
				</div>
				<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
					<div class="tj-card">
						<div class="tj-card-title">Daily P&L</div>
						<div class="tj-daily-chart" style="height:220px"></div>
					</div>
					<div class="tj-card">
						<div class="tj-card-title">Drawdown (Underwater)</div>
						<div class="tj-dd-chart" style="height:220px"></div>
					</div>
				</div>

				<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
					<div class="tj-card">
						<div class="tj-card-title">R-Multiple Distribution</div>
						<div class="tj-r-chart" style="height:220px"></div>
					</div>
					<div class="tj-card">
						<div class="tj-card-title">Day-of-Week Performance</div>
						<div class="tj-dow-heatmap"></div>
					</div>
				</div>

				<div class="tj-card" style="margin-bottom:20px">
					<div class="tj-card-title">Setup Performance &amp; Expectancy</div>
					<div class="tj-setup-table"></div>
				</div>

				<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
					<div class="tj-card tj-best-card">
						<div class="tj-card-title">Best Trade This Week</div>
						<div class="tj-best-trade-week"></div>
					</div>
					<div class="tj-card tj-worst-card">
						<div class="tj-card-title">Worst Trade This Week</div>
						<div class="tj-worst-trade-week"></div>
					</div>
				</div>

				<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
					<div class="tj-card tj-best-card">
						<div class="tj-card-title">Best Trade This Month</div>
						<div class="tj-best-trade-month"></div>
					</div>
					<div class="tj-card tj-worst-card">
						<div class="tj-card-title">Worst Trade This Month</div>
						<div class="tj-worst-trade-month"></div>
					</div>
				</div>

				<div class="tj-card" style="margin-bottom:20px">
					<div class="tj-card-title">Calendar Heatmap</div>
					<div class="tj-calendar"></div>
				</div>

				<div class="tj-card" style="margin-bottom:20px">
					<div class="tj-card-title">Mistake Leaks — Cost Analysis</div>
					<div class="tj-mistakes"></div>
				</div>

				<div class="tj-card">
					<div class="tj-card-title">Recent Trades</div>
					<div class="tj-trade-table"></div>
				</div>
			</div>
		`);
		this._inject_styles();
	}

	_inject_styles() {
		if ($("#tj-styles").length) return;
		$("head").append(`<style id="tj-styles">
			/* ─── Design tokens ─── */
			:root {
				--tj-bg: #f6f7fb;
				--tj-card: #ffffff;
				--tj-border: #e6e8f0;
				--tj-text: #0f172a;
				--tj-muted: #64748b;
				--tj-primary: #6366f1;
				--tj-primary-2: #8b5cf6;
				--tj-win: #10b981;
				--tj-win-soft: #d1fae5;
				--tj-loss: #f43f5e;
				--tj-loss-soft: #ffe4e6;
				--tj-warn: #f59e0b;
				--tj-warn-soft: #fef3c7;
				--tj-info: #0ea5e9;
				--tj-info-soft: #e0f2fe;
				--tj-shadow-sm: 0 1px 2px rgba(15,23,42,.04), 0 1px 3px rgba(15,23,42,.06);
				--tj-shadow-md: 0 4px 16px rgba(15,23,42,.06), 0 2px 6px rgba(15,23,42,.04);
				--tj-shadow-lg: 0 12px 36px rgba(99,102,241,.18);
			}

			/* Full-width dashboard */
			body [data-page-route="trade-dashboard"] .container,
			body [data-page-route="trade-dashboard"] .page-body,
			body [data-page-route="trade-dashboard"] .page-wrapper,
			body [data-page-route="trade-dashboard"] .page-head .container,
			body [data-page-route="trade-dashboard"] .row.layout-main,
			body [data-page-route="trade-dashboard"] .layout-main-section-wrapper,
			body [data-page-route="trade-dashboard"] .layout-main-section { max-width:100% !important; width:100% !important; flex:1 1 100% !important; padding-left:12px !important; padding-right:12px !important; margin-left:0 !important; margin-right:0 !important; }
			body [data-page-route="trade-dashboard"] .page-body { background:var(--tj-bg); }
			.tj-dashboard { max-width:100% !important; width:100% !important; box-sizing:border-box; color:var(--tj-text); font-feature-settings: "tnum" 1; }

			/* ─── Filter bar (gradient hero) ─── */
			.tj-filter-bar {
				display:flex; flex-wrap:wrap; gap:14px; align-items:flex-end;
				padding:16px 20px; margin-bottom:20px; border-radius:14px;
				background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%);
				box-shadow: var(--tj-shadow-lg);
				position:relative; overflow:hidden;
			}
			.tj-filter-bar::before {
				content:""; position:absolute; inset:0;
				background: radial-gradient(800px 200px at 90% -20%, rgba(255,255,255,.25), transparent 60%);
				pointer-events:none;
			}
			.tj-filter-bar .tj-filter { display:flex; flex-direction:column; gap:4px; position:relative; }
			.tj-filter-bar .tj-filter label { font-size:10px; color:rgba(255,255,255,.85); text-transform:uppercase; letter-spacing:.6px; font-weight:700; margin:0; }
			.tj-filter-bar .tj-date {
				height:34px; font-size:12px; padding:6px 10px; width:160px;
				border:1px solid rgba(255,255,255,.3) !important;
				background:rgba(255,255,255,.95) !important; color:var(--tj-text) !important;
				border-radius:8px; font-weight:600;
				transition: box-shadow .2s, transform .1s;
			}
			.tj-filter-bar .tj-date:focus { outline:none; box-shadow:0 0 0 3px rgba(255,255,255,.35); }
			.tj-filter-bar .tj-broker-slot .form-group { margin:0; }
			.tj-filter-bar .tj-broker-slot .control-label { display:none; }
			.tj-filter-bar .tj-broker-slot input {
				height:34px !important; font-size:12px !important; width:200px !important;
				border:1px solid rgba(255,255,255,.3) !important;
				background:rgba(255,255,255,.95) !important; color:var(--tj-text) !important;
				border-radius:8px !important; font-weight:600;
			}
			.tj-filter-bar .tj-presets { display:flex; gap:6px; flex-wrap:wrap; margin-left:auto; position:relative; }
			.tj-filter-bar .tj-preset-btn {
				font-size:11px; padding:6px 14px; min-width:44px; font-weight:700; letter-spacing:.3px;
				background:rgba(255,255,255,.18); color:#fff;
				border:1px solid rgba(255,255,255,.25); border-radius:999px;
				backdrop-filter: blur(6px);
				transition: background .18s, transform .1s, box-shadow .18s;
			}
			.tj-filter-bar .tj-preset-btn:hover { background:rgba(255,255,255,.95); color:var(--tj-primary); transform:translateY(-1px); box-shadow:0 4px 12px rgba(0,0,0,.15); }
			.tj-filter-bar .tj-preset-btn:active { transform:translateY(0); }

			/* ─── Cards ─── */
			.tj-card {
				background:var(--tj-card); border:1px solid var(--tj-border);
				border-radius:14px; padding:20px;
				box-shadow: var(--tj-shadow-sm);
				transition: box-shadow .2s, transform .15s;
			}
			.tj-card:hover { box-shadow: var(--tj-shadow-md); }
			.tj-card-title {
				font-weight:700; font-size:12px; color:var(--tj-muted);
				text-transform:uppercase; letter-spacing:.7px; margin-bottom:14px;
				display:flex; align-items:center; gap:8px;
			}
			.tj-card-title::before {
				content:""; width:4px; height:14px; border-radius:2px;
				background: linear-gradient(180deg, var(--tj-primary), var(--tj-primary-2));
			}

			/* ─── Hero cards ─── */
			.tj-hero-card {
				border-radius:16px; padding:24px 28px; color:#fff;
				box-shadow:0 8px 32px rgba(0,0,0,.28);
				position:relative; overflow:hidden;
				transition:transform .2s, box-shadow .2s;
			}
			.tj-hero-card::after {
				content:""; position:absolute; inset:0;
				background:radial-gradient(600px 200px at 110% -30%, rgba(255,255,255,.12), transparent 60%);
				pointer-events:none;
			}
			.tj-hero-card:hover { transform:translateY(-3px); box-shadow:0 14px 40px rgba(0,0,0,.36); }
			.tj-hero-lbl { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.8px; opacity:.7; margin-bottom:8px; }
			.tj-hero-val { font-size:38px; font-weight:900; letter-spacing:-1px; line-height:1.05; color:#fff; }
			.tj-hero-sub { font-size:12px; opacity:.65; margin-top:10px; font-weight:500; }

			/* ─── Summary stat cards ─── */
			.tj-summary-card {
				position:relative; background:var(--tj-card);
				border:1px solid var(--tj-border); border-radius:14px;
				padding:18px 22px;
				box-shadow: var(--tj-shadow-sm);
				overflow:hidden;
				transition: transform .18s, box-shadow .2s, border-color .2s;
			}
			.tj-summary-card::before {
				content:""; position:absolute; top:0; left:0; right:0; height:3px;
				background: linear-gradient(90deg, var(--tj-primary), var(--tj-primary-2));
				opacity:.9;
			}
			.tj-summary-card:hover { transform:translateY(-2px); box-shadow: var(--tj-shadow-md); border-color:#d8dbe8; }
			.tj-summary-card .label { font-size:11px; color:var(--tj-muted); text-transform:uppercase; letter-spacing:.5px; font-weight:700; }
			.tj-summary-card .value { font-size:26px; font-weight:800; margin-top:6px; letter-spacing:-.5px; color:var(--tj-text); }
			.tj-summary-card .value.positive { color:var(--tj-win); }
			.tj-summary-card .value.negative { color:var(--tj-loss); }
			.tj-summary-card.pos::before { background: linear-gradient(90deg, var(--tj-win), #34d399); }
			.tj-summary-card.neg::before { background: linear-gradient(90deg, var(--tj-loss), #fb7185); }

			/* ─── Setup table ─── */
			.tj-setup-table table { width:100%; border-collapse:separate; border-spacing:0; }
			.tj-setup-table th, .tj-setup-table td { padding:10px 10px; font-size:12px; }
			.tj-setup-table thead th { background:#f1f2f8; color:var(--tj-muted); text-transform:uppercase; letter-spacing:.4px; font-size:10px; font-weight:700; border-bottom:1px solid var(--tj-border); }
			.tj-setup-table tbody tr { transition:background .15s; }
			.tj-setup-table tbody tr:hover { background:#f8f9fd; }
			.tj-setup-table tbody td { border-bottom:1px solid #f1f2f8; }

			/* ─── Recent Trades table ─── */
			.tj-trade-table { width:100%; border-radius:10px; overflow:hidden; border:1px solid var(--tj-border); }
			.tj-trade-row { display:grid; grid-template-columns:1.4fr 1.2fr 0.8fr 1fr 1fr 1fr 1fr 0.8fr 1.3fr; gap:8px; font-size:12.5px; padding:11px 14px; align-items:center; transition:background .15s; }
			.tj-trade-row:not(.tj-trade-header) { border-top:1px solid #f0f1f7; }
			.tj-trade-row:not(.tj-trade-header):hover { background:#f8f9fd; }
			.tj-trade-header { background:#f1f2f8; font-weight:700; color:var(--tj-muted); text-transform:uppercase; font-size:10.5px; letter-spacing:.5px; padding:12px 14px; border:0 !important; }
			.tj-trade-row a { color:var(--tj-primary); text-decoration:none; }
			.tj-trade-row a:hover { text-decoration:underline; }

			/* ─── Status badges (pill style) ─── */
			.badge-win       { background:var(--tj-win-soft);  color:#065f46; padding:3px 10px; border-radius:999px; font-size:11px; font-weight:700; }
			.badge-loss      { background:var(--tj-loss-soft); color:#9f1239; padding:3px 10px; border-radius:999px; font-size:11px; font-weight:700; }
			.badge-open      { background:var(--tj-info-soft); color:#075985; padding:3px 10px; border-radius:999px; font-size:11px; font-weight:700; }
			.badge-breakeven { background:var(--tj-warn-soft); color:#92400e; padding:3px 10px; border-radius:999px; font-size:11px; font-weight:700; }

			/* ─── Day-of-Week heatmap ─── */
			.tj-dow-grid { display:grid; grid-template-columns:repeat(7, 1fr); gap:8px; }
			.tj-dow-cell {
				border-radius:10px; padding:12px 10px; text-align:center;
				border:1px solid rgba(0,0,0,.04);
				transition:transform .15s;
			}
			.tj-dow-cell:hover { transform:translateY(-2px); }
			.tj-dow-day { font-size:10px; text-transform:uppercase; letter-spacing:.5px; font-weight:700; opacity:.9; }
			.tj-dow-pnl { font-size:15px; font-weight:800; margin-top:4px; letter-spacing:-.3px; }
			.tj-dow-meta { font-size:10px; margin-top:3px; opacity:.85; }

			/* ─── Best/Worst cards ─── */
			.tj-best-card::before, .tj-worst-card::before {
				content:""; position:absolute; top:0; left:0; right:0; height:4px;
			}
			.tj-best-card, .tj-worst-card { position:relative; }
			.tj-best-card::before { background: linear-gradient(90deg, var(--tj-win), #34d399); }
			.tj-worst-card::before { background: linear-gradient(90deg, var(--tj-loss), #fb7185); }
			.tj-bw-head { display:flex; align-items:center; gap:10px; margin-bottom:6px; }
			.tj-bw-symbol { font-size:18px; font-weight:800; color:var(--tj-primary); text-decoration:none; }
			.tj-bw-symbol:hover { text-decoration:underline; }
			.tj-bw-pnl { font-size:30px; font-weight:800; letter-spacing:-.5px; }
			.tj-bw-meta { font-size:12px; color:var(--tj-muted); display:flex; gap:6px; margin-top:4px; flex-wrap:wrap; }
			.tj-empty { color:var(--tj-muted); font-size:12px; padding:12px 0; font-style:italic; }

			/* ─── Broker cards (2 per row, 1 on mobile) ─── */
			.tj-broker-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:14px; }
			@media (max-width: 720px) { .tj-broker-grid { grid-template-columns:1fr; } }
			.tj-broker-card {
				position:relative; background:var(--tj-card); border:1px solid var(--tj-border);
				border-radius:14px; padding:16px 20px; box-shadow:var(--tj-shadow-sm);
				cursor:pointer; overflow:hidden;
				transition:transform .18s, box-shadow .2s, border-color .2s;
			}
			.tj-broker-card::before {
				content:""; position:absolute; top:0; left:0; bottom:0; width:4px;
				background: linear-gradient(180deg, var(--tj-primary), var(--tj-primary-2));
			}
			.tj-broker-card:hover { transform:translateY(-2px); box-shadow:var(--tj-shadow-md); }
			.tj-broker-card.tj-broker-active {
				border-color:var(--tj-primary); box-shadow:0 0 0 3px rgba(99,102,241,.15), var(--tj-shadow-md);
			}
			.tj-broker-top { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:12px; }
			.tj-broker-name-wrap { display:flex; flex-direction:column; gap:4px; min-width:0; }
			.tj-broker-name { font-size:15px; font-weight:800; letter-spacing:-.2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
			.tj-broker-holder {
				display:inline-block; font-size:10px; font-weight:700; letter-spacing:.3px;
				background:linear-gradient(135deg, #eef2ff, #f5f3ff); color:#4f46e5;
				padding:2px 8px; border-radius:999px; border:1px solid #e0e7ff;
				width:fit-content;
			}
			.tj-broker-type { font-size:10px; color:var(--tj-muted); text-transform:uppercase; letter-spacing:.5px; font-weight:700; flex-shrink:0; }
			.tj-broker-numbers { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-bottom:10px; }
			.tj-broker-numbers-4 { grid-template-columns:repeat(4, minmax(0, 1fr)); }
			.tj-broker-k { font-size:9px; color:var(--tj-muted); text-transform:uppercase; letter-spacing:.4px; font-weight:700; margin-bottom:3px; display:flex; align-items:center; gap:5px; }
			.tj-broker-count { background:#e0f2fe; color:#075985; padding:1px 6px; border-radius:999px; font-size:9px; font-weight:800; letter-spacing:0; }
			.tj-broker-v { font-size:15px; font-weight:800; letter-spacing:-.3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
			.tj-broker-foot { display:flex; justify-content:space-between; font-size:10.5px; color:var(--tj-muted); border-top:1px solid #f0f1f7; padding-top:8px; font-weight:600; }
			.tj-broker-setup {
				padding:14px 18px; background:#fffbeb; border:1px dashed #fde68a; border-radius:12px;
				font-size:13px; color:#92400e;
			}
			.tj-broker-setup a { color:#6366f1; font-weight:700; }

			/* ─── Goal tracker ─── */
			.tj-goals-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:14px; }
			.tj-goal-card {
				background:var(--tj-card); border:1px solid var(--tj-border); border-radius:14px;
				padding:16px 20px; box-shadow:var(--tj-shadow-sm);
				transition:transform .18s, box-shadow .2s;
			}
			.tj-goal-card:hover { transform:translateY(-2px); box-shadow:var(--tj-shadow-md); }
			.tj-goal-label { font-size:10px; color:var(--tj-muted); text-transform:uppercase; letter-spacing:.6px; font-weight:700; }
			.tj-goal-numbers { margin:6px 0 10px; display:flex; align-items:baseline; gap:6px; }
			.tj-goal-current { font-size:22px; font-weight:800; letter-spacing:-.3px; }
			.tj-goal-sep { color:var(--tj-muted); font-size:12px; }
			.tj-goal-target { font-size:14px; color:var(--tj-muted); font-weight:600; }
			.tj-goal-bar { height:8px; background:#eef1f7; border-radius:999px; overflow:hidden; }
			.tj-goal-fill { height:100%; border-radius:999px; transition:width .4s; }
			.tj-goal-pct { font-size:11px; color:var(--tj-muted); margin-top:6px; font-weight:600; }
			.tj-goal-setup {
				padding:14px 18px; background:#fffbeb; border:1px dashed #fde68a; border-radius:12px;
				font-size:13px; color:#92400e;
			}
			.tj-goal-setup a { color:#6366f1; font-weight:700; }

			/* ─── Mistake leaks ─── */
			.tj-mistakes-head {
				display:grid; grid-template-columns:2fr 3fr 1fr 1fr; gap:10px;
				padding:8px 12px; background:#f1f2f8; border-radius:8px 8px 0 0;
				font-size:10.5px; font-weight:700; color:var(--tj-muted);
				text-transform:uppercase; letter-spacing:.4px;
			}
			.tj-mistake-row {
				display:grid; grid-template-columns:2fr 3fr 1fr 1fr; gap:10px;
				align-items:center; padding:10px 12px;
				border-bottom:1px solid #f0f1f7; font-size:12.5px;
				transition:background .15s;
			}
			.tj-mistake-row:hover { background:#f8f9fd; }
			.tj-mistake-name { display:flex; flex-direction:column; gap:2px; }
			.tj-mistake-cat { font-size:9px; color:var(--tj-muted); text-transform:uppercase; letter-spacing:.4px; font-weight:700; }
			.tj-mistake-bar-wrap { height:10px; background:#eef1f7; border-radius:999px; overflow:hidden; }
			.tj-mistake-bar { height:100%; border-radius:999px; transition:width .4s; }
			.tj-mistake-count { font-size:11px; color:var(--tj-muted); }
			.tj-mistake-pnl { font-weight:800; text-align:right; }

			/* ─── Quick links bar ─── */
			.tj-quick-links-bar {
				display:flex; gap:8px; flex-wrap:wrap;
			}
			.tj-ql-btn {
				display:inline-flex; align-items:center; gap:6px;
				padding:7px 14px; border-radius:8px; font-size:12px; font-weight:700;
				text-decoration:none; border:1px solid var(--tj-border);
				background:var(--tj-card); color:var(--tj-text);
				box-shadow:var(--tj-shadow-sm);
				transition:transform .15s, box-shadow .15s, border-color .15s;
			}
			.tj-ql-btn:hover { transform:translateY(-1px); box-shadow:var(--tj-shadow-md); border-color:#c7d0e8; text-decoration:none; color:var(--tj-text); }
			.tj-ql-btn .tj-ql-dot { width:8px; height:8px; border-radius:50%; }

			/* ─── Screener mini-widgets ─── */
			.tj-screener-row { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
			@media(max-width:800px){ .tj-screener-row { grid-template-columns:1fr; } }
			.tj-widget-card {
				background:var(--tj-card); border:1px solid var(--tj-border);
				border-radius:14px; overflow:hidden; box-shadow:var(--tj-shadow-sm);
			}
			.tj-widget-header {
				display:flex; align-items:center; justify-content:space-between;
				padding:12px 16px; border-bottom:1px solid var(--tj-border);
			}
			.tj-widget-title {
				font-size:11px; font-weight:800; text-transform:uppercase;
				letter-spacing:.6px; color:var(--tj-muted);
				display:flex; align-items:center; gap:6px;
			}
			.tj-widget-title-dot { width:8px; height:8px; border-radius:50%; }
			.tj-widget-link {
				font-size:11px; font-weight:700; text-decoration:none;
				padding:4px 10px; border-radius:6px; border:1px solid var(--tj-border);
				color:var(--tj-primary);
				transition:background .15s;
			}
			.tj-widget-link:hover { background:#eef2ff; text-decoration:none; }
			.tj-mini-table { width:100%; border-collapse:collapse; font-size:12px; }
			.tj-mini-table th {
				text-align:left; padding:6px 14px; background:#f8f9fd;
				color:var(--tj-muted); font-size:10px; font-weight:700;
				text-transform:uppercase; letter-spacing:.4px;
				border-bottom:1px solid var(--tj-border);
			}
			.tj-mini-table td { padding:7px 14px; border-bottom:1px solid #f0f1f7; }
			.tj-mini-table tr:last-child td { border:none; }
			.tj-mini-table tr:hover td { background:#f8f9fd; }
			.tj-mini-badge { display:inline-block; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:700; }
			.tj-rs-chip90 { background:#4c1d95; color:#e9d5ff; }
			.tj-rs-chip80 { background:#1e3a5f; color:#93c5fd; }
			.tj-rs-chip70 { background:#064e3b; color:#6ee7b7; }
			.tj-rs-delta-up   { color:#10b981; font-weight:700; }
			.tj-rs-delta-down { color:#f43f5e; font-weight:700; }
			.tj-vol-chip-hot  { background:#7c2d12; color:#fb923c; }
			.tj-vol-chip-warm { background:#422006; color:#fcd34d; }
			.tj-widget-loading { padding:20px; text-align:center; color:var(--tj-muted); font-size:12px; }

			/* ─── Calendar heatmap ─── */
			.tj-cal-wrap { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:20px; }
			.tj-cal-month-title { font-size:12px; font-weight:700; color:var(--tj-muted); text-transform:uppercase; letter-spacing:.5px; margin-bottom:6px; }
			.tj-cal-dow { display:grid; grid-template-columns:repeat(7, 1fr); gap:3px; margin-bottom:4px; }
			.tj-cal-dow span { font-size:10px; color:var(--tj-muted); text-align:center; font-weight:600; }
			.tj-cal-grid { display:grid; grid-template-columns:repeat(7, 1fr); gap:3px; }
			.tj-cal-cell { aspect-ratio:1; border-radius:3px; transition:transform .12s; cursor:default; }
			.tj-cal-cell.tj-cal-none { background:#eef1f7; }
			.tj-cal-cell.tj-cal-empty { background:transparent; }
			.tj-cal-cell.tj-cal-trade:hover { transform:scale(1.3); box-shadow:0 2px 6px rgba(0,0,0,.2); z-index:2; position:relative; }
			.tj-cal-legend { display:flex; align-items:center; gap:4px; margin-top:14px; font-size:10px; color:var(--tj-muted); justify-content:flex-end; }
			.tj-cal-legend .tj-cal-cell { width:12px; height:12px; aspect-ratio:initial; }
		</style>`);
	}

	_render_quick_links() {
		const links = [
			{ href: "/app/daily-prep",       label: "Daily Prep",       dot: "#f59e0b" },
			{ href: "/app/trade-analytics",   label: "Trade Analytics",  dot: "#6366f1" },
			{ href: "/app/rs-leaders",        label: "RS Leaders",       dot: "#8b5cf6" },
			{ href: "/app/volume-screener",   label: "Volume Surge",     dot: "#f97316" },
			{ href: "/app/position-sizer",    label: "Position Sizer",   dot: "#10b981" },
			{ href: "/app/breakout-screener", label: "52W Breakout",     dot: "#0ea5e9" },
			{ href: "/app/sector-heatmap",    label: "Sector Rotation",  dot: "#ec4899" },
		];
		const html = `<div class="tj-quick-links-bar">` +
			links.map(l =>
				`<a class="tj-ql-btn" href="${l.href}">
					<span class="tj-ql-dot" style="background:${l.dot}"></span>${l.label}
				</a>`
			).join("") +
			`</div>`;
		this.page.main.find(".tj-quick-links").html(html);
	}

	_load_screener_widgets() {
		this._render_quick_links();
		this.page.main.find(".tj-screener-row").html(`
			<div class="tj-widget-card">
				<div class="tj-widget-header">
					<div class="tj-widget-title">
						<span class="tj-widget-title-dot" style="background:#8b5cf6"></span>RS Leaders
					</div>
					<a class="tj-widget-link" href="/app/rs-leaders">View All →</a>
				</div>
				<div class="tj-rs-widget-body"><div class="tj-widget-loading">Loading…</div></div>
			</div>
			<div class="tj-widget-card">
				<div class="tj-widget-header">
					<div class="tj-widget-title">
						<span class="tj-widget-title-dot" style="background:#f97316"></span>Volume Surge
					</div>
					<a class="tj-widget-link" href="/app/volume-screener">View All →</a>
				</div>
				<div class="tj-vol-widget-body"><div class="tj-widget-loading">Loading…</div></div>
			</div>
		`);

		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.get_rs_leaders",
			args: { min_rs: 75, max_pct_from_high: -15, nifty500_only: 1 },
			callback: r => {
				if (r.message && r.message.ok) this._render_rs_widget(r.message);
				else this.page.main.find(".tj-rs-widget-body").html(`<div class="tj-widget-loading">No data</div>`);
			},
		});

		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.get_volume_surge",
			args: { min_vol_ratio: 2.0, min_rs: 50, nifty500_only: 1 },
			callback: r => {
				if (r.message && r.message.ok) this._render_vol_widget(r.message);
				else this.page.main.find(".tj-vol-widget-body").html(`<div class="tj-widget-loading">No data</div>`);
			},
		});
	}

	_render_rs_widget(d) {
		const top = (d.results || []).slice(0, 10);
		if (!top.length) {
			this.page.main.find(".tj-rs-widget-body").html(`<div class="tj-widget-loading">No stocks found</div>`);
			return;
		}
		const rs_chip = rs => {
			if (rs >= 90) return `<span class="tj-mini-badge tj-rs-chip90">RS ${rs}</span>`;
			if (rs >= 80) return `<span class="tj-mini-badge tj-rs-chip80">RS ${rs}</span>`;
			return               `<span class="tj-mini-badge tj-rs-chip70">RS ${rs}</span>`;
		};
		const delta_html = d => {
			if (!d && d !== 0) return `<span style="color:#94a3b8">—</span>`;
			const cls = d > 0 ? "tj-rs-delta-up" : d < 0 ? "tj-rs-delta-down" : "";
			return `<span class="${cls}">${d > 0 ? "▲" : d < 0 ? "▼" : ""}${Math.abs(d).toFixed(1)}</span>`;
		};
		const rows = top.map((r, i) => `
			<tr>
				<td style="color:#94a3b8;width:28px">${i + 1}</td>
				<td>
					<a href="https://www.tradingview.com/chart/?symbol=NSE:${r.symbol}" target="_blank" class="tj-chart-hover"
					   data-symbol="${r.symbol}" data-exchange="NSE"
					   style="font-weight:700;color:#6366f1;text-decoration:none">${r.symbol}</a>
				</td>
				<td>${rs_chip(r.rs_rating)}</td>
				<td>${delta_html(r.rs_delta)}</td>
				<td style="color:${r.pct_from_52w_high >= -5 ? "#10b981" : "#f59e0b"};font-size:11px">
					${r.pct_from_52w_high.toFixed(1)}%
				</td>
			</tr>`).join("");
		this.page.main.find(".tj-rs-widget-body").html(`
			<table class="tj-mini-table">
				<thead><tr><th>#</th><th>Symbol</th><th>RS</th><th>Δ 5d</th><th>vs High</th></tr></thead>
				<tbody>${rows}</tbody>
			</table>
			<div style="padding:8px 14px;font-size:10px;color:#94a3b8;border-top:1px solid #f0f1f7;">
				${d.total} stocks with RS ≥ 75 · Nifty 500 · ${d.date}
			</div>
		`);
	}

	_render_vol_widget(d) {
		const top = (d.results || []).slice(0, 10);
		if (!top.length) {
			this.page.main.find(".tj-vol-widget-body").html(`<div class="tj-widget-loading">No surge today</div>`);
			return;
		}
		const vol_chip = v => {
			if (v >= 4) return `<span class="tj-mini-badge tj-vol-chip-hot">${v}x</span>`;
			return          `<span class="tj-mini-badge tj-vol-chip-warm">${v}x</span>`;
		};
		const rows = top.map((r, i) => `
			<tr>
				<td style="color:#94a3b8;width:28px">${i + 1}</td>
				<td>
					<a href="https://www.tradingview.com/chart/?symbol=NSE:${r.symbol}" target="_blank" class="tj-chart-hover"
					   data-symbol="${r.symbol}" data-exchange="NSE"
					   style="font-weight:700;color:#f97316;text-decoration:none">${r.symbol}</a>
					${r.near_52w_high ? `<span style="font-size:9px;color:#10b981;margin-left:4px">▲High</span>` : ""}
				</td>
				<td>${vol_chip(r.vol_ratio)}</td>
				<td style="color:${r.rs_rating >= 70 ? "#8b5cf6" : "#94a3b8"};font-weight:700">${r.rs_rating}</td>
				<td style="color:${r.pct_from_52w_high >= -5 ? "#10b981" : "#f59e0b"};font-size:11px">
					${r.pct_from_52w_high.toFixed(1)}%
				</td>
			</tr>`).join("");
		this.page.main.find(".tj-vol-widget-body").html(`
			<table class="tj-mini-table">
				<thead><tr><th>#</th><th>Symbol</th><th>Vol Ratio</th><th>RS</th><th>vs High</th></tr></thead>
				<tbody>${rows}</tbody>
			</table>
			<div style="padding:8px 14px;font-size:10px;color:#94a3b8;border-top:1px solid #f0f1f7;">
				${d.total} stocks with Vol ≥ 2x · Nifty 500 · ${d.date}
			</div>
		`);
	}

	_load_market_pulse() {
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.get_market_breadth",
			callback: (r) => {
				if (r.message && r.message.ok) {
					this._render_market_pulse(r.message);
				}
			},
		});
	}

	_render_market_pulse(d) {
		const pct = (v) => (v || 0).toFixed(1);
		const adColor = d.ad_ratio >= 1.5 ? "#10b981" : (d.ad_ratio < 0.7 ? "#ef4444" : "#f59e0b");

		const breadthBar = (pct50, pct150, pct200) => {
			return `
				<div style="margin-top:10px;">
					<div style="display:flex;justify-content:space-between;margin-bottom:3px;font-size:10px;color:#64748b;font-weight:700;">
						<span>SMA Breadth</span>
						<span>0% ─────────────── 100%</span>
					</div>
					${[
						{ label: "SMA 50", val: pct50, color: "#6366f1" },
						{ label: "SMA 150", val: pct150, color: "#8b5cf6" },
						{ label: "SMA 200", val: pct200, color: "#a78bfa" },
					].map(b => `
						<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
							<span style="font-size:10px;color:#94a3b8;font-weight:700;width:52px;">${b.label}</span>
							<div style="flex:1;height:7px;background:#f1f5f9;border-radius:999px;overflow:hidden;">
								<div style="width:${b.val}%;height:100%;background:${b.color};border-radius:999px;transition:width .6s;"></div>
							</div>
							<span style="font-size:11px;font-weight:800;color:${b.color};width:36px;text-align:right;">${b.val}%</span>
						</div>
					`).join("")}
				</div>
			`;
		};

		const cards = [
			{
				icon: "📊",
				label: "Market Breadth",
				value: `${pct(d.above_sma50_pct)}%`,
				sub: "above SMA 50",
				color: d.above_sma50_pct >= 60 ? "#10b981" : (d.above_sma50_pct < 40 ? "#ef4444" : "#f59e0b"),
				extra: breadthBar(d.above_sma50_pct, d.above_sma150_pct, d.above_sma200_pct),
				wide: true,
			},
			{
				icon: "⚡",
				label: "A/D Ratio",
				value: d.ad_ratio.toFixed(2),
				sub: `${d.advancing} up · ${d.declining} down`,
				color: adColor,
			},
			{
				icon: "🎯",
				label: "RS Strong (≥70)",
				value: d.rs_strong,
				sub: `${pct(d.rs_strong / d.total * 100)}% of ${d.total}`,
				color: "#6366f1",
			},
			{
				icon: "🏔",
				label: "Near 52W High",
				value: d.near_52w_high,
				sub: "within 5% of high",
				color: "#0ea5e9",
			},
			{
				icon: "🌀",
				label: "VCP Setups",
				value: d.vcp_setups,
				sub: "today's scan",
				color: "#8b5cf6",
			},
			{
				icon: "📈",
				label: "Avg RS Rating",
				value: (d.avg_rs || 0).toFixed(1),
				sub: "Nifty 500 average",
				color: d.avg_rs >= 50 ? "#10b981" : "#ef4444",
			},
		];

		const html = `
			<div style="
				background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%);
				border-radius: 14px; padding: 18px 22px; position: relative; overflow: hidden;
			">
				<div style="
					position:absolute;inset:0;
					background:radial-gradient(800px 200px at 80% -10%, rgba(139,92,246,.2), transparent 55%);
					pointer-events:none;
				"></div>
				<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;position:relative;">
					<div>
						<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:rgba(255,255,255,.6);">Market Pulse</div>
						<div style="font-size:13px;font-weight:700;color:rgba(255,255,255,.9);margin-top:2px;">
							Nifty 500 · ${d.date || ""}
						</div>
					</div>
					<a href="/app/sector-heatmap" style="font-size:11px;font-weight:700;color:rgba(255,255,255,.7);text-decoration:none;
						background:rgba(255,255,255,.1);padding:6px 12px;border-radius:6px;border:1px solid rgba(255,255,255,.2);">
						Sector Rotation →
					</a>
				</div>
				<div style="display:grid;grid-template-columns:${cards[0].wide ? "1.6fr" : "1fr"} repeat(${cards.length - 1}, 1fr);gap:10px;position:relative;">
					${cards.map((c, i) => `
						<div style="
							background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);
							border-radius:12px;padding:14px 16px;
							${i === 0 ? "" : ""}
						">
							<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
								<span style="font-size:16px;">${c.icon}</span>
								<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:rgba(255,255,255,.55);">${c.label}</span>
							</div>
							<div style="font-size:26px;font-weight:900;color:${c.color};letter-spacing:-.5px;line-height:1.1;">${c.value}</div>
							<div style="font-size:11px;color:rgba(255,255,255,.45);margin-top:3px;font-weight:600;">${c.sub}</div>
							${c.extra || ""}
						</div>
					`).join("")}
				</div>
			</div>
		`;
		this.page.main.find(".tj-market-pulse").html(html);
	}

	refresh() {
		frappe.call({
			method: "trading_journal.trading_journal.page.trade_dashboard.trade_dashboard.get_dashboard_data",
			args: { from_date: this.from_date, to_date: this.to_date, broker: this.broker },
			callback: (r) => {
				if (!r.exc && r.message) {
					this._render(r.message);
				}
			},
		});
	}

	_render(data) {
		this._render_brokers(data.brokers || [], data.selected_broker);
		this._render_summary(data.summary);
		this._render_equity_chart(data.equity_curve);
		this._render_donut(data.summary);
		this._render_daily_chart(data.daily_pnl);
		this._render_drawdown_chart(data.drawdown_curve);
		this._render_r_chart(data.r_histogram, data.summary.avg_r);
		this._render_dow_heatmap(data.dow_stats);
		this._render_setup_table(data.setup_breakdown);
		this._render_best_worst(data.best_week, data.worst_week, data.best_month, data.worst_month);
		this._render_calendar(data.calendar);
		this._render_mistakes(data.mistakes_breakdown);
		this._render_trade_table(data.recent_trades);
	}

	_render_brokers(brokers, selected) {
		const container = this.page.main.find(".tj-brokers");
		if (!brokers || !brokers.length) {
			container.html(`
				<div class="tj-broker-setup">
					🏦 No brokers set up yet. <a href="/app/broker/new?broker_name=Default">Add a broker</a> to track capital and start-date per account.
				</div>
			`);
			return;
		}
		const cards = brokers.map(b => {
			const pnlColor = b.realized_pnl >= 0 ? "#10b981" : "#f43f5e";
			const isSel = selected === b.name;
			const holderPill = b.account_holder
				? `<span class="tj-broker-holder">👤 ${frappe.utils.escape_html(b.account_holder)}</span>`
				: "";
			return `
				<div class="tj-broker-card${isSel ? ' tj-broker-active' : ''}" data-broker="${frappe.utils.escape_html(b.name)}">
					<div class="tj-broker-top">
						<div class="tj-broker-name-wrap">
							<div class="tj-broker-name">${frappe.utils.escape_html(b.name)}</div>
							${holderPill}
						</div>
						<div class="tj-broker-type">${b.broker_type || ""}</div>
					</div>
					<div class="tj-broker-numbers tj-broker-numbers-4">
						<div>
							<div class="tj-broker-k">Starting</div>
							<div class="tj-broker-v">${format_currency(b.starting_capital)}</div>
						</div>
						<div>
							<div class="tj-broker-k">Open ${b.open_count ? `<span class="tj-broker-count">${b.open_count}</span>` : ""}</div>
							<div class="tj-broker-v" style="color:${b.open_count ? '#0ea5e9' : 'var(--tj-muted)'}">${format_currency(b.open_exposure || 0)}</div>
						</div>
						<div>
							<div class="tj-broker-k">Current</div>
							<div class="tj-broker-v" style="color:${pnlColor}">${format_currency(b.current_equity)}</div>
						</div>
						<div>
							<div class="tj-broker-k">Return</div>
							<div class="tj-broker-v" style="color:${pnlColor}">${b.return_pct > 0 ? "+" : ""}${b.return_pct}%</div>
						</div>
					</div>
					<div class="tj-broker-foot">
						<span>Since ${b.start_date || "—"}</span>
						<span>${b.trade_count} total${b.open_count ? ` · ${b.open_count} open` : ""}</span>
					</div>
				</div>
			`;
		}).join("");
		container.html(`
			<div class="tj-broker-grid">${cards}</div>
		`);
		container.find(".tj-broker-card").on("click", (e) => {
			const name = $(e.currentTarget).data("broker");
			// Toggle: clicking the active broker clears the filter
			if (this.broker === name) {
				this.broker = "";
				if (this.broker_field) this.broker_field.set_value("");
			} else {
				this.broker = name;
				if (this.broker_field) this.broker_field.set_value(name);
			}
			this.refresh();
		});
	}

	_render_mistakes(mistakes) {
		const container = this.page.main.find(".tj-mistakes");
		if (!mistakes || !mistakes.length) {
			container.html(`
				<div class="tj-empty">No mistakes tagged yet in this range.
				Open any trade, go to <b>Review & Mistakes</b>, and tag what went wrong to see the biggest leaks here.</div>
			`);
			return;
		}
		const maxCost = Math.max(1, ...mistakes.map(m => Math.abs(m.pnl)));
		const rows = mistakes.map(m => {
			const width = Math.abs(m.pnl) / maxCost * 100;
			const color = m.pnl < 0 ? "#f43f5e" : "#10b981";
			return `
				<div class="tj-mistake-row">
					<div class="tj-mistake-name">
						<span class="tj-mistake-cat">${m.category || "Other"}</span>
						<b>${m.mistake}</b>
					</div>
					<div class="tj-mistake-bar-wrap">
						<div class="tj-mistake-bar" style="width:${width}%;background:${color}"></div>
					</div>
					<div class="tj-mistake-count">${m.count}× (${m.losses}L)</div>
					<div class="tj-mistake-pnl" style="color:${color}">${format_currency(m.pnl)}</div>
				</div>
			`;
		}).join("");
		container.html(`
			<div class="tj-mistakes-head">
				<span>Mistake</span><span>Impact</span><span>Count</span><span>P&L Cost</span>
			</div>
			${rows}
		`);
	}

	_render_hero(s) {
		const net = s.net_pnl || 0;
		const netPositive = net >= 0;
		const netColor = netPositive ? "#10b981" : "#f43f5e";
		const netBg = netPositive
			? "linear-gradient(135deg, #064e3b 0%, #065f46 50%, #047857 100%)"
			: "linear-gradient(135deg, #4c0519 0%, #881337 50%, #9f1239 100%)";
		const netLabel = netPositive ? "You're up" : "You're down";

		const wr = s.win_rate || 0;
		const wrGood = wr >= 50;
		const wrBg = wrGood
			? "linear-gradient(135deg, #1e3a5f 0%, #1e40af 100%)"
			: "linear-gradient(135deg, #3b1a4a 0%, #6d28d9 100%)";
		const wrBar = `
			<div style="margin-top:12px; background:rgba(255,255,255,0.15); border-radius:999px; height:6px; overflow:hidden;">
				<div style="width:${wr}%; height:100%; background:#fff; border-radius:999px; transition:width .4s;"></div>
			</div>
			<div style="display:flex; justify-content:space-between; font-size:11px; opacity:.75; margin-top:5px;">
				<span>${s.wins}W</span><span>${s.losses}L</span>
			</div>`;

		const streak = s.current_streak || 0;
		const streakType = s.current_streak_type;
		const streakWin = streakType === "W";
		const streakBg = streakWin
			? "linear-gradient(135deg, #451a03 0%, #92400e 50%, #b45309 100%)"
			: (streakType === "L"
				? "linear-gradient(135deg, #1c1917 0%, #44403c 100%)"
				: "linear-gradient(135deg, #0f172a 0%, #334155 100%)");
		const streakIcon = streakWin ? "🔥" : (streakType === "L" ? "❄" : "—");
		const streakSub = streakWin
			? (streak >= 5 ? "You're on fire!" : streak >= 3 ? "Keep it going!" : "Building momentum")
			: (streakType === "L" ? (streak >= 3 ? "Regroup & refocus" : "Stay disciplined") : "No active streak");

		this.page.main.find(".tj-hero-cards").html(`
			<div class="tj-hero-card" style="background:${netBg};">
				<div class="tj-hero-lbl">${netLabel}</div>
				<div class="tj-hero-val" style="color:${netPositive ? "#6ee7b7" : "#fda4af"};">${format_currency(net)}</div>
				<div class="tj-hero-sub">Net P&amp;L after charges · ${s.total_trades} trade${s.total_trades === 1 ? "" : "s"}</div>
			</div>
			<div class="tj-hero-card" style="background:${wrBg};">
				<div class="tj-hero-lbl">Win Rate</div>
				<div class="tj-hero-val">${wr.toFixed(1)}%</div>
				${wrBar}
			</div>
			<div class="tj-hero-card" style="background:${streakBg};">
				<div class="tj-hero-lbl">Current Streak</div>
				<div class="tj-hero-val">${streakIcon} ${streak > 0 ? streak + (streakWin ? "W" : "L") : "—"}</div>
				<div class="tj-hero-sub">${streakSub}</div>
			</div>
		`);
	}

	_render_summary(s) {
		this._render_hero(s);
		const streakLabel = s.current_streak_type === "W"
			? `🔥 ${s.current_streak}W`
			: (s.current_streak_type === "L" ? `❄ ${s.current_streak}L` : "-");
		const cards = [
			{ label: "Total P&L", value: format_currency(s.total_pnl), cls: s.total_pnl >= 0 ? "positive" : "negative", accent: s.total_pnl >= 0 ? "pos" : "neg" },
			{ label: "Total Charges", value: format_currency(s.total_charges || 0), cls: "negative", accent: "neg" },
			{ label: "Net P&L (after charges)", value: format_currency(s.net_pnl || 0), cls: (s.net_pnl || 0) >= 0 ? "positive" : "negative", accent: (s.net_pnl || 0) >= 0 ? "pos" : "neg" },
			{ label: "Total Trades", value: s.total_trades, cls: "", accent: "" },
			{ label: "Win Rate", value: s.win_rate + "%", cls: s.win_rate >= 50 ? "positive" : "negative", accent: s.win_rate >= 50 ? "pos" : "neg" },
			{ label: "Wins / Losses", value: `${s.wins} / ${s.losses}`, cls: "", accent: "" },
			{ label: "Profit Factor", value: s.profit_factor + "x", cls: s.profit_factor >= 1.5 ? "positive" : (s.profit_factor < 1 ? "negative" : ""), accent: s.profit_factor >= 1.5 ? "pos" : (s.profit_factor < 1 ? "neg" : "") },
			{ label: "Avg R-Multiple", value: s.avg_r + "R", cls: s.avg_r >= 0.5 ? "positive" : (s.avg_r < 0 ? "negative" : ""), accent: s.avg_r >= 0.5 ? "pos" : (s.avg_r < 0 ? "neg" : "") },
			{
				label: "Max Drawdown",
				value: (s.max_drawdown || 0) === 0
					? "No drawdown"
					: `${format_currency(s.max_drawdown)} (${(s.max_drawdown_pct || 0).toFixed(2)}%)`,
				cls: (s.max_drawdown || 0) === 0 ? "positive" : "negative",
				accent: (s.max_drawdown || 0) === 0 ? "pos" : "neg",
			},
			{ label: "Current Streak", value: streakLabel, cls: s.current_streak_type === "W" ? "positive" : (s.current_streak_type === "L" ? "negative" : ""), accent: s.current_streak_type === "W" ? "pos" : (s.current_streak_type === "L" ? "neg" : "") },
			{ label: "Longest Win Streak", value: s.longest_win_streak + "W", cls: "positive", accent: "pos" },
			{ label: "Longest Loss Streak", value: s.longest_loss_streak + "L", cls: "negative", accent: "neg" },
			{ label: "Best Trade", value: format_currency(s.best_trade), cls: "positive", accent: "pos" },
			{ label: "Worst Trade", value: format_currency(s.worst_trade), cls: "negative", accent: "neg" },
			{ label: "Avg R:R", value: s.avg_rr + "x", cls: s.avg_rr >= 1.5 ? "positive" : "", accent: s.avg_rr >= 1.5 ? "pos" : "" },
		];
		this.page.main.find(".tj-summary-cards").html(
			cards.map(c => `
				<div class="tj-summary-card ${c.accent}">
					<div class="label">${c.label}</div>
					<div class="value ${c.cls}">${c.value}</div>
				</div>
			`).join("")
		);
	}

	_render_equity_chart(curve) {
		const container = this.page.main.find(".tj-equity-chart")[0];
		if (!container || !curve.length) return;
		const fmtDate = (iso) => {
			const [, m, d] = iso.split("-");
			const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
			return `${parseInt(d)} ${months[parseInt(m) - 1]}`;
		};
		const labels = curve.map(p => fmtDate(p.date));
		const values = curve.map(p => p.value);
		new frappe.Chart(container, {
			type: "line",
			data: { labels, datasets: [{ name: "Equity", values, chartType: "line" }] },
			colors: ["#6366f1"],
			height: 240,
			axisOptions: { xIsSeries: 1, xAxisMode: "tick" },
			lineOptions: { regionFill: 1, hideDots: values.length > 30 ? 1 : 0 },
			tooltipOptions: { formatTooltipY: d => format_currency(d) },
		});
	}

	_render_donut(s) {
		const container = this.page.main.find(".tj-donut-chart")[0];
		if (!container) return;
		const open = (s.total_trades - s.wins - s.losses) || 0;
		new frappe.Chart(container, {
			type: "donut",
			data: {
				labels: ["Win", "Loss", "Open/BE"],
				datasets: [{ values: [s.wins, s.losses, open] }],
			},
			colors: ["#10b981", "#f43f5e", "#94a3b8"],
			height: 240,
		});
	}

	_render_daily_chart(daily) {
		const container = this.page.main.find(".tj-daily-chart")[0];
		if (!container || !daily.length) return;
		const fmtDate = (iso) => {
			const [, m, d] = iso.split("-");
			const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
			return `${parseInt(d)} ${months[parseInt(m) - 1]}`;
		};
		new frappe.Chart(container, {
			type: "bar",
			data: {
				labels: daily.map(d => fmtDate(d.date)),
				datasets: [{ name: "P&L", values: daily.map(d => d.pnl) }],
			},
			colors: ["#8b5cf6"],
			height: 200,
			axisOptions: { xIsSeries: 1, xAxisMode: "tick" },
			tooltipOptions: { formatTooltipY: d => format_currency(d) },
		});
	}

	_render_setup_table(setups) {
		if (!setups || !setups.length) {
			this.page.main.find(".tj-setup-table").html('<p class="text-muted small" style="padding:8px">No data</p>');
			return;
		}
		const rows = setups.sort((a, b) => b.pnl - a.pnl).map(s => `
			<tr>
				<td style="font-weight:700">${s.setup}</td>
				<td>${s.total}</td>
				<td>${s.wins}</td>
				<td>${s.losses}</td>
				<td><span style="color:${s.win_rate >= 50 ? "#10b981" : "#f43f5e"};font-weight:700">${s.win_rate}%</span></td>
				<td style="color:#10b981">${format_currency(s.avg_win)}</td>
				<td style="color:#f43f5e">${format_currency(s.avg_loss)}</td>
				<td style="color:${s.expectancy >= 0 ? "#10b981" : "#f43f5e"};font-weight:800">${format_currency(s.expectancy)}</td>
				<td style="color:${s.pnl >= 0 ? "#10b981" : "#f43f5e"};font-weight:800">${format_currency(s.pnl)}</td>
			</tr>
		`).join("");
		this.page.main.find(".tj-setup-table").html(`
			<table>
				<thead><tr>
					<th>Setup</th><th>Trades</th><th>Wins</th><th>Losses</th><th>Win%</th>
					<th>Avg Win</th><th>Avg Loss</th><th>Expectancy</th><th>Total P&L</th>
				</tr></thead>
				<tbody>${rows}</tbody>
			</table>
		`);
	}

	_render_drawdown_chart(curve) {
		const container = this.page.main.find(".tj-dd-chart")[0];
		if (!container || !curve || !curve.length) return;
		const fmtDate = (iso) => {
			const [, m, d] = iso.split("-");
			const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
			return `${parseInt(d)} ${months[parseInt(m) - 1]}`;
		};
		new frappe.Chart(container, {
			type: "line",
			data: {
				labels: curve.map(p => fmtDate(p.date)),
				datasets: [{ name: "Drawdown", values: curve.map(p => p.value), chartType: "line" }],
			},
			colors: ["#f43f5e"],
			height: 200,
			axisOptions: { xIsSeries: 1, xAxisMode: "tick" },
			lineOptions: { regionFill: 1, hideDots: curve.length > 30 ? 1 : 0 },
			tooltipOptions: { formatTooltipY: d => format_currency(d) },
		});
	}

	_render_r_chart(histogram, avgR) {
		const container = this.page.main.find(".tj-r-chart")[0];
		if (!container || !histogram || !histogram.length) return;
		new frappe.Chart(container, {
			type: "bar",
			data: {
				labels: histogram.map(b => b.bucket),
				datasets: [{ name: "Trades", values: histogram.map(b => b.count) }],
			},
			colors: ["#8b5cf6"],
			height: 200,
			axisOptions: { xAxisMode: "tick" },
			tooltipOptions: { formatTooltipY: d => d + " trades" },
		});
		$(container).append(`<div style="text-align:center;font-size:11px;color:var(--tj-muted);margin-top:4px">Average R-Multiple: <b style="color:${avgR >= 0 ? '#10b981' : '#f43f5e'}">${avgR}R</b></div>`);
	}

	_render_dow_heatmap(stats) {
		const container = this.page.main.find(".tj-dow-heatmap");
		if (!stats || !stats.length) return;
		const maxAbs = Math.max(1, ...stats.map(s => Math.abs(s.pnl)));
		const rows = stats.map(s => {
			const intensity = s.total ? Math.min(1, Math.abs(s.pnl) / maxAbs) : 0;
			const base = s.pnl >= 0 ? "16,185,129" : "244,63,94";
			const bg = s.total ? `rgba(${base},${0.08 + intensity * 0.52})` : "#f4f5fa";
			const textColor = intensity > 0.5 ? "#fff" : "var(--tj-text)";
			return `
				<div class="tj-dow-cell" style="background:${bg};color:${textColor}">
					<div class="tj-dow-day">${s.day}</div>
					<div class="tj-dow-pnl">${s.total ? format_currency(s.pnl) : "—"}</div>
					<div class="tj-dow-meta">${s.total ? s.total + " trades • " + s.win_rate + "% win" : "No trades"}</div>
				</div>
			`;
		}).join("");
		container.html(`<div class="tj-dow-grid">${rows}</div>`);
	}

	_render_best_worst(bestWeek, worstWeek, bestMonth, worstMonth) {
		const render = ($el, t, kind, period) => {
			if (!t) { $el.html(`<div class="tj-empty">No trades this ${period}</div>`); return; }
			const color = kind === "best" ? "#10b981" : "#f43f5e";
			$el.html(`
				<div class="tj-bw">
					<div class="tj-bw-head">
						<a href="/app/trade/${t.name}" class="tj-bw-symbol">${t.symbol}</a>
						<span class="badge-${(t.status || "open").toLowerCase()}">${t.status}</span>
					</div>
					<div class="tj-bw-pnl" style="color:${color}">${format_currency(t.pnl)}</div>
					<div class="tj-bw-meta">
						<span>${t.date}</span>
						${t.setup ? `<span>•</span><span>${t.setup}</span>` : ""}
						${t.rr ? `<span>•</span><span>R:R ${t.rr.toFixed(2)}x</span>` : ""}
					</div>
				</div>
			`);
		};
		render(this.page.main.find(".tj-best-trade-week"), bestWeek, "best", "week");
		render(this.page.main.find(".tj-worst-trade-week"), worstWeek, "worst", "week");
		render(this.page.main.find(".tj-best-trade-month"), bestMonth, "best", "month");
		render(this.page.main.find(".tj-worst-trade-month"), worstMonth, "worst", "month");
	}

	_render_calendar(days) {
		const container = this.page.main.find(".tj-calendar");
		if (!days || !days.length) { container.html('<div class="tj-empty">No data</div>'); return; }

		// Group by month
		const months = {};
		days.forEach(d => {
			const key = d.date.substring(0, 7); // YYYY-MM
			if (!months[key]) months[key] = [];
			months[key].push(d);
		});

		const maxAbs = Math.max(1, ...days.map(d => Math.abs(d.pnl)));
		const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
		const dowLabels = ["M", "T", "W", "T", "F", "S", "S"];

		const monthsHtml = Object.keys(months).sort().map(key => {
			const [y, m] = key.split("-").map(Number);
			const monthDays = months[key];
			// Pad start so Monday starts column 0
			const firstDow = monthDays[0].dow;
			const pad = Array(firstDow).fill(null);
			const cells = [...pad, ...monthDays];
			const cellsHtml = cells.map(d => {
				if (!d) return `<div class="tj-cal-cell tj-cal-empty"></div>`;
				if (!d.has_trade) return `<div class="tj-cal-cell tj-cal-none" title="${d.date}: No trades"></div>`;
				const intensity = Math.min(1, Math.abs(d.pnl) / maxAbs);
				const base = d.pnl >= 0 ? "16,185,129" : "244,63,94";
				const bg = `rgba(${base},${0.18 + intensity * 0.62})`;
				return `<div class="tj-cal-cell tj-cal-trade" style="background:${bg}" title="${d.date}: ${format_currency(d.pnl)}"></div>`;
			}).join("");
			return `
				<div class="tj-cal-month">
					<div class="tj-cal-month-title">${monthNames[m - 1]} ${y}</div>
					<div class="tj-cal-dow">${dowLabels.map(l => `<span>${l}</span>`).join("")}</div>
					<div class="tj-cal-grid">${cellsHtml}</div>
				</div>
			`;
		}).join("");

		container.html(`
			<div class="tj-cal-wrap">${monthsHtml}</div>
			<div class="tj-cal-legend">
				<span>Less</span>
				<span class="tj-cal-cell" style="background:rgba(244,63,94,.7)"></span>
				<span class="tj-cal-cell" style="background:rgba(244,63,94,.35)"></span>
				<span class="tj-cal-cell tj-cal-none"></span>
				<span class="tj-cal-cell" style="background:rgba(16,185,129,.35)"></span>
				<span class="tj-cal-cell" style="background:rgba(16,185,129,.7)"></span>
				<span>More</span>
			</div>
		`);
	}

	_render_trade_table(trades) {
		if (!trades || !trades.length) return;
		const header = `<div class="tj-trade-row tj-trade-header">
			<span>Symbol</span><span>Date</span><span>Type</span>
			<span>Entry</span><span>SL</span><span>Target</span><span>Exit</span><span>R:R</span><span>P&L</span>
		</div>`;
		const rows = trades.map(t => {
			const rr = t.rr ? t.rr.toFixed(2) + "x" : "-";
			const rrColor = t.rr >= 1.5 ? "#10b981" : (t.rr >= 1 ? "#f59e0b" : "#f43f5e");
			return `
			<div class="tj-trade-row">
				<span><a href="/app/trade/${t.name}" style="font-weight:700">${t.symbol}</a></span>
				<span style="color:var(--tj-muted)">${t.date}</span>
				<span>${t.type}</span>
				<span style="font-weight:600">${t.entry || "-"}</span>
				<span style="color:#f43f5e;font-weight:600">${t.sl || "-"}</span>
				<span style="color:#10b981;font-weight:600">${t.target || "-"}</span>
				<span style="font-weight:600">${t.exit || "-"}</span>
				<span style="font-weight:700;color:${t.rr ? rrColor : "var(--tj-muted)"}">${rr}</span>
				<span style="font-weight:800;color:${t.pnl >= 0 ? "#10b981" : "#f43f5e"}">${format_currency(t.pnl)}</span>
			</div>
		`;
		}).join("");
		this.page.main.find(".tj-trade-table").html(header + rows);
	}
}
