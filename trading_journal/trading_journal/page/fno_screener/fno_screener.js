frappe.pages["fno-screener"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "F&O Momentum — NSE Derivatives Universe",
		single_column: true,
	});
	new FnOScreenerPage(page);
};

class FnOScreenerPage {
	constructor(page) {
		this.page = page;
		this.run_name = null;
		this.poll_timer = null;
		this.min_ret = "";
		this.min_rs = "";
		this.search = "";
		this.sector = "";
		this._inject_styles();
		this._render_skeleton();
		this._bind_controls();
		this._load_latest();
	}

	_inject_styles() {
		if (document.getElementById("tj-fno-css")) return;
		const css = `
		.tj-fno-wrap { padding: 14px; }
		.tj-fno-hero {
			background: linear-gradient(135deg, #0ea5e9, #6366f1);
			border-radius: 12px; padding: 18px 22px; color: #fff;
			margin-bottom: 16px; display: flex; justify-content: space-between;
			align-items: center; flex-wrap: wrap; gap: 14px;
		}
		.tj-fno-hero h2 { margin: 0; font-size: 20px; font-weight: 800; }
		.tj-fno-hero .sub { font-size: 12px; opacity: 0.9; margin-top: 4px; }
		.tj-fno-hero .btn-scan {
			background: #fff; color: #0c4a6e; font-weight: 700;
			padding: 9px 18px; border-radius: 8px; border: 0; cursor: pointer;
			font-size: 13px;
		}
		.tj-fno-hero .btn-scan:disabled { opacity: 0.6; cursor: not-allowed; }

		.tj-fno-status {
			background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 14px; font-size: 13px;
			display: flex; gap: 16px; flex-wrap: wrap; align-items: center;
		}
		.tj-fno-status .pill {
			display: inline-block; padding: 3px 10px; border-radius: 999px;
			font-size: 11px; font-weight: 700; text-transform: uppercase;
			letter-spacing: 0.5px;
		}
		.tj-fno-status .pill.queued { background: #fef3c7; color: #92400e; }
		.tj-fno-status .pill.running { background: #dbeafe; color: #1e40af; }
		.tj-fno-status .pill.completed { background: #d1fae5; color: #065f46; }
		.tj-fno-status .pill.failed { background: #fee2e2; color: #991b1b; }
		.tj-fno-status .tj-msg { color: #64748b; flex: 1; background: transparent !important; height: auto !important; overflow: visible !important; display: block !important; }
		.tj-fno-status .err { color: #991b1b; font-family: monospace; font-size: 11px; white-space: pre-wrap; max-height: 140px; overflow: auto; }

		.tj-fno-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
		.tj-fno-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
		.tj-fno-card .lbl { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
		.tj-fno-card .val { font-size: 22px; font-weight: 800; margin-top: 4px; color: #0f172a; }

		.tj-fno-filters {
			display: flex; gap: 14px; flex-wrap: wrap; align-items: end;
			background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 12px;
		}
		.tj-fno-filters label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; display: block; margin-bottom: 4px; }
		.tj-fno-filters input, .tj-fno-filters select {
			border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; font-size: 13px;
			min-width: 140px; background: #fff;
		}

		.tj-fno-table-wrap { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
		.tj-fno-table { width: 100%; border-collapse: collapse; font-size: 13px; }
		.tj-fno-table th {
			background: #f1f5f9; font-size: 10px; font-weight: 700;
			text-transform: uppercase; letter-spacing: 0.5px; color: #475569;
			padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0;
			white-space: nowrap;
		}
		.tj-fno-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #0f172a; }
		.tj-fno-table tr:hover td { background: #f8fafc; }
		.tj-fno-table .sym { font-weight: 700; color: #0ea5e9; }
		.tj-fno-table .sym a { color: inherit; text-decoration: none; }
		.tj-fno-table .num { font-variant-numeric: tabular-nums; text-align: right; }
		.tj-fno-table .pos { color: #10b981; font-weight: 700; }
		.tj-fno-table .neg { color: #f43f5e; font-weight: 700; }
		.tj-fno-table .badge {
			display: inline-block; padding: 2px 8px; border-radius: 999px;
			font-size: 11px; font-weight: 700;
		}
		.tj-fno-table .badge.strong { background: #d1fae5; color: #065f46; }
		.tj-fno-table .badge.medium { background: #dbeafe; color: #1e40af; }
		.tj-fno-table .actions a {
			color: #0ea5e9; text-decoration: none; font-weight: 600;
			margin-right: 8px; font-size: 12px;
		}
		.tj-fno-table .actions a:hover { text-decoration: underline; }
		.tj-fno-empty { padding: 40px; text-align: center; color: #94a3b8; }
		`;
		const s = document.createElement("style");
		s.id = "tj-fno-css";
		s.textContent = css;
		document.head.appendChild(s);
	}

	_render_skeleton() {
		$(this.page.body).empty().append(`
			<div class="tj-fno-wrap">
				<div class="tj-fno-hero">
					<div>
						<h2>📈 F&amp;O Momentum — Derivatives Universe</h2>
						<div class="sub">NSE F&amp;O-eligible stocks in a clean uptrend with sustained momentum. Liquid by definition — fine for long futures or call-side option spreads. (Universe filtered against our bundled F&amp;O list; cross-checked with the Nifty 500 snapshot.)</div>
					</div>
					<div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
						<span id="tj-fno-snap-info" style="color:rgba(255,255,255,0.85); font-size:11px;"></span>
						<button class="btn-scan" id="tj-fno-snap-refresh" style="background:rgba(255,255,255,0.15); color:#fff; border:1px solid rgba(255,255,255,0.4);">↻ Refresh Snapshot</button>
						<button class="btn-scan" id="tj-fno-run-all" style="background:#10b981;color:#fff;">Run All 9 Scans</button>
						<button class="btn-scan" id="tj-fno-run">Run This Scan</button>
					</div>
				</div>
				<div class="tj-fno-status" id="tj-fno-status" style="display: none;"></div>
				<div class="tj-fno-summary" id="tj-fno-summary"></div>
				<div class="tj-fno-filters">
					<div>
						<label>Min 3-Month Return</label>
						<select id="tj-fno-min-ret">
							<option value="" selected>All (no filter)</option>
							<option value="5">≥ 5%</option>
							<option value="10">≥ 10%</option>
							<option value="20">≥ 20% (strong trend)</option>
							<option value="40">≥ 40% (leader)</option>
						</select>
					</div>
					<div>
						<label>Min RS Rating</label>
						<select id="tj-fno-min-rs">
							<option value="" selected>All (no filter)</option>
							<option value="60">≥ 60</option>
							<option value="70">≥ 70 (Minervini bar)</option>
							<option value="80">≥ 80</option>
							<option value="90">≥ 90 (elite)</option>
						</select>
					</div>
					<div>
						<label>Sector</label>
						<select id="tj-fno-sector"><option value="">All Sectors</option></select>
					</div>
					<div>
						<label>Search Symbol</label>
						<input type="text" id="tj-fno-search" placeholder="e.g. RELIANCE">
					</div>
				</div>
				<div class="tj-fno-table-wrap">
					<table class="tj-fno-table" id="tj-fno-table">
						<thead>
							<tr>
								<th>#</th>
								<th>Symbol</th>
								<th>Company</th>
								<th>Sector</th>
								<th class="num">Price ₹</th>
								<th class="num">RS</th>
								<th class="num">3M Return</th>
								<th class="num">From 52w High</th>
								<th class="num">Vol Ratio 10/20</th>
								<th class="num">Trend</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody id="tj-fno-tbody">
							<tr><td colspan="11" class="tj-fno-empty">Loading…</td></tr>
						</tbody>
					</table>
				</div>
			</div>
		`);
	}

	_bind_controls() {
		const $b = $(this.page.body);
		$b.find("#tj-fno-run").on("click", () => this._start_scan());
		$b.find("#tj-fno-run-all").on("click", () => this._start_all_scans());
		$b.find("#tj-fno-snap-refresh").on("click", () => this._refresh_snapshot());
		$b.find("#tj-fno-min-ret").on("change", (e) => {
			this.min_ret = e.target.value === "" ? "" : parseFloat(e.target.value);
			this._render_results();
		});
		$b.find("#tj-fno-min-rs").on("change", (e) => {
			this.min_rs = e.target.value === "" ? "" : parseFloat(e.target.value);
			this._render_results();
		});
		$b.find("#tj-fno-search").on("input", (e) => {
			this.search = (e.target.value || "").trim().toUpperCase();
			this._render_results();
		});
		$b.find("#tj-fno-sector").on("change", (e) => {
			this.sector = e.target.value || "";
			this._render_results();
		});
		this._update_snap_info();
	}

	_update_snap_info() {
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.snapshot_status",
			callback: (r) => {
				const m = r.message || {};
				const $info = $(this.page.body).find("#tj-fno-snap-info");
				$info.text(m.latest_snapshot_date ? "Snapshot: " + m.latest_snapshot_date : "No snapshot yet");
				if ((m.refresh || {}).running) {
					$info.text("Refreshing snapshot…");
					setTimeout(() => this._update_snap_info(), 4000);
				}
			},
		});
	}

	_refresh_snapshot() {
		const $btn = $(this.page.body).find("#tj-fno-snap-refresh");
		$btn.prop("disabled", true).text("Refreshing…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.refresh_snapshot_now",
			args: { force: 1 },
			callback: () => {
				frappe.show_alert({message: "Snapshot refresh queued.", indicator: "blue"}, 4);
				$btn.prop("disabled", false).text("↻ Refresh Snapshot");
				this._update_snap_info();
			},
			error: () => $btn.prop("disabled", false).text("↻ Refresh Snapshot"),
		});
	}

	_load_latest() {
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.latest_run",
			args: { scan_type: "FnO Momentum" },
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok || !m.name) {
					this._render_empty("No completed F&O Momentum scan yet. Click \"Run This Scan\".");
					return;
				}
				this.run_name = m.name;
				this._absorb_status(m);
			},
		});
	}

	_start_scan() {
		const $body = $(this.page.body);
		$body.find("#tj-fno-run").prop("disabled", true).text("Queued…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.start_scan",
			args: { scan_type: "FnO Momentum" },
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok) {
					frappe.msgprint({ title: "Error", message: m.error || "Failed", indicator: "red" });
					$body.find("#tj-fno-run").prop("disabled", false).text("Run This Scan");
					return;
				}
				this.run_name = m.run_name;
				this._poll_status();
			},
			error: () => $body.find("#tj-fno-run").prop("disabled", false).text("Run This Scan"),
		});
	}

	_start_all_scans() {
		const $body = $(this.page.body);
		const $btnAll = $body.find("#tj-fno-run-all");
		$btnAll.prop("disabled", true).text("Queued…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.start_all_scans",
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok) {
					frappe.msgprint({ title: "Error", message: m.error || "Failed", indicator: "red" });
					$btnAll.prop("disabled", false).text("Run All 9 Scans");
					return;
				}
				const my = (m.run_names || {})["FnO Momentum"];
				if (my) this.run_name = my;
				frappe.show_alert({message: "Started all 7 scans.", indicator: "green"}, 5);
				this._poll_status();
			},
			error: () => $btnAll.prop("disabled", false).text("Run All 9 Scans"),
		});
	}

	_poll_status() {
		if (this.poll_timer) clearTimeout(this.poll_timer);
		const tick = () => {
			frappe.call({
				method: "trading_journal.trading_journal.utils.screener.get_run_status",
				args: { run_name: this.run_name },
				callback: (r) => {
					const m = r.message || {};
					this._absorb_status(m);
					if (["Queued", "Running"].includes(m.status)) {
						this.poll_timer = setTimeout(tick, 3000);
					} else {
						const $b = $(this.page.body);
						$b.find("#tj-fno-run").prop("disabled", false).text("Run This Scan");
						$b.find("#tj-fno-run-all").prop("disabled", false).text("Run All 9 Scans");
					}
				},
			});
		};
		tick();
	}

	_absorb_status(m) {
		this.last_status = m;
		const $b = $(this.page.body);
		const $st = $b.find("#tj-fno-status");
		$st.show();
		const cls = (m.status || "").toLowerCase();
		const errBlock = m.error
			? `<div class="err">${frappe.utils.escape_html(m.error).slice(0, 1500)}</div>`
			: "";
		$st.html(`
			<span class="pill ${cls}">${m.status || "—"}</span>
			<div class="tj-msg">${frappe.utils.escape_html(m.progress || "")}</div>
			<div>F&O universe: <b>${m.total_scanned || 0}</b> · Passing: <b>${m.passed_count || 0}</b></div>
			${m.completed_at ? `<div style="font-size:11px; color:#94a3b8;">Last scan: ${frappe.datetime.str_to_user(m.completed_at)}</div>` : ""}
			${errBlock}
		`);
		this.results = m.results || [];
		this._render_summary();
		this._render_results();
	}

	_render_empty(msg) {
		$(this.page.body).find("#tj-fno-tbody").html(
			`<tr><td colspan="11" class="tj-fno-empty">${frappe.utils.escape_html(msg)}</td></tr>`
		);
		$(this.page.body).find("#tj-fno-summary").empty();
	}

	_fno_for(r) {
		try { return JSON.parse(r.criteria_json || "{}").fno_momentum || {}; } catch (e) { return {}; }
	}

	_render_summary() {
		const all = this.results || [];
		const elite = all.filter((r) => (r.rs_rating || 0) >= 90).length;
		const strong = all.filter((r) => (r.rs_rating || 0) >= 70).length;
		const avgRet = all.length
			? (all.reduce((s, r) => s + (r.vcp_tightness || 0), 0) / all.length).toFixed(1)
			: "—";
		$(this.page.body).find("#tj-fno-summary").html(`
			<div class="tj-fno-card"><div class="lbl">Total Candidates</div><div class="val">${all.length}</div></div>
			<div class="tj-fno-card"><div class="lbl">RS ≥ 90 (Elite)</div><div class="val">${elite}</div></div>
			<div class="tj-fno-card"><div class="lbl">RS ≥ 70 (Strong)</div><div class="val">${strong}</div></div>
			<div class="tj-fno-card"><div class="lbl">Avg 3M Return</div><div class="val">${avgRet}%</div></div>
		`);
	}

	_industry_for(r) {
		if (r.industry) return r.industry;
		try { return JSON.parse(r.criteria_json || "{}").industry || ""; } catch (e) { return ""; }
	}

	_populate_sector_dropdown() {
		const $sel = $(this.page.body).find("#tj-fno-sector");
		const inds = Array.from(new Set((this.results || []).map((r) => this._industry_for(r)).filter(Boolean))).sort();
		const cur = $sel.val();
		$sel.empty().append('<option value="">All Sectors</option>');
		inds.forEach((s) => $sel.append(`<option value="${frappe.utils.escape_html(s)}">${frappe.utils.escape_html(s)}</option>`));
		if (cur && inds.includes(cur)) $sel.val(cur);
	}

	_render_results() {
		this._populate_sector_dropdown();
		const $tbody = $(this.page.body).find("#tj-fno-tbody");
		const filtered = (this.results || []).filter((r) => {
			if (this.min_ret !== "" && (r.vcp_tightness || 0) < this.min_ret) return false;
			if (this.min_rs !== "" && (r.rs_rating || 0) < this.min_rs) return false;
			if (this.search && !(r.symbol || "").toUpperCase().includes(this.search)) return false;
			if (this.sector && this._industry_for(r) !== this.sector) return false;
			return true;
		});
		if (!filtered.length) {
			$tbody.html(`<tr><td colspan="11" class="tj-fno-empty">No symbols match the current filters.</td></tr>`);
			return;
		}
		const rows = filtered.map((r, i) => {
			const fm = this._fno_for(r);
			const ret = r.vcp_tightness || 0;
			const rs = r.rs_rating || 0;
			const cls = rs >= 80 ? "strong" : "medium";
			const sym = r.symbol;
			const ind = this._industry_for(r);
			const trendPassed = (() => {
				try { return JSON.parse(r.criteria_json || "{}").trend_template_passed || 0; } catch (e) { return 0; }
			})();
			return `
				<tr data-symbol="${sym}">
					<td>${i + 1}</td>
					<td class="sym"><a href="/app/stock-symbol/${sym}" target="_blank">${sym}</a></td>
					<td>${frappe.utils.escape_html(r.company_name || "")}</td>
					<td style="font-size:11px; color:#64748b;">${frappe.utils.escape_html(ind || "—")}</td>
					<td class="num">${frappe.format(r.current_price || 0, { fieldtype: "Currency", options: "INR" })}</td>
					<td class="num"><span class="badge ${cls}">${rs.toFixed(1)}</span></td>
					<td class="num pos">+${ret.toFixed(2)}%</td>
					<td class="num neg">${(r.pct_from_52w_high || 0).toFixed(2)}%</td>
					<td class="num">${(fm.vol_ratio_10_20 || 0).toFixed(2)}×</td>
					<td class="num">${trendPassed}/8</td>
					<td class="actions">
						<a href="#" class="tj-watch" data-symbol="${sym}" data-company="${frappe.utils.escape_html(r.company_name || '')}" data-pivot="${r.current_price || ''}">+ Watch</a>
						<a href="/app/stock-symbol/${sym}" target="_blank">Open</a>
						<a href="https://www.tradingview.com/chart/?symbol=NSE:${sym}" target="_blank" class="tj-chart-hover" data-symbol="${sym}" data-exchange="NSE">Chart</a>
					</td>
				</tr>
			`;
		}).join("");
		$tbody.html(rows);
		$tbody.find(".tj-watch").on("click", (e) => {
			e.preventDefault();
			const ds = e.currentTarget.dataset;
			frappe.call({
				method: "trading_journal.trading_journal.utils.watchlist.add_to_watchlist",
				args: {
					symbol: ds.symbol,
					company_name: ds.company,
					exchange: "NSE",
					pivot_price: parseFloat(ds.pivot) || null,
					scan_source: "FnO Momentum",
				},
				callback: (r) => {
					const m = r.message || {};
					frappe.show_alert({
						message: !m.ok ? (m.error || "Failed") : (m.existed ? `${ds.symbol} already on watchlist` : `${ds.symbol} added to watchlist`),
						indicator: m.ok ? "green" : "red",
					}, 4);
				},
			});
		});
	}
}
