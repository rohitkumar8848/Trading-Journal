frappe.pages["intraday-short-screener"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Intraday Short — Next-Session Candidates",
		single_column: true,
	});
	new IntradayShortScreenerPage(page);
};

class IntradayShortScreenerPage {
	constructor(page) {
		this.page = page;
		this.run_name = null;
		this.poll_timer = null;
		this.max_change = "";
		this.min_vol = "";
		this.search = "";
		this.sector = "";
		this._inject_styles();
		this._render_skeleton();
		this._bind_controls();
		this._load_latest();
	}

	_inject_styles() {
		if (document.getElementById("tj-is-css")) return;
		const css = `
		.tj-is-wrap { padding: 14px; }
		.tj-is-hero {
			background: linear-gradient(135deg, #475569, #b91c1c);
			border-radius: 12px; padding: 18px 22px; color: #fff;
			margin-bottom: 16px; display: flex; justify-content: space-between;
			align-items: center; flex-wrap: wrap; gap: 14px;
		}
		.tj-is-hero h2 { margin: 0; font-size: 20px; font-weight: 800; }
		.tj-is-hero .sub { font-size: 12px; opacity: 0.9; margin-top: 4px; }
		.tj-is-hero .btn-scan {
			background: #fff; color: #7f1d1d; font-weight: 700;
			padding: 9px 18px; border-radius: 8px; border: 0; cursor: pointer;
			font-size: 13px;
		}
		.tj-is-hero .btn-scan:disabled { opacity: 0.6; cursor: not-allowed; }

		.tj-is-status {
			background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 14px; font-size: 13px;
			display: flex; gap: 16px; flex-wrap: wrap; align-items: center;
		}
		.tj-is-status .pill {
			display: inline-block; padding: 3px 10px; border-radius: 999px;
			font-size: 11px; font-weight: 700; text-transform: uppercase;
			letter-spacing: 0.5px;
		}
		.tj-is-status .pill.queued { background: #fef3c7; color: #92400e; }
		.tj-is-status .pill.running { background: #dbeafe; color: #1e40af; }
		.tj-is-status .pill.completed { background: #d1fae5; color: #065f46; }
		.tj-is-status .pill.failed { background: #fee2e2; color: #991b1b; }
		.tj-is-status .tj-msg { color: #64748b; flex: 1; background: transparent !important; height: auto !important; overflow: visible !important; display: block !important; }
		.tj-is-status .err { color: #991b1b; font-family: monospace; font-size: 11px; white-space: pre-wrap; max-height: 140px; overflow: auto; }

		.tj-is-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
		.tj-is-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
		.tj-is-card .lbl { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
		.tj-is-card .val { font-size: 22px; font-weight: 800; margin-top: 4px; color: #0f172a; }

		.tj-is-filters {
			display: flex; gap: 14px; flex-wrap: wrap; align-items: end;
			background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 12px;
		}
		.tj-is-filters label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; display: block; margin-bottom: 4px; }
		.tj-is-filters input, .tj-is-filters select {
			border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; font-size: 13px;
			min-width: 140px; background: #fff;
		}

		.tj-is-table-wrap { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
		.tj-is-table { width: 100%; border-collapse: collapse; font-size: 13px; }
		.tj-is-table th {
			background: #f1f5f9; font-size: 10px; font-weight: 700;
			text-transform: uppercase; letter-spacing: 0.5px; color: #475569;
			padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0;
			white-space: nowrap;
		}
		.tj-is-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #0f172a; }
		.tj-is-table tr:hover td { background: #f8fafc; }
		.tj-is-table .sym { font-weight: 700; color: #b91c1c; }
		.tj-is-table .sym a { color: inherit; text-decoration: none; }
		.tj-is-table .num { font-variant-numeric: tabular-nums; text-align: right; }
		.tj-is-table .pos { color: #10b981; font-weight: 700; }
		.tj-is-table .neg { color: #f43f5e; font-weight: 700; }
		.tj-is-table .badge {
			display: inline-block; padding: 2px 8px; border-radius: 999px;
			font-size: 11px; font-weight: 700;
		}
		.tj-is-table .badge.hot { background: #fee2e2; color: #991b1b; }
		.tj-is-table .badge.warm { background: #fed7aa; color: #9a3412; }
		.tj-is-table .badge.cool { background: #e2e8f0; color: #334155; }
		.tj-is-table .actions a {
			color: #b91c1c; text-decoration: none; font-weight: 600;
			margin-right: 8px; font-size: 12px;
		}
		.tj-is-table .actions a:hover { text-decoration: underline; }
		.tj-is-empty { padding: 40px; text-align: center; color: #94a3b8; }
		`;
		const s = document.createElement("style");
		s.id = "tj-is-css";
		s.textContent = css;
		document.head.appendChild(s);
	}

	_render_skeleton() {
		$(this.page.body).empty().append(`
			<div class="tj-is-wrap">
				<div class="tj-is-hero">
					<div>
						<h2>🔻 Intraday Short — Next-Session Watchlist</h2>
						<div class="sub">Stocks that closed weak on heavy volume — the names short-sellers, gap-down and ORB-short traders watch the next morning. Built from end-of-day signals (we don't have intraday ticks). Sorted by volume surge then closing weakness.</div>
					</div>
					<div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
						<span id="tj-is-snap-info" style="color:rgba(255,255,255,0.85); font-size:11px;"></span>
						<button class="btn-scan" id="tj-is-snap-refresh" style="background:rgba(255,255,255,0.15); color:#fff; border:1px solid rgba(255,255,255,0.4);">↻ Refresh Snapshot</button>
						<button class="btn-scan" id="tj-is-run-all" style="background:#10b981;color:#fff;">Run All 7 Scans</button>
						<button class="btn-scan" id="tj-is-run">Run This Scan</button>
					</div>
				</div>
				<div class="tj-is-status" id="tj-is-status" style="display: none;"></div>
				<div class="tj-is-summary" id="tj-is-summary"></div>
				<div class="tj-is-filters">
					<div>
						<label>Max % Change</label>
						<select id="tj-is-max-change">
							<option value="" selected>All (no filter)</option>
							<option value="-2">≤ -2%</option>
							<option value="-3">≤ -3%</option>
							<option value="-5">≤ -5% (heavy drop)</option>
							<option value="-7">≤ -7% (collapse)</option>
						</select>
					</div>
					<div>
						<label>Min Volume × Avg</label>
						<select id="tj-is-min-vol">
							<option value="" selected>All (no filter)</option>
							<option value="1.5">≥ 1.5×</option>
							<option value="2">≥ 2×</option>
							<option value="3">≥ 3× (heavy distribution)</option>
							<option value="5">≥ 5× (extreme)</option>
						</select>
					</div>
					<div>
						<label>Sector</label>
						<select id="tj-is-sector"><option value="">All Sectors</option></select>
					</div>
					<div>
						<label>Search Symbol</label>
						<input type="text" id="tj-is-search" placeholder="e.g. TATAMOTORS">
					</div>
				</div>
				<div class="tj-is-table-wrap">
					<table class="tj-is-table" id="tj-is-table">
						<thead>
							<tr>
								<th>#</th>
								<th>Symbol</th>
								<th>Company</th>
								<th>Sector</th>
								<th class="num">Close ₹</th>
								<th class="num">% Change</th>
								<th class="num">Gap %</th>
								<th class="num">Close Strength</th>
								<th class="num">Range %</th>
								<th class="num">Vol × Avg</th>
								<th class="num">RS</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody id="tj-is-tbody">
							<tr><td colspan="12" class="tj-is-empty">Loading…</td></tr>
						</tbody>
					</table>
				</div>
			</div>
		`);
	}

	_bind_controls() {
		const $b = $(this.page.body);
		$b.find("#tj-is-run").on("click", () => this._start_scan());
		$b.find("#tj-is-run-all").on("click", () => this._start_all_scans());
		$b.find("#tj-is-snap-refresh").on("click", () => this._refresh_snapshot());
		$b.find("#tj-is-max-change").on("change", (e) => {
			this.max_change = e.target.value === "" ? "" : parseFloat(e.target.value);
			this._render_results();
		});
		$b.find("#tj-is-min-vol").on("change", (e) => {
			this.min_vol = e.target.value === "" ? "" : parseFloat(e.target.value);
			this._render_results();
		});
		$b.find("#tj-is-search").on("input", (e) => {
			this.search = (e.target.value || "").trim().toUpperCase();
			this._render_results();
		});
		$b.find("#tj-is-sector").on("change", (e) => {
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
				const $info = $(this.page.body).find("#tj-is-snap-info");
				$info.text(m.latest_snapshot_date ? "Snapshot: " + m.latest_snapshot_date : "No snapshot yet");
				if ((m.refresh || {}).running) {
					$info.text("Refreshing snapshot…");
					setTimeout(() => this._update_snap_info(), 4000);
				}
			},
		});
	}

	_refresh_snapshot() {
		const $btn = $(this.page.body).find("#tj-is-snap-refresh");
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
			args: { scan_type: "Intraday Short" },
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok || !m.name) {
					this._render_empty("No completed Intraday Short scan yet. Click \"Run This Scan\".");
					return;
				}
				this.run_name = m.name;
				this._absorb_status(m);
			},
		});
	}

	_start_scan() {
		const $body = $(this.page.body);
		$body.find("#tj-is-run").prop("disabled", true).text("Queued…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.start_scan",
			args: { scan_type: "Intraday Short" },
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok) {
					frappe.msgprint({ title: "Error", message: m.error || "Failed", indicator: "red" });
					$body.find("#tj-is-run").prop("disabled", false).text("Run This Scan");
					return;
				}
				this.run_name = m.run_name;
				this._poll_status();
			},
			error: () => $body.find("#tj-is-run").prop("disabled", false).text("Run This Scan"),
		});
	}

	_start_all_scans() {
		const $body = $(this.page.body);
		const $btnAll = $body.find("#tj-is-run-all");
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
				const my = (m.run_names || {})["Intraday Short"];
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
						$b.find("#tj-is-run").prop("disabled", false).text("Run This Scan");
						$b.find("#tj-is-run-all").prop("disabled", false).text("Run All 7 Scans");
					}
				},
			});
		};
		tick();
	}

	_absorb_status(m) {
		this.last_status = m;
		const $b = $(this.page.body);
		const $st = $b.find("#tj-is-status");
		$st.show();
		const cls = (m.status || "").toLowerCase();
		const errBlock = m.error
			? `<div class="err">${frappe.utils.escape_html(m.error).slice(0, 1500)}</div>`
			: "";
		$st.html(`
			<span class="pill ${cls}">${m.status || "—"}</span>
			<div class="tj-msg">${frappe.utils.escape_html(m.progress || "")}</div>
			<div>Scanned: <b>${m.total_scanned || 0}</b> · In play: <b>${m.passed_count || 0}</b></div>
			${m.completed_at ? `<div style="font-size:11px; color:#94a3b8;">Last scan: ${frappe.datetime.str_to_user(m.completed_at)}</div>` : ""}
			${errBlock}
		`);
		this.results = m.results || [];
		this._render_summary();
		this._render_results();
	}

	_render_empty(msg) {
		$(this.page.body).find("#tj-is-tbody").html(
			`<tr><td colspan="12" class="tj-is-empty">${frappe.utils.escape_html(msg)}</td></tr>`
		);
		$(this.page.body).find("#tj-is-summary").empty();
	}

	_is_for(r) {
		try { return JSON.parse(r.criteria_json || "{}").intraday_short || {}; } catch (e) { return {}; }
	}

	_render_summary() {
		const all = this.results || [];
		const gapDowns = all.filter((r) => (this._is_for(r).gap_pct || 0) <= -1).length;
		const heavyVol = all.filter((r) => (this._is_for(r).vol_ratio_20d || 0) >= 3).length;
		const crash = all.filter((r) => (r.vcp_tightness || 0) <= -5).length;
		$(this.page.body).find("#tj-is-summary").html(`
			<div class="tj-is-card"><div class="lbl">Total Candidates</div><div class="val">${all.length}</div></div>
			<div class="tj-is-card"><div class="lbl">Gap-Downs (≤ -1%)</div><div class="val">${gapDowns}</div></div>
			<div class="tj-is-card"><div class="lbl">Heavy Volume (≥ 3×)</div><div class="val">${heavyVol}</div></div>
			<div class="tj-is-card"><div class="lbl">Crash (≤ -5%)</div><div class="val">${crash}</div></div>
		`);
	}

	_industry_for(r) {
		if (r.industry) return r.industry;
		try { return JSON.parse(r.criteria_json || "{}").industry || ""; } catch (e) { return ""; }
	}

	_populate_sector_dropdown() {
		const $sel = $(this.page.body).find("#tj-is-sector");
		const inds = Array.from(new Set((this.results || []).map((r) => this._industry_for(r)).filter(Boolean))).sort();
		const cur = $sel.val();
		$sel.empty().append('<option value="">All Sectors</option>');
		inds.forEach((s) => $sel.append(`<option value="${frappe.utils.escape_html(s)}">${frappe.utils.escape_html(s)}</option>`));
		if (cur && inds.includes(cur)) $sel.val(cur);
	}

	_render_results() {
		this._populate_sector_dropdown();
		const $tbody = $(this.page.body).find("#tj-is-tbody");
		const filtered = (this.results || []).filter((r) => {
			const ish = this._is_for(r);
			if (this.max_change !== "" && (r.vcp_tightness || 0) > this.max_change) return false;
			if (this.min_vol !== "" && (ish.vol_ratio_20d || 0) < this.min_vol) return false;
			if (this.search && !(r.symbol || "").toUpperCase().includes(this.search)) return false;
			if (this.sector && this._industry_for(r) !== this.sector) return false;
			return true;
		});
		if (!filtered.length) {
			$tbody.html(`<tr><td colspan="12" class="tj-is-empty">No symbols match the current filters.</td></tr>`);
			return;
		}
		const rows = filtered.map((r, i) => {
			const ish = this._is_for(r);
			const change = r.vcp_tightness || 0;
			const cls = change <= -5 ? "hot" : (change <= -3 ? "warm" : "cool");
			const sym = r.symbol;
			const ind = this._industry_for(r);
			const volRatio = ish.vol_ratio_20d || 0;
			return `
				<tr data-symbol="${sym}">
					<td>${i + 1}</td>
					<td class="sym"><a href="/app/stock-symbol/${sym}" target="_blank">${sym}</a></td>
					<td>${frappe.utils.escape_html(r.company_name || "")}</td>
					<td style="font-size:11px; color:#64748b;">${frappe.utils.escape_html(ind || "—")}</td>
					<td class="num">${frappe.format(r.current_price || 0, { fieldtype: "Currency", options: "INR" })}</td>
					<td class="num"><span class="badge ${cls}">${change.toFixed(2)}%</span></td>
					<td class="num ${(ish.gap_pct || 0) >= 0 ? "pos" : "neg"}">${(ish.gap_pct || 0).toFixed(2)}%</td>
					<td class="num">${(ish.close_strength || 0).toFixed(0)}%</td>
					<td class="num">${(ish.range_pct || 0).toFixed(2)}%</td>
					<td class="num neg">${volRatio.toFixed(2)}×</td>
					<td class="num">${(r.rs_rating || 0).toFixed(1)}</td>
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
					scan_source: "Intraday Short",
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
