frappe.pages["turnaround-screener"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Turnaround Screener — Stage 1→2 Reversals",
		single_column: true,
	});
	new TurnaroundScreenerPage(page);
};

class TurnaroundScreenerPage {
	constructor(page) {
		this.page = page;
		this.run_name = null;
		this.poll_timer = null;
		this.min_ret = "";
		this.search = "";
		this.sector = "";
		this.only_golden = false;
		this.universe = "Nifty 500";
		this._inject_styles();
		this._render_skeleton();
		this._bind_controls();
		this._load_latest();
	}

	_inject_styles() {
		if (document.getElementById("tj-ta-css")) return;
		const css = `
		.tj-ta-wrap { padding: 14px; }
		.tj-ta-hero {
			background: linear-gradient(135deg, #0ea5e9, #10b981);
			border-radius: 12px; padding: 18px 22px; color: #fff;
			margin-bottom: 16px; display: flex; justify-content: space-between;
			align-items: center; flex-wrap: wrap; gap: 14px;
		}
		.tj-ta-hero h2 { margin: 0; font-size: 20px; font-weight: 800; }
		.tj-ta-hero .sub { font-size: 12px; opacity: 0.9; margin-top: 4px; max-width: 640px; }
		.tj-ta-hero .btn-scan {
			background: #fff; color: #065f46; font-weight: 700;
			padding: 9px 18px; border-radius: 8px; border: 0; cursor: pointer;
			font-size: 13px;
		}
		.tj-ta-hero .btn-scan:disabled { opacity: 0.6; cursor: not-allowed; }

		.tj-ta-status {
			background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 14px; font-size: 13px;
			display: flex; gap: 16px; flex-wrap: wrap; align-items: center;
		}
		.tj-ta-status .pill {
			display: inline-block; padding: 3px 10px; border-radius: 999px;
			font-size: 11px; font-weight: 700; text-transform: uppercase;
			letter-spacing: 0.5px;
		}
		.tj-ta-status .pill.queued { background: #fef3c7; color: #92400e; }
		.tj-ta-status .pill.running { background: #dbeafe; color: #1e40af; }
		.tj-ta-status .pill.completed { background: #d1fae5; color: #065f46; }
		.tj-ta-status .pill.failed { background: #fee2e2; color: #991b1b; }
		.tj-ta-status .tj-msg { color: #64748b; flex: 1; background: transparent !important; height: auto !important; overflow: visible !important; display: block !important; }
		.tj-ta-status .err { color: #991b1b; font-family: monospace; font-size: 11px; white-space: pre-wrap; max-height: 140px; overflow: auto; }

		.tj-ta-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
		.tj-ta-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
		.tj-ta-card .lbl { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
		.tj-ta-card .val { font-size: 22px; font-weight: 800; margin-top: 4px; color: #0f172a; }
		.tj-ta-card.win .val { color: #10b981; }

		.tj-ta-filters {
			display: flex; gap: 14px; flex-wrap: wrap; align-items: end;
			background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 12px;
		}
		.tj-ta-filters label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; display: block; margin-bottom: 4px; }
		.tj-ta-filters input, .tj-ta-filters select {
			border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; font-size: 13px;
			min-width: 140px; background: #fff;
		}
		.tj-ta-filters .chk { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #475569; font-weight: 600; }
		.tj-ta-filters .chk input { min-width: 0; }

		.tj-ta-table-wrap { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
		.tj-ta-table { width: 100%; border-collapse: collapse; font-size: 13px; }
		.tj-ta-table th {
			background: #f1f5f9; font-size: 10px; font-weight: 700;
			text-transform: uppercase; letter-spacing: 0.5px; color: #475569;
			padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0;
			white-space: nowrap;
		}
		.tj-ta-table td {
			padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #0f172a;
		}
		.tj-ta-table tr:hover td { background: #f8fafc; }
		.tj-ta-table .sym { font-weight: 700; color: #0ea5e9; }
		.tj-ta-table .sym a { color: inherit; text-decoration: none; }
		.tj-ta-table .sym a:hover { text-decoration: underline; }
		.tj-ta-table .num { font-variant-numeric: tabular-nums; text-align: right; }
		.tj-ta-table .pos { color: #10b981; font-weight: 700; }
		.tj-ta-table .neg { color: #f43f5e; font-weight: 700; }
		.tj-ta-table .badge {
			display: inline-block; padding: 2px 8px; border-radius: 999px;
			font-size: 11px; font-weight: 700;
		}
		.tj-ta-table .badge.gc { background: #d1fae5; color: #065f46; }
		.tj-ta-table .badge.no { background: #f1f5f9; color: #94a3b8; }
		.tj-ta-table .actions a {
			color: #0ea5e9; text-decoration: none; font-weight: 600;
			margin-right: 8px; font-size: 12px;
		}
		.tj-ta-table .actions a:hover { text-decoration: underline; }
		.tj-ta-empty { padding: 40px; text-align: center; color: #94a3b8; }

		.tj-ta-detail-row td { background: #fafbfc; padding: 12px 24px; }
		.tj-ta-crit-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
		.tj-crit { font-size: 11px; padding: 6px 10px; border-radius: 6px; }
		.tj-crit.ok { background: #d1fae5; color: #065f46; }
		.tj-crit.no { background: #fee2e2; color: #991b1b; }
		`;
		const style = document.createElement("style");
		style.id = "tj-ta-css";
		style.textContent = css;
		document.head.appendChild(style);
	}

	_render_skeleton() {
		const $body = $(this.page.body).empty();
		$body.append(`
			<div class="tj-ta-wrap">
				<div class="tj-ta-hero">
					<div>
						<h2>Turnaround Screener — Nifty 500</h2>
						<div class="sub">Beaten-down laggards turning the corner: ≥25% off the 52w high, lifted off the 52w low, back above the 50 &amp; 200-DMA while the 200-DMA stops falling, with a sharp 3-month momentum surge. Weinstein Stage 1→2 reversals.</div>
					</div>
					<div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
						<span id="tj-ta-snap-info" style="color:rgba(255,255,255,0.9); font-size:11px;"></span>
						<button class="btn-scan" id="tj-ta-snap-refresh" style="background:rgba(255,255,255,0.15); color:#fff; border:1px solid rgba(255,255,255,0.4);">↻ Refresh Snapshot</button>
						<button class="btn-scan" id="tj-ta-run-all" style="background:#065f46;color:#fff;">Run All 9 Scans</button>
						<button class="btn-scan" id="tj-ta-run">Run This Scan</button>
					</div>
				</div>
				<div class="tj-ta-status" id="tj-ta-status" style="display: none;"></div>
				<div class="tj-ta-summary" id="tj-ta-summary"></div>
				<div class="tj-ta-filters">
					<div>
						<label>Universe</label>
						<select id="tj-ta-universe">
							<option value="Nifty 500" selected>Nifty 500</option>
							<option value="FnO">F&amp;O</option>
							<option value="All NSE">All NSE</option>
						</select>
					</div>
					<div>
						<label>Min 3-Month Return</label>
						<select id="tj-ta-min-ret">
							<option value="" selected>All (no filter)</option>
							<option value="15">≥ 15%</option>
							<option value="25">≥ 25%</option>
							<option value="40">≥ 40%</option>
						</select>
					</div>
					<div>
						<label>Sector</label>
						<select id="tj-ta-sector"><option value="">All Sectors</option></select>
					</div>
					<div>
						<label>Search Symbol</label>
						<input type="text" id="tj-ta-search" placeholder="e.g. TATAMOTORS">
					</div>
					<div>
						<label>&nbsp;</label>
						<div class="chk"><input type="checkbox" id="tj-ta-golden"> Golden cross only (50&gt;200 DMA)</div>
					</div>
				</div>
				<div class="tj-ta-table-wrap">
					<table class="tj-ta-table" id="tj-ta-table">
						<thead>
							<tr>
								<th>#</th>
								<th>Symbol</th>
								<th>Company</th>
								<th>Sector</th>
								<th class="num">Price ₹</th>
								<th class="num">3M Return</th>
								<th class="num">12M Return</th>
								<th class="num">From 52w High</th>
								<th class="num">Above 52w Low</th>
								<th class="num">RS</th>
								<th>Trend</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody id="tj-ta-tbody">
							<tr><td colspan="12" class="tj-ta-empty">Loading…</td></tr>
						</tbody>
					</table>
				</div>
			</div>
		`);
	}

	_bind_controls() {
		const $body = $(this.page.body);
		$body.find("#tj-ta-run").on("click", () => this._start_scan());
		$body.find("#tj-ta-run-all").on("click", () => this._start_all_scans());
		$body.find("#tj-ta-snap-refresh").on("click", () => this._refresh_snapshot());
		$body.find("#tj-ta-universe").on("change", (e) => {
			this.universe = e.target.value || "Nifty 500";
		});
		$body.find("#tj-ta-min-ret").on("change", (e) => {
			this.min_ret = e.target.value === "" ? "" : parseFloat(e.target.value);
			this._render_results();
		});
		$body.find("#tj-ta-search").on("input", (e) => {
			this.search = (e.target.value || "").trim().toUpperCase();
			this._render_results();
		});
		$body.find("#tj-ta-sector").on("change", (e) => {
			this.sector = e.target.value || "";
			this._render_results();
		});
		$body.find("#tj-ta-golden").on("change", (e) => {
			this.only_golden = !!e.target.checked;
			this._render_results();
		});
		this._update_snap_info();
	}

	_update_snap_info() {
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.snapshot_status",
			callback: (r) => {
				const m = r.message || {};
				const $info = $(this.page.body).find("#tj-ta-snap-info");
				$info.text(m.latest_snapshot_date ? "Snapshot: " + m.latest_snapshot_date : "No snapshot yet");
				if ((m.refresh || {}).running) {
					$info.text("Refreshing snapshot…");
					setTimeout(() => this._update_snap_info(), 4000);
				}
			},
		});
	}

	_refresh_snapshot() {
		const $btn = $(this.page.body).find("#tj-ta-snap-refresh");
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
			args: { scan_type: "Turnaround" },
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok || !m.name) {
					this._render_empty("No completed Turnaround scan yet. Click \"Run This Scan\".");
					return;
				}
				this.run_name = m.name;
				this._absorb_status(m);
			},
		});
	}

	_start_scan() {
		const $body = $(this.page.body);
		$body.find("#tj-ta-run").prop("disabled", true).text("Queued…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.start_scan",
			args: { scan_type: "Turnaround", universe: this.universe },
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok) {
					frappe.msgprint({ title: "Could not start scan", message: m.error || "Unknown error", indicator: "red" });
					$body.find("#tj-ta-run").prop("disabled", false).text("Run This Scan");
					return;
				}
				this.run_name = m.run_name;
				this._poll_status();
			},
			error: () => {
				$body.find("#tj-ta-run").prop("disabled", false).text("Run This Scan");
			},
		});
	}

	_start_all_scans() {
		const $body = $(this.page.body);
		const $btnAll = $body.find("#tj-ta-run-all");
		$btnAll.prop("disabled", true).text("Queued…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.start_all_scans",
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok) {
					frappe.msgprint({ title: "Could not start scans", message: m.error || "Unknown error", indicator: "red" });
					$btnAll.prop("disabled", false).text("Run All 9 Scans");
					return;
				}
				const myRun = (m.run_names || {})["Turnaround"];
				if (myRun) this.run_name = myRun;
				frappe.show_alert({
					message: "Started all 7 scans. Other screener pages will update on refresh.",
					indicator: "green",
				}, 6);
				this._poll_status();
			},
			error: () => {
				$btnAll.prop("disabled", false).text("Run All 9 Scans");
			},
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
						this.poll_timer = setTimeout(tick, 4000);
					} else {
						const $b = $(this.page.body);
						$b.find("#tj-ta-run").prop("disabled", false).text("Run This Scan");
						$b.find("#tj-ta-run-all").prop("disabled", false).text("Run All 9 Scans");
					}
				},
			});
		};
		tick();
	}

	_absorb_status(m) {
		this.last_status = m;
		const $body = $(this.page.body);
		const $st = $body.find("#tj-ta-status");
		$st.show();
		const cls = (m.status || "").toLowerCase();
		const errBlock = m.error
			? `<div class="err">${frappe.utils.escape_html(m.error).slice(0, 1500)}</div>`
			: "";
		$st.html(`
			<span class="pill ${cls}">${m.status || "—"}</span>
			<div class="tj-msg">${frappe.utils.escape_html(m.progress || "")}</div>
			<div>Scanned: <b>${m.total_scanned || 0}</b> · Turnarounds: <b>${m.passed_count || 0}</b></div>
			${m.completed_at ? `<div style="font-size:11px; color:#94a3b8;">Last scan: ${frappe.datetime.str_to_user(m.completed_at)}</div>` : ""}
			${errBlock}
		`);
		this.results = m.results || [];
		this._render_summary();
		this._render_results();
	}

	_render_empty(msg) {
		const $body = $(this.page.body);
		$body.find("#tj-ta-tbody").html(
			`<tr><td colspan="12" class="tj-ta-empty">${frappe.utils.escape_html(msg)}</td></tr>`
		);
		$body.find("#tj-ta-summary").empty();
	}

	_extract(r) {
		try {
			return JSON.parse(r.criteria_json || "{}").turnaround || {};
		} catch (e) { return {}; }
	}

	_render_summary() {
		const all = this.results || [];
		const golden = all.filter((r) => this._extract(r).golden_cross).length;
		const volExp = all.filter((r) => this._extract(r).volume_expansion).length;
		const avgRs = all.length
			? (all.reduce((s, r) => s + (r.rs_rating || 0), 0) / all.length).toFixed(1)
			: "—";
		$(this.page.body).find("#tj-ta-summary").html(`
			<div class="tj-ta-card win"><div class="lbl">Turnaround Candidates</div><div class="val">${all.length}</div></div>
			<div class="tj-ta-card"><div class="lbl">Golden Cross (50&gt;200)</div><div class="val">${golden}</div></div>
			<div class="tj-ta-card"><div class="lbl">Volume Expanding</div><div class="val">${volExp}</div></div>
			<div class="tj-ta-card"><div class="lbl">Avg RS Rating</div><div class="val">${avgRs}</div></div>
		`);
	}

	_industry_for(r) {
		if (r.industry) return r.industry;
		try { return JSON.parse(r.criteria_json || "{}").industry || ""; } catch (e) { return ""; }
	}

	_populate_sector_dropdown() {
		const $sel = $(this.page.body).find("#tj-ta-sector");
		const inds = Array.from(new Set((this.results || []).map((r) => this._industry_for(r)).filter(Boolean))).sort();
		const cur = $sel.val();
		$sel.empty().append('<option value="">All Sectors</option>');
		inds.forEach((s) => $sel.append(`<option value="${frappe.utils.escape_html(s)}">${frappe.utils.escape_html(s)}</option>`));
		if (cur && inds.includes(cur)) $sel.val(cur);
	}

	_render_results() {
		this._populate_sector_dropdown();
		const $tbody = $(this.page.body).find("#tj-ta-tbody");
		const search = this.search;
		const sector = this.sector;
		const filtered = (this.results || []).filter((r) => {
			if (this.min_ret !== "" && (r.vcp_tightness || 0) < this.min_ret) return false;
			if (search && !(r.symbol || "").toUpperCase().includes(search)) return false;
			if (sector && this._industry_for(r) !== sector) return false;
			if (this.only_golden && !this._extract(r).golden_cross) return false;
			return true;
		});
		if (!filtered.length) {
			$tbody.html(`<tr><td colspan="12" class="tj-ta-empty">No symbols match the current filters.</td></tr>`);
			return;
		}
		const rows = filtered.map((r, i) => {
			const t = this._extract(r);
			const sym = r.symbol;
			const ret3 = (r.vcp_tightness || 0);
			const ret12 = (t.ret_12m_pct || 0);
			const fromHi = (r.pct_from_52w_high || 0).toFixed(2);
			const aboveLo = (r.pct_above_52w_low || 0).toFixed(2);
			const ind = this._industry_for(r);
			const gc = t.golden_cross;
			return `
				<tr data-symbol="${sym}">
					<td>${i + 1}</td>
					<td class="sym"><a href="#" class="tj-toggle" data-symbol="${sym}">${sym}</a></td>
					<td>${frappe.utils.escape_html(r.company_name || "")}</td>
					<td style="font-size:11px; color:#64748b;">${frappe.utils.escape_html(ind || "—")}</td>
					<td class="num">${frappe.format(r.current_price || 0, { fieldtype: "Currency", options: "INR" })}</td>
					<td class="num pos">+${ret3.toFixed(1)}%</td>
					<td class="num ${ret12 >= 0 ? "pos" : "neg"}">${ret12 >= 0 ? "+" : ""}${ret12.toFixed(1)}%</td>
					<td class="num neg">${fromHi}%</td>
					<td class="num pos">+${aboveLo}%</td>
					<td class="num">${(r.rs_rating || 0).toFixed(1)}</td>
					<td><span class="badge ${gc ? "gc" : "no"}">${gc ? "Golden ✓" : "Early"}</span></td>
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
					scan_source: "Turnaround",
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

		$tbody.find(".tj-toggle").on("click", (e) => {
			e.preventDefault();
			this._toggle_detail(e.currentTarget.dataset.symbol);
		});
	}

	_toggle_detail(symbol) {
		const $tbody = $(this.page.body).find("#tj-ta-tbody");
		const $row = $tbody.find(`tr[data-symbol="${symbol}"]`).first();
		const $next = $row.next();
		if ($next.hasClass("tj-ta-detail-row")) {
			$next.remove();
			return;
		}
		const r = (this.results || []).find((x) => x.symbol === symbol);
		if (!r) return;
		const t = this._extract(r);
		const checks = t.checks || {};
		const labels = {
			beaten_down: "≥ 25% below 52w high",
			lifted_off_low: "≥ 20% above 52w low",
			reclaimed_trend: "Price > 50 & 200-DMA",
			downtrend_ending: "200-DMA flat / rising",
			was_laggard: "12m return < 25% (laggard)",
			momentum_turn: "3m return ≥ 10%",
			rs_recovering: "RS Rating ≥ 45",
		};
		const items = Object.keys(labels).map((k) => {
			const ok = !!checks[k];
			return `<div class="tj-crit ${ok ? "ok" : "no"}">${ok ? "✓" : "✗"} ${labels[k]}</div>`;
		}).join("");
		let trendPassed = 0;
		try { trendPassed = JSON.parse(r.criteria_json || "{}").trend_template_passed || 0; } catch (e) {}
		$row.after(`
			<tr class="tj-ta-detail-row">
				<td colspan="12">
					<div style="font-size:11px; color:#64748b; font-weight:700; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">Turnaround Checks</div>
					<div class="tj-ta-crit-grid">${items}</div>
					<div style="display:flex; gap:32px; flex-wrap:wrap; align-items:center;">
						<div>
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Returns 3M / 6M / 12M</div>
							<div style="font-size:15px; font-weight:800;">+${(t.ret_3m_pct || 0).toFixed(1)}% &nbsp;/&nbsp; ${(t.ret_6m_pct || 0).toFixed(1)}% &nbsp;/&nbsp; ${(t.ret_12m_pct || 0).toFixed(1)}%</div>
						</div>
						<div>
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Volume (10d/20d)</div>
							<div style="font-size:15px; font-weight:800; color:${t.volume_expansion ? '#10b981' : '#94a3b8'};">${(t.vol_ratio_10_20 || 0).toFixed(2)}× ${t.volume_expansion ? '(expanding ✓)' : ''}</div>
						</div>
						<div>
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Trend Template</div>
							<div style="font-size:15px; font-weight:800;">${trendPassed}/8 rules</div>
						</div>
						<div style="flex:1; min-width:200px;">
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Reason</div>
							<div style="font-size:13px; color:#475569;">${frappe.utils.escape_html(t.reason || "—")}</div>
						</div>
					</div>
				</td>
			</tr>
		`);
	}
}
