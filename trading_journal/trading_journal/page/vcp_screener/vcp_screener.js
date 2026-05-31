frappe.pages["vcp-screener"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "VCP Screener — Volatility Contraction Pattern",
		single_column: true,
	});
	new VcpScreenerPage(page);
};

class VcpScreenerPage {
	constructor(page) {
		this.page = page;
		this.run_name = null;
		this.poll_timer = null;
		this.max_distance = "";
		this.search = "";
		this.sector = "";
		this._inject_styles();
		this._render_skeleton();
		this._bind_controls();
		this._load_latest();
	}

	_inject_styles() {
		if (document.getElementById("tj-vcp-css")) return;
		const css = `
		.tj-vcp-wrap { padding: 14px; }
		.tj-vcp-hero {
			background: linear-gradient(135deg, #0ea5e9, #10b981);
			border-radius: 12px; padding: 18px 22px; color: #fff;
			margin-bottom: 16px; display: flex; justify-content: space-between;
			align-items: center; flex-wrap: wrap; gap: 14px;
		}
		.tj-vcp-hero h2 { margin: 0; font-size: 20px; font-weight: 800; }
		.tj-vcp-hero .sub { font-size: 12px; opacity: 0.85; margin-top: 4px; }
		.tj-vcp-hero .btn-scan {
			background: #fff; color: #0c4a6e; font-weight: 700;
			padding: 9px 18px; border-radius: 8px; border: 0; cursor: pointer;
			font-size: 13px;
		}
		.tj-vcp-hero .btn-scan:disabled { opacity: 0.6; cursor: not-allowed; }

		.tj-vcp-status {
			background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 14px; font-size: 13px;
			display: flex; gap: 16px; flex-wrap: wrap; align-items: center;
		}
		.tj-vcp-status .pill {
			display: inline-block; padding: 3px 10px; border-radius: 999px;
			font-size: 11px; font-weight: 700; text-transform: uppercase;
			letter-spacing: 0.5px;
		}
		.tj-vcp-status .pill.queued { background: #fef3c7; color: #92400e; }
		.tj-vcp-status .pill.running { background: #dbeafe; color: #1e40af; }
		.tj-vcp-status .pill.completed { background: #d1fae5; color: #065f46; }
		.tj-vcp-status .pill.failed { background: #fee2e2; color: #991b1b; }
		.tj-vcp-status .tj-msg { color: #64748b; flex: 1; background: transparent !important; height: auto !important; overflow: visible !important; display: block !important; }
		.tj-vcp-status .err { color: #991b1b; font-family: monospace; font-size: 11px; white-space: pre-wrap; max-height: 140px; overflow: auto; }

		.tj-vcp-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
		.tj-vcp-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
		.tj-vcp-card .lbl { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
		.tj-vcp-card .val { font-size: 22px; font-weight: 800; margin-top: 4px; color: #0f172a; }

		.tj-vcp-filters {
			display: flex; gap: 14px; flex-wrap: wrap; align-items: end;
			background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 12px;
		}
		.tj-vcp-filters label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; display: block; margin-bottom: 4px; }
		.tj-vcp-filters input, .tj-vcp-filters select {
			border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; font-size: 13px;
			min-width: 140px; background: #fff;
		}

		.tj-vcp-table-wrap { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
		.tj-vcp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
		.tj-vcp-table th {
			background: #f1f5f9; font-size: 10px; font-weight: 700;
			text-transform: uppercase; letter-spacing: 0.5px; color: #475569;
			padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0;
			white-space: nowrap;
		}
		.tj-vcp-table td {
			padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #0f172a;
		}
		.tj-vcp-table tr:hover td { background: #f8fafc; }
		.tj-vcp-table .sym { font-weight: 700; color: #0ea5e9; }
		.tj-vcp-table .sym a { color: inherit; text-decoration: none; }
		.tj-vcp-table .sym a:hover { text-decoration: underline; }
		.tj-vcp-table .num { font-variant-numeric: tabular-nums; text-align: right; }
		.tj-vcp-table .pos { color: #10b981; font-weight: 700; }
		.tj-vcp-table .neg { color: #f43f5e; font-weight: 700; }
		.tj-vcp-table .badge {
			display: inline-block; padding: 2px 8px; border-radius: 999px;
			font-size: 11px; font-weight: 700;
		}
		.tj-vcp-table .badge.tight { background: #d1fae5; color: #065f46; }
		.tj-vcp-table .badge.loose { background: #fef3c7; color: #92400e; }
		.tj-vcp-table .actions a {
			color: #0ea5e9; text-decoration: none; font-weight: 600;
			margin-right: 8px; font-size: 12px;
		}
		.tj-vcp-table .actions a:hover { text-decoration: underline; }
		.tj-vcp-empty { padding: 40px; text-align: center; color: #94a3b8; }

		.tj-vcp-detail-row td { background: #fafbfc; padding: 12px 24px; }
		.tj-vcp-contractions { display: flex; gap: 6px; align-items: end; height: 60px; }
		.tj-vcp-bar {
			background: linear-gradient(180deg, #0ea5e9, #10b981);
			border-radius: 4px 4px 0 0; min-width: 26px; color: #fff;
			font-size: 10px; font-weight: 700; text-align: center;
			padding-top: 4px;
		}
		`;
		const style = document.createElement("style");
		style.id = "tj-vcp-css";
		style.textContent = css;
		document.head.appendChild(style);
	}

	_render_skeleton() {
		const $body = $(this.page.body).empty();
		$body.append(`
			<div class="tj-vcp-wrap">
				<div class="tj-vcp-hero">
					<div>
						<h2>VCP Scanner — Nifty 500</h2>
						<div class="sub">Tightening Volatility Contraction Patterns near the pivot. Daily candles via Yahoo Finance.</div>
					</div>
					<div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
						<span id="tj-vcp-snap-info" style="color:rgba(255,255,255,0.85); font-size:11px;"></span>
						<button class="btn-scan" id="tj-vcp-snap-refresh" style="background:rgba(255,255,255,0.15); color:#fff; border:1px solid rgba(255,255,255,0.4);">↻ Refresh Snapshot</button>
						<button class="btn-scan" id="tj-vcp-run-all" style="background:#10b981;color:#fff;">Run All 7 Scans</button>
						<button class="btn-scan" id="tj-vcp-run">Run This Scan</button>
					</div>
				</div>
				<div class="tj-vcp-status" id="tj-vcp-status" style="display: none;"></div>
				<div class="tj-vcp-summary" id="tj-vcp-summary"></div>
				<div class="tj-vcp-filters">
					<div>
						<label>Max Distance from Pivot</label>
						<select id="tj-vcp-max-dist">
							<option value="" selected>All (no filter)</option>
							<option value="3">≤ 3% (very tight)</option>
							<option value="5">≤ 5%</option>
							<option value="8">≤ 8% (default)</option>
						</select>
					</div>
					<div>
						<label>Sector</label>
						<select id="tj-vcp-sector"><option value="">All Sectors</option></select>
					</div>
					<div>
						<label>Search Symbol</label>
						<input type="text" id="tj-vcp-search" placeholder="e.g. TATAMOTORS">
					</div>
				</div>
				<div class="tj-vcp-table-wrap">
					<table class="tj-vcp-table" id="tj-vcp-table">
						<thead>
							<tr>
								<th>#</th>
								<th>Symbol</th>
								<th>Company</th>
								<th>Sector</th>
								<th class="num">Price ₹</th>
								<th class="num">Final Tightness</th>
								<th class="num">Trend Score</th>
								<th class="num">RS</th>
								<th class="num">From 52w High</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody id="tj-vcp-tbody">
							<tr><td colspan="10" class="tj-vcp-empty">Loading…</td></tr>
						</tbody>
					</table>
				</div>
			</div>
		`);
	}

	_bind_controls() {
		const $body = $(this.page.body);
		$body.find("#tj-vcp-run").on("click", () => this._start_scan());
		$body.find("#tj-vcp-run-all").on("click", () => this._start_all_scans());
		$body.find("#tj-vcp-snap-refresh").on("click", () => this._refresh_snapshot());
		$body.find("#tj-vcp-max-dist").on("change", (e) => {
			this.max_distance = e.target.value === "" ? "" : parseInt(e.target.value, 10);
			this._render_results();
		});
		$body.find("#tj-vcp-search").on("input", (e) => {
			this.search = (e.target.value || "").trim().toUpperCase();
			this._render_results();
		});
		$body.find("#tj-vcp-sector").on("change", (e) => {
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
				const $info = $(this.page.body).find("#tj-vcp-snap-info");
				$info.text(m.latest_snapshot_date ? "Snapshot: " + m.latest_snapshot_date : "No snapshot yet");
				if ((m.refresh || {}).running) {
					$info.text("Refreshing snapshot…");
					setTimeout(() => this._update_snap_info(), 4000);
				}
			},
		});
	}

	_refresh_snapshot() {
		const $btn = $(this.page.body).find("#tj-vcp-snap-refresh");
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
			args: { scan_type: "VCP" },
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok || !m.name) {
					this._render_empty("No completed VCP scan yet. Click \"Run Fresh Scan\".");
					return;
				}
				this.run_name = m.name;
				this._absorb_status(m);
			},
		});
	}

	_start_scan() {
		const $body = $(this.page.body);
		$body.find("#tj-vcp-run").prop("disabled", true).text("Queued…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.start_scan",
			args: { scan_type: "VCP" },
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok) {
					frappe.msgprint({ title: "Could not start scan", message: m.error || "Unknown error", indicator: "red" });
					$body.find("#tj-vcp-run").prop("disabled", false).text("Run This Scan");
					return;
				}
				this.run_name = m.run_name;
				this._poll_status();
			},
			error: () => {
				$body.find("#tj-vcp-run").prop("disabled", false).text("Run This Scan");
			},
		});
	}

	_start_all_scans() {
		const $body = $(this.page.body);
		const $btnAll = $body.find("#tj-vcp-run-all");
		$btnAll.prop("disabled", true).text("Queued…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.start_all_scans",
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok) {
					frappe.msgprint({ title: "Could not start scans", message: m.error || "Unknown error", indicator: "red" });
					$btnAll.prop("disabled", false).text("Run All 7 Scans");
					return;
				}
				const myRun = (m.run_names || {})["VCP"];
				if (myRun) this.run_name = myRun;
				frappe.show_alert({
					message: "Started all 7 scans (single shared fetch ~10 min).",
					indicator: "green",
				}, 6);
				this._poll_status();
			},
			error: () => {
				$btnAll.prop("disabled", false).text("Run All 7 Scans");
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
						$b.find("#tj-vcp-run").prop("disabled", false).text("Run This Scan");
						$b.find("#tj-vcp-run-all").prop("disabled", false).text("Run All 7 Scans");
					}
				},
			});
		};
		tick();
	}

	_absorb_status(m) {
		this.last_status = m;
		const $body = $(this.page.body);
		const $st = $body.find("#tj-vcp-status");
		$st.show();
		const cls = (m.status || "").toLowerCase();
		const errBlock = m.error
			? `<div class="err">${frappe.utils.escape_html(m.error).slice(0, 1500)}</div>`
			: "";
		$st.html(`
			<span class="pill ${cls}">${m.status || "—"}</span>
			<div class="tj-msg">${frappe.utils.escape_html(m.progress || "")}</div>
			<div>Scanned: <b>${m.total_scanned || 0}</b> · VCP found: <b>${m.passed_count || 0}</b></div>
			${m.completed_at ? `<div style="font-size:11px; color:#94a3b8;">Last scan: ${frappe.datetime.str_to_user(m.completed_at)}</div>` : ""}
			${errBlock}
		`);
		this.results = m.results || [];
		this._render_summary();
		this._render_results();
	}

	_render_empty(msg) {
		const $body = $(this.page.body);
		$body.find("#tj-vcp-tbody").html(
			`<tr><td colspan="10" class="tj-vcp-empty">${frappe.utils.escape_html(msg)}</td></tr>`
		);
		$body.find("#tj-vcp-summary").empty();
	}

	_extract_vcp(r) {
		try {
			const parsed = JSON.parse(r.criteria_json || "{}");
			return parsed.vcp || {};
		} catch (e) {
			return {};
		}
	}

	_render_summary() {
		const all = this.results || [];
		const veryTight = all.filter((r) => (r.vcp_tightness || 0) <= 8).length;
		const trendAlso = all.filter((r) => {
			try {
				const p = JSON.parse(r.criteria_json || "{}");
				return (p.trend_template_passed || 0) >= 7;
			} catch (e) { return false; }
		}).length;
		const avgRs = all.length
			? (all.reduce((s, r) => s + (r.rs_rating || 0), 0) / all.length).toFixed(1)
			: "—";
		$(this.page.body).find("#tj-vcp-summary").html(`
			<div class="tj-vcp-card"><div class="lbl">Total VCP Setups</div><div class="val">${all.length}</div></div>
			<div class="tj-vcp-card"><div class="lbl">Tight (≤ 8%)</div><div class="val">${veryTight}</div></div>
			<div class="tj-vcp-card"><div class="lbl">Also Trend ≥ 7/8</div><div class="val">${trendAlso}</div></div>
			<div class="tj-vcp-card"><div class="lbl">Avg RS Rating</div><div class="val">${avgRs}</div></div>
		`);
	}

	_industry_for(r) {
		if (r.industry) return r.industry;
		try { return JSON.parse(r.criteria_json || "{}").industry || ""; } catch (e) { return ""; }
	}

	_populate_sector_dropdown() {
		const $sel = $(this.page.body).find("#tj-vcp-sector");
		const inds = Array.from(new Set((this.results || []).map((r) => this._industry_for(r)).filter(Boolean))).sort();
		const cur = $sel.val();
		$sel.empty().append('<option value="">All Sectors</option>');
		inds.forEach((s) => $sel.append(`<option value="${frappe.utils.escape_html(s)}">${frappe.utils.escape_html(s)}</option>`));
		if (cur && inds.includes(cur)) $sel.val(cur);
	}

	_render_results() {
		this._populate_sector_dropdown();
		const $tbody = $(this.page.body).find("#tj-vcp-tbody");
		const search = this.search;
		const sector = this.sector;
		const filtered = (this.results || []).filter((r) => {
			const v = this._extract_vcp(r);
			if (this.max_distance !== "" && (v.distance_from_pivot_pct || 0) > this.max_distance) return false;
			if (search && !(r.symbol || "").toUpperCase().includes(search)) return false;
			if (sector && this._industry_for(r) !== sector) return false;
			return true;
		});
		if (!filtered.length) {
			$tbody.html(`<tr><td colspan="10" class="tj-vcp-empty">No symbols match the current filters.</td></tr>`);
			return;
		}
		const rows = filtered.map((r, i) => {
			let trendPassed = 0;
			try {
				trendPassed = JSON.parse(r.criteria_json || "{}").trend_template_passed || 0;
			} catch (e) {}
			const v = this._extract_vcp(r);
			const tight = (r.vcp_tightness || 0);
			const cls = tight <= 8 ? "tight" : "loose";
			const sym = r.symbol;
			const fromHi = (r.pct_from_52w_high || 0).toFixed(2);
			const ind = this._industry_for(r);
			return `
				<tr data-symbol="${sym}">
					<td>${i + 1}</td>
					<td class="sym"><a href="#" class="tj-toggle" data-symbol="${sym}">${sym}</a></td>
					<td>${frappe.utils.escape_html(r.company_name || "")}</td>
					<td style="font-size:11px; color:#64748b;">${frappe.utils.escape_html(ind || "—")}</td>
					<td class="num">${frappe.format(r.current_price || 0, { fieldtype: "Currency", options: "INR" })}</td>
					<td class="num"><span class="badge ${cls}">${tight.toFixed(2)}%</span></td>
					<td class="num">${trendPassed}/8</td>
					<td class="num">${(r.rs_rating || 0).toFixed(1)}</td>
					<td class="num neg">${fromHi}%</td>
					<td class="actions">
						<a href="#" class="tj-watch" data-symbol="${sym}" data-company="${frappe.utils.escape_html(r.company_name || '')}" data-pivot="${(v.pivot || r.current_price || '')}">+ Watch</a>
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
					scan_source: "VCP",
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
		const $tbody = $(this.page.body).find("#tj-vcp-tbody");
		const $row = $tbody.find(`tr[data-symbol="${symbol}"]`).first();
		const $next = $row.next();
		if ($next.hasClass("tj-vcp-detail-row")) {
			$next.remove();
			return;
		}
		const r = (this.results || []).find((x) => x.symbol === symbol);
		if (!r) return;
		const v = this._extract_vcp(r);
		const contractions = v.contractions || [];
		const maxDepth = Math.max(...contractions.map((c) => c.depth_pct), 1);
		const bars = contractions.map((c) => {
			const h = Math.max(8, (c.depth_pct / maxDepth) * 60);
			return `<div class="tj-vcp-bar" style="height:${h}px;">${c.depth_pct}%</div>`;
		}).join("");
		$row.after(`
			<tr class="tj-vcp-detail-row">
				<td colspan="10">
					<div style="display:flex; gap:32px; flex-wrap:wrap; align-items:center;">
						<div>
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Contractions</div>
							<div class="tj-vcp-contractions">${bars || '<span style="color:#94a3b8;">none</span>'}</div>
						</div>
						<div>
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Pivot</div>
							<div style="font-size:18px; font-weight:800;">₹${(v.pivot || 0).toFixed(2)}</div>
						</div>
						<div>
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Distance from Pivot</div>
							<div style="font-size:18px; font-weight:800;">${(v.distance_from_pivot_pct || 0).toFixed(2)}%</div>
						</div>
						<div>
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Volume Dry-Up</div>
							<div style="font-size:14px; font-weight:700; color:${v.volume_dry_up ? '#10b981' : '#94a3b8'};">${v.volume_dry_up ? '✓ Yes' : '✗ No'}</div>
						</div>
						<div style="flex:1; min-width:240px;">
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Reason</div>
							<div style="font-size:13px; color:#475569;">${frappe.utils.escape_html(v.reason || "—")}</div>
						</div>
					</div>
				</td>
			</tr>
		`);
	}
}
