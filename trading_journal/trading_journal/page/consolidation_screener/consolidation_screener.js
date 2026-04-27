frappe.pages["consolidation-screener"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Tight Consolidation Screener — 1-Month Bases",
		single_column: true,
	});
	new ConsolidationScreenerPage(page);
};

class ConsolidationScreenerPage {
	constructor(page) {
		this.page = page;
		this.run_name = null;
		this.poll_timer = null;
		this.max_range = 8;
		this.search = "";
		this.sector = "";
		this._inject_styles();
		this._render_skeleton();
		this._bind_controls();
		this._load_latest();
	}

	_inject_styles() {
		if (document.getElementById("tj-cons-css")) return;
		const css = `
		.tj-cons-wrap { padding: 14px; }
		.tj-cons-hero {
			background: linear-gradient(135deg, #f59e0b, #ef4444);
			border-radius: 12px; padding: 18px 22px; color: #fff;
			margin-bottom: 16px; display: flex; justify-content: space-between;
			align-items: center; flex-wrap: wrap; gap: 14px;
		}
		.tj-cons-hero h2 { margin: 0; font-size: 20px; font-weight: 800; }
		.tj-cons-hero .sub { font-size: 12px; opacity: 0.85; margin-top: 4px; }
		.tj-cons-hero .btn-scan {
			background: #fff; color: #7c2d12; font-weight: 700;
			padding: 9px 18px; border-radius: 8px; border: 0; cursor: pointer;
			font-size: 13px;
		}
		.tj-cons-hero .btn-scan:disabled { opacity: 0.6; cursor: not-allowed; }

		.tj-cons-status {
			background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 14px; font-size: 13px;
			display: flex; gap: 16px; flex-wrap: wrap; align-items: center;
		}
		.tj-cons-status .pill {
			display: inline-block; padding: 3px 10px; border-radius: 999px;
			font-size: 11px; font-weight: 700; text-transform: uppercase;
			letter-spacing: 0.5px;
		}
		.tj-cons-status .pill.queued { background: #fef3c7; color: #92400e; }
		.tj-cons-status .pill.running { background: #dbeafe; color: #1e40af; }
		.tj-cons-status .pill.completed { background: #d1fae5; color: #065f46; }
		.tj-cons-status .pill.failed { background: #fee2e2; color: #991b1b; }
		.tj-cons-status .tj-msg { color: #64748b; flex: 1; background: transparent !important; height: auto !important; overflow: visible !important; display: block !important; }
		.tj-cons-status .err { color: #991b1b; font-family: monospace; font-size: 11px; white-space: pre-wrap; max-height: 140px; overflow: auto; }

		.tj-cons-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
		.tj-cons-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
		.tj-cons-card .lbl { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
		.tj-cons-card .val { font-size: 22px; font-weight: 800; margin-top: 4px; color: #0f172a; }

		.tj-cons-filters {
			display: flex; gap: 14px; flex-wrap: wrap; align-items: end;
			background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 12px;
		}
		.tj-cons-filters label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; display: block; margin-bottom: 4px; }
		.tj-cons-filters input, .tj-cons-filters select {
			border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; font-size: 13px;
			min-width: 140px; background: #fff;
		}

		.tj-cons-table-wrap { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
		.tj-cons-table { width: 100%; border-collapse: collapse; font-size: 13px; }
		.tj-cons-table th {
			background: #f1f5f9; font-size: 10px; font-weight: 700;
			text-transform: uppercase; letter-spacing: 0.5px; color: #475569;
			padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0;
			white-space: nowrap;
		}
		.tj-cons-table td {
			padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #0f172a;
		}
		.tj-cons-table tr:hover td { background: #f8fafc; }
		.tj-cons-table .sym { font-weight: 700; color: #f59e0b; }
		.tj-cons-table .sym a { color: inherit; text-decoration: none; }
		.tj-cons-table .sym a:hover { text-decoration: underline; }
		.tj-cons-table .num { font-variant-numeric: tabular-nums; text-align: right; }
		.tj-cons-table .pos { color: #10b981; font-weight: 700; }
		.tj-cons-table .neg { color: #f43f5e; font-weight: 700; }
		.tj-cons-table .badge {
			display: inline-block; padding: 2px 8px; border-radius: 999px;
			font-size: 11px; font-weight: 700;
		}
		.tj-cons-table .badge.tight { background: #d1fae5; color: #065f46; }
		.tj-cons-table .badge.loose { background: #fef3c7; color: #92400e; }
		.tj-cons-table .actions a {
			color: #f59e0b; text-decoration: none; font-weight: 600;
			margin-right: 8px; font-size: 12px;
		}
		.tj-cons-table .actions a:hover { text-decoration: underline; }
		.tj-cons-empty { padding: 40px; text-align: center; color: #94a3b8; }

		.tj-cons-detail-row td { background: #fafbfc; padding: 12px 24px; }
		`;
		const style = document.createElement("style");
		style.id = "tj-cons-css";
		style.textContent = css;
		document.head.appendChild(style);
	}

	_render_skeleton() {
		const $body = $(this.page.body).empty();
		$body.append(`
			<div class="tj-cons-wrap">
				<div class="tj-cons-hero">
					<div>
						<h2>Tight Consolidation — Nifty 500</h2>
						<div class="sub">1-month range ≤ 8% in a clean uptrend, with volume drying up. Pre-breakout setups.</div>
					</div>
					<div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
						<span id="tj-cons-snap-info" style="color:rgba(255,255,255,0.85); font-size:11px;"></span>
						<button class="btn-scan" id="tj-cons-snap-refresh" style="background:rgba(255,255,255,0.15); color:#fff; border:1px solid rgba(255,255,255,0.4);">↻ Refresh Snapshot</button>
						<button class="btn-scan" id="tj-cons-run-all" style="background:#10b981;color:#fff;">Run All 3 Scans</button>
						<button class="btn-scan" id="tj-cons-run">Run This Scan</button>
					</div>
				</div>
				<div class="tj-cons-status" id="tj-cons-status" style="display: none;"></div>
				<div class="tj-cons-summary" id="tj-cons-summary"></div>
				<div class="tj-cons-filters">
					<div>
						<label>Max 1-Month Range</label>
						<select id="tj-cons-max-range">
							<option value="3">≤ 3% (very tight)</option>
							<option value="5">≤ 5%</option>
							<option value="8" selected>≤ 8% (default)</option>
						</select>
					</div>
					<div>
						<label>Sector</label>
						<select id="tj-cons-sector"><option value="">All Sectors</option></select>
					</div>
					<div>
						<label>Search Symbol</label>
						<input type="text" id="tj-cons-search" placeholder="e.g. TATAMOTORS">
					</div>
				</div>
				<div class="tj-cons-table-wrap">
					<table class="tj-cons-table" id="tj-cons-table">
						<thead>
							<tr>
								<th>#</th>
								<th>Symbol</th>
								<th>Company</th>
								<th>Sector</th>
								<th class="num">Price ₹</th>
								<th class="num">1M Range</th>
								<th class="num">From Range High</th>
								<th class="num">Vol Ratio</th>
								<th class="num">Trend Score</th>
								<th class="num">RS</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody id="tj-cons-tbody">
							<tr><td colspan="11" class="tj-cons-empty">Loading…</td></tr>
						</tbody>
					</table>
				</div>
			</div>
		`);
	}

	_bind_controls() {
		const $body = $(this.page.body);
		$body.find("#tj-cons-run").on("click", () => this._start_scan());
		$body.find("#tj-cons-run-all").on("click", () => this._start_all_scans());
		$body.find("#tj-cons-snap-refresh").on("click", () => this._refresh_snapshot());
		$body.find("#tj-cons-max-range").on("change", (e) => {
			this.max_range = parseFloat(e.target.value);
			this._render_results();
		});
		$body.find("#tj-cons-search").on("input", (e) => {
			this.search = (e.target.value || "").trim().toUpperCase();
			this._render_results();
		});
		$body.find("#tj-cons-sector").on("change", (e) => {
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
				const $info = $(this.page.body).find("#tj-cons-snap-info");
				$info.text(m.latest_snapshot_date ? "Snapshot: " + m.latest_snapshot_date : "No snapshot yet");
				if ((m.refresh || {}).running) {
					$info.text("Refreshing snapshot…");
					setTimeout(() => this._update_snap_info(), 4000);
				}
			},
		});
	}

	_refresh_snapshot() {
		const $btn = $(this.page.body).find("#tj-cons-snap-refresh");
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
			args: { scan_type: "Tight Consolidation" },
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok || !m.name) {
					this._render_empty("No completed Tight Consolidation scan yet. Click \"Run Fresh Scan\".");
					return;
				}
				this.run_name = m.name;
				this._absorb_status(m);
			},
		});
	}

	_start_scan() {
		const $body = $(this.page.body);
		$body.find("#tj-cons-run").prop("disabled", true).text("Queued…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.start_scan",
			args: { scan_type: "Tight Consolidation" },
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok) {
					frappe.msgprint({ title: "Could not start scan", message: m.error || "Unknown error", indicator: "red" });
					$body.find("#tj-cons-run").prop("disabled", false).text("Run This Scan");
					return;
				}
				this.run_name = m.run_name;
				this._poll_status();
			},
			error: () => {
				$body.find("#tj-cons-run").prop("disabled", false).text("Run This Scan");
			},
		});
	}

	_start_all_scans() {
		const $body = $(this.page.body);
		const $btnAll = $body.find("#tj-cons-run-all");
		$btnAll.prop("disabled", true).text("Queued…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.start_all_scans",
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok) {
					frappe.msgprint({ title: "Could not start scans", message: m.error || "Unknown error", indicator: "red" });
					$btnAll.prop("disabled", false).text("Run All 3 Scans");
					return;
				}
				const myRun = (m.run_names || {})["Tight Consolidation"];
				if (myRun) this.run_name = myRun;
				frappe.show_alert({
					message: "Started all 3 scans (single shared fetch ~10 min).",
					indicator: "green",
				}, 6);
				this._poll_status();
			},
			error: () => {
				$btnAll.prop("disabled", false).text("Run All 3 Scans");
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
						$b.find("#tj-cons-run").prop("disabled", false).text("Run This Scan");
						$b.find("#tj-cons-run-all").prop("disabled", false).text("Run All 3 Scans");
					}
				},
			});
		};
		tick();
	}

	_absorb_status(m) {
		this.last_status = m;
		const $body = $(this.page.body);
		const $st = $body.find("#tj-cons-status");
		$st.show();
		const cls = (m.status || "").toLowerCase();
		const errBlock = m.error
			? `<div class="err">${frappe.utils.escape_html(m.error).slice(0, 1500)}</div>`
			: "";
		$st.html(`
			<span class="pill ${cls}">${m.status || "—"}</span>
			<div class="tj-msg">${frappe.utils.escape_html(m.progress || "")}</div>
			<div>Scanned: <b>${m.total_scanned || 0}</b> · Tight bases: <b>${m.passed_count || 0}</b></div>
			${m.completed_at ? `<div style="font-size:11px; color:#94a3b8;">Last scan: ${frappe.datetime.str_to_user(m.completed_at)}</div>` : ""}
			${errBlock}
		`);
		this.results = m.results || [];
		this._render_summary();
		this._render_results();
	}

	_render_empty(msg) {
		const $body = $(this.page.body);
		$body.find("#tj-cons-tbody").html(
			`<tr><td colspan="11" class="tj-cons-empty">${frappe.utils.escape_html(msg)}</td></tr>`
		);
		$body.find("#tj-cons-summary").empty();
	}

	_extract(r) {
		try {
			const parsed = JSON.parse(r.criteria_json || "{}");
			return parsed.tight_consolidation || {};
		} catch (e) { return {}; }
	}

	_render_summary() {
		const all = this.results || [];
		const veryTight = all.filter((r) => (r.vcp_tightness || 0) <= 5).length;
		const dryUp = all.filter((r) => this._extract(r).volume_dry_up).length;
		const trendAlso = all.filter((r) => {
			try {
				const p = JSON.parse(r.criteria_json || "{}");
				return (p.trend_template_passed || 0) >= 7;
			} catch (e) { return false; }
		}).length;
		$(this.page.body).find("#tj-cons-summary").html(`
			<div class="tj-cons-card"><div class="lbl">Total Tight Bases</div><div class="val">${all.length}</div></div>
			<div class="tj-cons-card"><div class="lbl">Very Tight (≤ 5%)</div><div class="val">${veryTight}</div></div>
			<div class="tj-cons-card"><div class="lbl">With Volume Dry-Up</div><div class="val">${dryUp}</div></div>
			<div class="tj-cons-card"><div class="lbl">Also Trend ≥ 7/8</div><div class="val">${trendAlso}</div></div>
		`);
	}

	_industry_for(r) {
		if (r.industry) return r.industry;
		try { return JSON.parse(r.criteria_json || "{}").industry || ""; } catch (e) { return ""; }
	}

	_populate_sector_dropdown() {
		const $sel = $(this.page.body).find("#tj-cons-sector");
		const inds = Array.from(new Set((this.results || []).map((r) => this._industry_for(r)).filter(Boolean))).sort();
		const cur = $sel.val();
		$sel.empty().append('<option value="">All Sectors</option>');
		inds.forEach((s) => $sel.append(`<option value="${frappe.utils.escape_html(s)}">${frappe.utils.escape_html(s)}</option>`));
		if (cur && inds.includes(cur)) $sel.val(cur);
	}

	_render_results() {
		this._populate_sector_dropdown();
		const $tbody = $(this.page.body).find("#tj-cons-tbody");
		const search = this.search;
		const sector = this.sector;
		const filtered = (this.results || []).filter((r) => {
			if ((r.vcp_tightness || 0) > this.max_range) return false;
			if (search && !(r.symbol || "").toUpperCase().includes(search)) return false;
			if (sector && this._industry_for(r) !== sector) return false;
			return true;
		});
		if (!filtered.length) {
			$tbody.html(`<tr><td colspan="11" class="tj-cons-empty">No symbols match the current filters.</td></tr>`);
			return;
		}
		const rows = filtered.map((r, i) => {
			const t = this._extract(r);
			let trendPassed = 0;
			try {
				trendPassed = JSON.parse(r.criteria_json || "{}").trend_template_passed || 0;
			} catch (e) {}
			const range = (r.vcp_tightness || 0);
			const cls = range <= 5 ? "tight" : "loose";
			const sym = r.symbol;
			const fromHi = (t.distance_from_range_high_pct || 0).toFixed(2);
			const volR = (t.volume_ratio || 0).toFixed(2);
			const ind = this._industry_for(r);
			return `
				<tr data-symbol="${sym}">
					<td>${i + 1}</td>
					<td class="sym"><a href="#" class="tj-toggle" data-symbol="${sym}">${sym}</a></td>
					<td>${frappe.utils.escape_html(r.company_name || "")}</td>
					<td style="font-size:11px; color:#64748b;">${frappe.utils.escape_html(ind || "—")}</td>
					<td class="num">${frappe.format(r.current_price || 0, { fieldtype: "Currency", options: "INR" })}</td>
					<td class="num"><span class="badge ${cls}">${range.toFixed(2)}%</span></td>
					<td class="num neg">${fromHi}%</td>
					<td class="num ${t.volume_dry_up ? 'pos' : ''}">${volR}</td>
					<td class="num">${trendPassed}/8</td>
					<td class="num">${(r.rs_rating || 0).toFixed(1)}</td>
					<td class="actions">
						<a href="#" class="tj-watch" data-symbol="${sym}" data-company="${frappe.utils.escape_html(r.company_name || '')}" data-pivot="${(t.range_high || r.current_price || '')}">+ Watch</a>
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
					scan_source: "Tight Consolidation",
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
		const $tbody = $(this.page.body).find("#tj-cons-tbody");
		const $row = $tbody.find(`tr[data-symbol="${symbol}"]`).first();
		const $next = $row.next();
		if ($next.hasClass("tj-cons-detail-row")) {
			$next.remove();
			return;
		}
		const r = (this.results || []).find((x) => x.symbol === symbol);
		if (!r) return;
		const t = this._extract(r);
		$row.after(`
			<tr class="tj-cons-detail-row">
				<td colspan="11">
					<div style="display:flex; gap:32px; flex-wrap:wrap; align-items:center;">
						<div>
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Range (${t.window_days || 22}d)</div>
							<div style="font-size:18px; font-weight:800;">₹${(t.range_low || 0).toFixed(2)} – ₹${(t.range_high || 0).toFixed(2)}</div>
						</div>
						<div>
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Range Width</div>
							<div style="font-size:18px; font-weight:800;">${(t.range_pct || 0).toFixed(2)}%</div>
						</div>
						<div>
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">From Range High</div>
							<div style="font-size:18px; font-weight:800;">${(t.distance_from_range_high_pct || 0).toFixed(2)}%</div>
						</div>
						<div>
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Volume Ratio</div>
							<div style="font-size:18px; font-weight:800; color:${t.volume_dry_up ? '#10b981' : '#94a3b8'};">${(t.volume_ratio || 0).toFixed(2)}× ${t.volume_dry_up ? '(dry-up ✓)' : ''}</div>
						</div>
						<div>
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Trend Filter</div>
							<div style="font-size:14px; font-weight:700;">
								<span style="color:${t.price_above_50sma ? '#10b981' : '#94a3b8'};">${t.price_above_50sma ? '✓' : '✗'} > 50 SMA</span> &nbsp;
								<span style="color:${t.sma50_above_sma200 ? '#10b981' : '#94a3b8'};">${t.sma50_above_sma200 ? '✓' : '✗'} 50 > 200 SMA</span>
							</div>
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
