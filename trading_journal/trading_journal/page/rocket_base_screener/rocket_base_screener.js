frappe.pages["rocket-base-screener"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Rocket Base — Power Play / High Tight Flag",
		single_column: true,
	});
	new RocketBaseScreenerPage(page);
};

class RocketBaseScreenerPage {
	constructor(page) {
		this.page = page;
		this.run_name = null;
		this.poll_timer = null;
		this.min_run = "";
		this.max_base = "";
		this.search = "";
		this.sector = "";
		this._inject_styles();
		this._render_skeleton();
		this._bind_controls();
		this._load_latest();
	}

	_inject_styles() {
		if (document.getElementById("tj-rb-css")) return;
		const css = `
		.tj-rb-wrap { padding: 14px; }
		.tj-rb-hero {
			background: linear-gradient(135deg, #dc2626, #f59e0b);
			border-radius: 12px; padding: 18px 22px; color: #fff;
			margin-bottom: 16px; display: flex; justify-content: space-between;
			align-items: center; flex-wrap: wrap; gap: 14px;
		}
		.tj-rb-hero h2 { margin: 0; font-size: 20px; font-weight: 800; }
		.tj-rb-hero .sub { font-size: 12px; opacity: 0.85; margin-top: 4px; }
		.tj-rb-hero .btn-scan {
			background: #fff; color: #7f1d1d; font-weight: 700;
			padding: 9px 18px; border-radius: 8px; border: 0; cursor: pointer;
			font-size: 13px;
		}
		.tj-rb-hero .btn-scan:disabled { opacity: 0.6; cursor: not-allowed; }

		.tj-rb-status {
			background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 14px; font-size: 13px;
			display: flex; gap: 16px; flex-wrap: wrap; align-items: center;
		}
		.tj-rb-status .pill {
			display: inline-block; padding: 3px 10px; border-radius: 999px;
			font-size: 11px; font-weight: 700; text-transform: uppercase;
			letter-spacing: 0.5px;
		}
		.tj-rb-status .pill.queued { background: #fef3c7; color: #92400e; }
		.tj-rb-status .pill.running { background: #dbeafe; color: #1e40af; }
		.tj-rb-status .pill.completed { background: #d1fae5; color: #065f46; }
		.tj-rb-status .pill.failed { background: #fee2e2; color: #991b1b; }
		.tj-rb-status .tj-msg { color: #64748b; flex: 1; background: transparent !important; height: auto !important; overflow: visible !important; display: block !important; }
		.tj-rb-status .err { color: #991b1b; font-family: monospace; font-size: 11px; white-space: pre-wrap; max-height: 140px; overflow: auto; }

		.tj-rb-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
		.tj-rb-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
		.tj-rb-card .lbl { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
		.tj-rb-card .val { font-size: 22px; font-weight: 800; margin-top: 4px; color: #0f172a; }

		.tj-rb-filters {
			display: flex; gap: 14px; flex-wrap: wrap; align-items: end;
			background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 12px;
		}
		.tj-rb-filters label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; display: block; margin-bottom: 4px; }
		.tj-rb-filters input, .tj-rb-filters select {
			border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; font-size: 13px;
			min-width: 140px; background: #fff;
		}

		.tj-rb-table-wrap { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
		.tj-rb-table { width: 100%; border-collapse: collapse; font-size: 13px; }
		.tj-rb-table th {
			background: #f1f5f9; font-size: 10px; font-weight: 700;
			text-transform: uppercase; letter-spacing: 0.5px; color: #475569;
			padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0;
			white-space: nowrap;
		}
		.tj-rb-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #0f172a; }
		.tj-rb-table tr:hover td { background: #f8fafc; }
		.tj-rb-table .sym { font-weight: 700; color: #dc2626; }
		.tj-rb-table .sym a { color: inherit; text-decoration: none; }
		.tj-rb-table .num { font-variant-numeric: tabular-nums; text-align: right; }
		.tj-rb-table .pos { color: #10b981; font-weight: 700; }
		.tj-rb-table .neg { color: #f43f5e; font-weight: 700; }
		.tj-rb-table .badge {
			display: inline-block; padding: 2px 8px; border-radius: 999px;
			font-size: 11px; font-weight: 700;
		}
		.tj-rb-table .badge.tight { background: #d1fae5; color: #065f46; }
		.tj-rb-table .badge.loose { background: #fef3c7; color: #92400e; }
		.tj-rb-table .badge.run { background: #fee2e2; color: #991b1b; }
		.tj-rb-table .actions a {
			color: #dc2626; text-decoration: none; font-weight: 600;
			margin-right: 8px; font-size: 12px;
		}
		.tj-rb-table .actions a:hover { text-decoration: underline; }
		.tj-rb-empty { padding: 40px; text-align: center; color: #94a3b8; }
		`;
		const s = document.createElement("style");
		s.id = "tj-rb-css";
		s.textContent = css;
		document.head.appendChild(s);
	}

	_render_skeleton() {
		$(this.page.body).empty().append(`
			<div class="tj-rb-wrap">
				<div class="tj-rb-hero">
					<div>
						<h2>🚀 Rocket Base — Power Play</h2>
						<div class="sub">Stocks that rocketed +90% in 8 weeks then based tightly with ≤ 25% pullback. Mark Minervini's High Tight Flag.</div>
					</div>
					<div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
						<span id="tj-rb-snap-info" style="color:rgba(255,255,255,0.85); font-size:11px;"></span>
						<button class="btn-scan" id="tj-rb-snap-refresh" style="background:rgba(255,255,255,0.15); color:#fff; border:1px solid rgba(255,255,255,0.4);">↻ Refresh Snapshot</button>
						<button class="btn-scan" id="tj-rb-run-all" style="background:#10b981;color:#fff;">Run All 7 Scans</button>
						<button class="btn-scan" id="tj-rb-run">Run This Scan</button>
					</div>
				</div>
				<div class="tj-rb-status" id="tj-rb-status" style="display: none;"></div>
				<div class="tj-rb-summary" id="tj-rb-summary"></div>
				<div class="tj-rb-filters">
					<div>
						<label>Min 8-Week Run</label>
						<select id="tj-rb-min-run">
							<option value="" selected>All (no filter)</option>
							<option value="50">≥ 50% (very loose)</option>
							<option value="60">≥ 60% (default)</option>
							<option value="90">≥ 90% (Minervini strict)</option>
							<option value="120">≥ 120% (extreme)</option>
						</select>
					</div>
					<div>
						<label>Max Base Pullback</label>
						<select id="tj-rb-max-base">
							<option value="" selected>All (no filter)</option>
							<option value="15">≤ 15% (very tight)</option>
							<option value="20">≤ 20%</option>
							<option value="25">≤ 25% (Minervini strict)</option>
							<option value="30">≤ 30% (default)</option>
						</select>
					</div>
					<div>
						<label>Sector</label>
						<select id="tj-rb-sector"><option value="">All Sectors</option></select>
					</div>
					<div>
						<label>Search Symbol</label>
						<input type="text" id="tj-rb-search" placeholder="e.g. KIRLOSENG">
					</div>
				</div>
				<div class="tj-rb-table-wrap">
					<table class="tj-rb-table" id="tj-rb-table">
						<thead>
							<tr>
								<th>#</th>
								<th>Symbol</th>
								<th>Company</th>
								<th>Sector</th>
								<th class="num">Price ₹</th>
								<th class="num">8w Run</th>
								<th class="num">Base Depth</th>
								<th class="num">From Peak</th>
								<th class="num">Trend</th>
								<th class="num">RS</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody id="tj-rb-tbody">
							<tr><td colspan="11" class="tj-rb-empty">Loading…</td></tr>
						</tbody>
					</table>
				</div>
			</div>
		`);
	}

	_bind_controls() {
		const $b = $(this.page.body);
		$b.find("#tj-rb-run").on("click", () => this._start_scan());
		$b.find("#tj-rb-run-all").on("click", () => this._start_all_scans());
		$b.find("#tj-rb-snap-refresh").on("click", () => this._refresh_snapshot());
		$b.find("#tj-rb-min-run").on("change", (e) => { this.min_run = e.target.value === "" ? "" : parseFloat(e.target.value); this._render_results(); });
		$b.find("#tj-rb-max-base").on("change", (e) => { this.max_base = e.target.value === "" ? "" : parseFloat(e.target.value); this._render_results(); });
		$b.find("#tj-rb-search").on("input", (e) => { this.search = (e.target.value || "").trim().toUpperCase(); this._render_results(); });
		$b.find("#tj-rb-sector").on("change", (e) => { this.sector = e.target.value || ""; this._render_results(); });
		this._update_snap_info();
	}

	_update_snap_info() {
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.snapshot_status",
			callback: (r) => {
				const m = r.message || {};
				const $info = $(this.page.body).find("#tj-rb-snap-info");
				$info.text(m.latest_snapshot_date ? "Snapshot: " + m.latest_snapshot_date : "No snapshot yet");
				if ((m.refresh || {}).running) {
					$info.text("Refreshing snapshot…");
					setTimeout(() => this._update_snap_info(), 4000);
				}
			},
		});
	}

	_refresh_snapshot() {
		const $btn = $(this.page.body).find("#tj-rb-snap-refresh");
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
			args: { scan_type: "Rocket Base" },
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok || !m.name) {
					this._render_empty("No completed Rocket Base scan yet. Click \"Run This Scan\".");
					return;
				}
				this.run_name = m.name;
				this._absorb_status(m);
			},
		});
	}

	_start_scan() {
		const $body = $(this.page.body);
		$body.find("#tj-rb-run").prop("disabled", true).text("Queued…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.start_scan",
			args: { scan_type: "Rocket Base" },
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok) {
					frappe.msgprint({ title: "Error", message: m.error || "Failed", indicator: "red" });
					$body.find("#tj-rb-run").prop("disabled", false).text("Run This Scan");
					return;
				}
				this.run_name = m.run_name;
				this._poll_status();
			},
			error: () => $body.find("#tj-rb-run").prop("disabled", false).text("Run This Scan"),
		});
	}

	_start_all_scans() {
		const $body = $(this.page.body);
		const $btnAll = $body.find("#tj-rb-run-all");
		$btnAll.prop("disabled", true).text("Queued…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.start_all_scans",
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok) {
					frappe.msgprint({ title: "Error", message: m.error || "Failed", indicator: "red" });
					$btnAll.prop("disabled", false).text("Run All 7 Scans");
					return;
				}
				const my = (m.run_names || {})["Rocket Base"];
				if (my) this.run_name = my;
				frappe.show_alert({message: "Started all 7 scans.", indicator: "green"}, 5);
				this._poll_status();
			},
			error: () => $btnAll.prop("disabled", false).text("Run All 7 Scans"),
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
						$b.find("#tj-rb-run").prop("disabled", false).text("Run This Scan");
						$b.find("#tj-rb-run-all").prop("disabled", false).text("Run All 7 Scans");
					}
				},
			});
		};
		tick();
	}

	_absorb_status(m) {
		this.last_status = m;
		const $b = $(this.page.body);
		const $st = $b.find("#tj-rb-status");
		$st.show();
		const cls = (m.status || "").toLowerCase();
		const errBlock = m.error
			? `<div class="err">${frappe.utils.escape_html(m.error).slice(0, 1500)}</div>`
			: "";
		$st.html(`
			<span class="pill ${cls}">${m.status || "—"}</span>
			<div class="tj-msg">${frappe.utils.escape_html(m.progress || "")}</div>
			<div>Scanned: <b>${m.total_scanned || 0}</b> · Rocket bases: <b>${m.passed_count || 0}</b></div>
			${m.completed_at ? `<div style="font-size:11px; color:#94a3b8;">Last scan: ${frappe.datetime.str_to_user(m.completed_at)}</div>` : ""}
			${errBlock}
		`);
		this.results = m.results || [];
		this._render_summary();
		this._render_results();
	}

	_render_empty(msg) {
		$(this.page.body).find("#tj-rb-tbody").html(
			`<tr><td colspan="11" class="tj-rb-empty">${frappe.utils.escape_html(msg)}</td></tr>`
		);
		$(this.page.body).find("#tj-rb-summary").empty();
	}

	_extract(r) {
		try { return JSON.parse(r.criteria_json || "{}").rocket_base || {}; } catch (e) { return {}; }
	}

	_industry_for(r) {
		if (r.industry) return r.industry;
		try { return JSON.parse(r.criteria_json || "{}").industry || ""; } catch (e) { return ""; }
	}

	_populate_sector_dropdown() {
		const $sel = $(this.page.body).find("#tj-rb-sector");
		const inds = Array.from(new Set((this.results || []).map((r) => this._industry_for(r)).filter(Boolean))).sort();
		const cur = $sel.val();
		$sel.empty().append('<option value="">All Sectors</option>');
		inds.forEach((s) => $sel.append(`<option value="${frappe.utils.escape_html(s)}">${frappe.utils.escape_html(s)}</option>`));
		if (cur && inds.includes(cur)) $sel.val(cur);
	}

	_render_summary() {
		const all = this.results || [];
		const tightBase = all.filter((r) => (r.vcp_tightness || 0) <= 15).length;
		const bigRun = all.filter((r) => (this._extract(r).run_pct_8w || 0) >= 120).length;
		const dryUp = all.filter((r) => this._extract(r).volume_dry_up).length;
		const avgRun = all.length
			? (all.reduce((s, r) => s + (this._extract(r).run_pct_8w || 0), 0) / all.length).toFixed(1)
			: "—";
		$(this.page.body).find("#tj-rb-summary").html(`
			<div class="tj-rb-card"><div class="lbl">Total Rocket Bases</div><div class="val">${all.length}</div></div>
			<div class="tj-rb-card"><div class="lbl">Tight Base (≤15%)</div><div class="val">${tightBase}</div></div>
			<div class="tj-rb-card"><div class="lbl">Big Run (≥120%)</div><div class="val">${bigRun}</div></div>
			<div class="tj-rb-card"><div class="lbl">Avg 8w Run</div><div class="val">${avgRun}%</div></div>
		`);
	}

	_render_results() {
		this._populate_sector_dropdown();
		const $tbody = $(this.page.body).find("#tj-rb-tbody");
		const search = this.search;
		const sector = this.sector;
		const filtered = (this.results || []).filter((r) => {
			const rb = this._extract(r);
			if (this.min_run !== "" && (rb.run_pct_8w || 0) < this.min_run) return false;
			if (this.max_base !== "" && (rb.base_depth_pct || 999) > this.max_base) return false;
			if (search && !(r.symbol || "").toUpperCase().includes(search)) return false;
			if (sector && this._industry_for(r) !== sector) return false;
			return true;
		});
		if (!filtered.length) {
			$tbody.html(`<tr><td colspan="11" class="tj-rb-empty">No symbols match the current filters.</td></tr>`);
			return;
		}
		const rows = filtered.map((r, i) => {
			const rb = this._extract(r);
			let trendPassed = 0;
			try { trendPassed = JSON.parse(r.criteria_json || "{}").trend_template_passed || 0; } catch (e) {}
			const sym = r.symbol;
			const ind = this._industry_for(r);
			const baseDepth = rb.base_depth_pct || 0;
			const baseCls = baseDepth <= 15 ? "tight" : "loose";
			return `
				<tr data-symbol="${sym}">
					<td>${i + 1}</td>
					<td class="sym"><a href="/app/stock-symbol/${sym}" target="_blank">${sym}</a></td>
					<td>${frappe.utils.escape_html(r.company_name || "")}</td>
					<td style="font-size:11px; color:#64748b;">${frappe.utils.escape_html(ind || "—")}</td>
					<td class="num">${frappe.format(r.current_price || 0, { fieldtype: "Currency", options: "INR" })}</td>
					<td class="num"><span class="badge run">+${(rb.run_pct_8w || 0).toFixed(0)}%</span></td>
					<td class="num"><span class="badge ${baseCls}">${baseDepth.toFixed(1)}%</span></td>
					<td class="num neg">-${(rb.dist_from_peak_pct || 0).toFixed(2)}%</td>
					<td class="num">${trendPassed}/8</td>
					<td class="num">${(r.rs_rating || 0).toFixed(1)}</td>
					<td class="actions">
						<a href="#" class="tj-watch" data-symbol="${sym}" data-company="${frappe.utils.escape_html(r.company_name || '')}" data-pivot="${rb.peak_8w || r.current_price || ''}">+ Watch</a>
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
					scan_source: "Rocket Base",
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
