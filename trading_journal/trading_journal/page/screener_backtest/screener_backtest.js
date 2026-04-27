frappe.pages["screener-backtest"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Screener Backtest — Historical Hit Rate",
		single_column: true,
	});
	new ScreenerBacktestPage(page);
};

class ScreenerBacktestPage {
	constructor(page) {
		this.page = page;
		this.months = 12;
		this.sample_size = 100;
		this._inject_styles();
		this._render_skeleton();
		this._bind();
		this._load_cached();
	}

	_inject_styles() {
		if (document.getElementById("tj-bt-css")) return;
		const css = `
		.tj-bt-wrap { padding: 14px; }
		.tj-bt-hero {
			background: linear-gradient(135deg, #0f766e, #0ea5e9);
			border-radius: 12px; padding: 16px 20px; color: #fff;
			display: flex; justify-content: space-between; align-items: center;
			gap: 14px; flex-wrap: wrap; margin-bottom: 16px;
		}
		.tj-bt-hero h2 { margin: 0; font-size: 19px; font-weight: 800; }
		.tj-bt-hero .sub { font-size: 12px; opacity: 0.85; margin-top: 3px; }
		.tj-bt-btn {
			background: #fff; color: #0f766e; font-weight: 700;
			padding: 8px 16px; border-radius: 8px; border: 0; cursor: pointer;
			font-size: 13px;
		}
		.tj-bt-btn:disabled { opacity: 0.6; }
		.tj-bt-controls {
			display: flex; gap: 12px; flex-wrap: wrap; align-items: end;
			background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 14px; margin-bottom: 12px;
		}
		.tj-bt-controls label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #64748b; display: block; margin-bottom: 3px; }
		.tj-bt-controls select { border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px 10px; font-size: 12px; min-width: 140px; }

		.tj-bt-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
		.tj-bt-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; }
		.tj-bt-card h3 { margin: 0 0 4px 0; font-size: 14px; font-weight: 800; color: #0f172a; }
		.tj-bt-card .sub { font-size: 11px; color: #64748b; margin-bottom: 12px; }
		.tj-bt-card .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
		.tj-bt-card .stat { background: #f8fafc; padding: 8px 10px; border-radius: 6px; }
		.tj-bt-card .stat .lbl { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; }
		.tj-bt-card .stat .val { font-size: 18px; font-weight: 800; margin-top: 2px; }
		.tj-bt-card .stat.win .val { color: #10b981; }
		.tj-bt-card .stat.loss .val { color: #f43f5e; }

		.tj-bt-timeline { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
		.tj-bt-timeline .head { padding: 10px 16px; background: #f1f5f9; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; }
		.tj-bt-tl-row { display: grid; grid-template-columns: 110px repeat(3, 1fr); gap: 12px; padding: 10px 16px; border-bottom: 1px solid #f1f5f9; align-items: center; font-size: 13px; }
		.tj-bt-tl-row:last-child { border-bottom: 0; }
		.tj-bt-tl-row .date { font-weight: 700; color: #0f172a; }
		.tj-bt-tl-row .scan-cell { background: #f8fafc; padding: 6px 10px; border-radius: 6px; font-size: 12px; }
		.tj-bt-tl-row .scan-cell .hits { font-weight: 700; color: #0f172a; }
		.tj-bt-tl-row .scan-cell .syms { color: #64748b; font-size: 11px; }
		.tj-bt-empty { padding: 50px; text-align: center; color: #94a3b8; }
		`;
		const s = document.createElement("style");
		s.id = "tj-bt-css";
		s.textContent = css;
		document.head.appendChild(s);
	}

	_render_skeleton() {
		$(this.page.body).empty().append(`
			<div class="tj-bt-wrap">
				<div class="tj-bt-hero">
					<div>
						<h2>Screener Backtest</h2>
						<div class="sub">Replays each scan on monthly snapshots over the last N months. Forward 30/90-day returns measure how the hits performed.</div>
					</div>
					<div>
						<button class="tj-bt-btn" id="tj-bt-run">▶ Run Backtest</button>
					</div>
				</div>
				<div class="tj-bt-controls">
					<div>
						<label>Lookback</label>
						<select id="tj-bt-months">
							<option value="6">6 months</option>
							<option value="12" selected>12 months</option>
							<option value="18">18 months</option>
						</select>
					</div>
					<div>
						<label>Sample Size</label>
						<select id="tj-bt-sample">
							<option value="50">50 (~1 min)</option>
							<option value="100" selected>100 (~3 min)</option>
							<option value="200">200 (~6 min)</option>
							<option value="500">500 full universe (~12 min)</option>
						</select>
					</div>
				</div>
				<div id="tj-bt-body"><div class="tj-bt-empty">Click <b>Run Backtest</b> to start.</div></div>
			</div>
		`);
	}

	_bind() {
		const $b = $(this.page.body);
		$b.find("#tj-bt-run").on("click", () => this._run());
		$b.find("#tj-bt-months").on("change", (e) => { this.months = parseInt(e.target.value, 10); this._load_cached(); });
		$b.find("#tj-bt-sample").on("change", (e) => { this.sample_size = parseInt(e.target.value, 10); this._load_cached(); });
	}

	_load_cached() {
		frappe.call({
			method: "trading_journal.trading_journal.utils.backtest.get_cached_backtest",
			args: { months: this.months, sample_size: this.sample_size },
			callback: (r) => {
				const m = r.message || {};
				if (m.per_scan) {
					this._render(m);
				}
			},
		});
	}

	_run() {
		const $btn = $(this.page.body).find("#tj-bt-run");
		const sampleLabels = {50: "1", 100: "3", 200: "6", 500: "12"};
		$btn.prop("disabled", true).text(`Running… (~${sampleLabels[this.sample_size] || "3"} min)`);
		$(this.page.body).find("#tj-bt-body").html(`<div class="tj-bt-empty">Running backtest…<br><br>Fetching ${this.sample_size} symbols × 2 years of history × ${this.months} test dates. Please wait.</div>`);
		frappe.call({
			method: "trading_journal.trading_journal.utils.backtest.run_backtest",
			args: { months: this.months, sample_size: this.sample_size, force: 1 },
			freeze: false,
			callback: (r) => {
				$btn.prop("disabled", false).text("▶ Run Backtest");
				this._render(r.message || {});
			},
			error: () => $btn.prop("disabled", false).text("▶ Run Backtest"),
		});
	}

	_render(m) {
		if (!m.per_scan) {
			$(this.page.body).find("#tj-bt-body").html(`<div class="tj-bt-empty">No backtest yet for ${this.months}m × ${this.sample_size} sample.</div>`);
			return;
		}
		const order = ["Trend Template", "VCP", "Tight Consolidation"];
		const colors = {"Trend Template": "#6366f1", "VCP": "#0ea5e9", "Tight Consolidation": "#f59e0b"};

		const cards = order.map((st) => {
			const s = m.per_scan[st] || {};
			const winColor30 = (s.win_rate_30d || 0) >= 60 ? "win" : "";
			const winColor90 = (s.win_rate_90d || 0) >= 60 ? "win" : "";
			const avgClass30 = (s.avg_30d || 0) >= 0 ? "win" : "loss";
			const avgClass90 = (s.avg_90d || 0) >= 0 ? "win" : "loss";
			return `
				<div class="tj-bt-card">
					<h3 style="color:${colors[st]};">${st}</h3>
					<div class="sub">${s.total_hits || 0} hits across ${s.hit_dates || 0} test dates</div>
					<div class="row">
						<div class="stat ${winColor30}"><div class="lbl">30d Win Rate</div><div class="val">${(s.win_rate_30d || 0).toFixed(1)}%</div></div>
						<div class="stat ${winColor90}"><div class="lbl">90d Win Rate</div><div class="val">${(s.win_rate_90d || 0).toFixed(1)}%</div></div>
						<div class="stat ${avgClass30}"><div class="lbl">Avg 30d</div><div class="val">${(s.avg_30d || 0) >= 0 ? "+" : ""}${(s.avg_30d || 0).toFixed(2)}%</div></div>
						<div class="stat ${avgClass90}"><div class="lbl">Avg 90d</div><div class="val">${(s.avg_90d || 0) >= 0 ? "+" : ""}${(s.avg_90d || 0).toFixed(2)}%</div></div>
						<div class="stat"><div class="lbl">Best 90d</div><div class="val" style="color:#10b981;">${s.max_90d != null ? "+" + s.max_90d.toFixed(1) + "%" : "—"}</div></div>
						<div class="stat"><div class="lbl">Worst 90d</div><div class="val" style="color:#f43f5e;">${s.min_90d != null ? s.min_90d.toFixed(1) + "%" : "—"}</div></div>
					</div>
				</div>
			`;
		}).join("");

		const tlRows = (m.timeline || []).map((d) => {
			const cells = order.map((st) => {
				const sc = (d.scans && d.scans[st]) || {};
				const top = (sc.top_3 || []).map((t) => t.symbol).join(", ");
				return `<div class="scan-cell"><div class="hits">${sc.hits || 0} hits</div>${top ? `<div class="syms">${top}</div>` : ""}</div>`;
			}).join("");
			return `<div class="tj-bt-tl-row"><div class="date">${frappe.datetime.str_to_user(d.date)}</div>${cells}</div>`;
		}).join("");

		$(this.page.body).find("#tj-bt-body").html(`
			<div class="tj-bt-cards">${cards}</div>
			<div class="tj-bt-timeline">
				<div class="head">Hits Per Test Date · ${m.test_dates ? m.test_dates.length : 0} dates · sample of ${m.sample_size} symbols</div>
				${tlRows}
			</div>
		`);
	}
}
