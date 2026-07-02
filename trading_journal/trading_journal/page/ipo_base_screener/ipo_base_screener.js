frappe.pages["ipo-base-screener"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "IPO Base Screener",
		single_column: true,
	});
	new IpoBaseScreenerPage(page);
};

class IpoBaseScreenerPage {
	constructor(page) {
		this.page = page;
		this.run_name = null;
		this.poll_timer = null;
		this.results = [];
		this.universe = "All NSE";
		this.max_depth = "";
		this.max_dist = "";
		this.search = "";
		this.sector = "";
		this._inject_styles();
		this._render_skeleton();
		this._bind_controls();
		this._load_latest();
	}

	_inject_styles() {
		if (document.getElementById("tj-ipo-css")) return;
		const css = `
		.tj-ipo-wrap { padding: 14px; }
		.tj-ipo-hero {
			background: linear-gradient(135deg, #7c3aed, #db2777);
			border-radius: 12px; padding: 18px 22px; color: #fff;
			margin-bottom: 16px; display: flex; justify-content: space-between;
			align-items: center; flex-wrap: wrap; gap: 14px;
		}
		.tj-ipo-hero h2 { margin: 0; font-size: 20px; font-weight: 800; }
		.tj-ipo-hero .sub { font-size: 12px; opacity: 0.85; margin-top: 4px; }
		.tj-ipo-hero .btn-scan {
			background: #fff; color: #4c1d95; font-weight: 700;
			padding: 9px 18px; border-radius: 8px; border: 0; cursor: pointer; font-size: 13px;
		}
		.tj-ipo-hero .btn-scan:disabled { opacity: 0.6; cursor: not-allowed; }

		.tj-ipo-status {
			background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 14px; font-size: 13px;
			display: flex; gap: 16px; flex-wrap: wrap; align-items: center;
		}
		.tj-ipo-status .pill {
			display: inline-block; padding: 3px 10px; border-radius: 999px;
			font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
		}
		.tj-ipo-status .pill.queued { background: #fef3c7; color: #92400e; }
		.tj-ipo-status .pill.running { background: #dbeafe; color: #1e40af; }
		.tj-ipo-status .pill.completed { background: #d1fae5; color: #065f46; }
		.tj-ipo-status .pill.failed { background: #fee2e2; color: #991b1b; }
		.tj-ipo-status .tj-msg { color: #64748b; flex: 1; }
		.tj-ipo-status .err { color: #991b1b; font-family: monospace; font-size: 11px; white-space: pre-wrap; max-height: 120px; overflow: auto; }

		.tj-ipo-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
		.tj-ipo-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
		.tj-ipo-card .lbl { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
		.tj-ipo-card .val { font-size: 22px; font-weight: 800; margin-top: 4px; color: #0f172a; }

		.tj-ipo-filters {
			display: flex; gap: 14px; flex-wrap: wrap; align-items: end;
			background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 12px;
		}
		.tj-ipo-filters label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; display: block; margin-bottom: 4px; }
		.tj-ipo-filters input, .tj-ipo-filters select {
			border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; font-size: 13px;
			min-width: 130px; background: #fff;
		}

		.tj-ipo-table-wrap { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
		.tj-ipo-table { width: 100%; border-collapse: collapse; font-size: 13px; }
		.tj-ipo-table th {
			background: #f1f5f9; font-size: 10px; font-weight: 700;
			text-transform: uppercase; letter-spacing: 0.5px; color: #475569;
			padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; white-space: nowrap;
		}
		.tj-ipo-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #0f172a; }
		.tj-ipo-table tr:hover td { background: #faf5ff; }
		.tj-ipo-table .sym { font-weight: 700; color: #7c3aed; }
		.tj-ipo-table .sym a { color: inherit; text-decoration: none; }
		.tj-ipo-table .sym a:hover { text-decoration: underline; }
		.tj-ipo-table .num { font-variant-numeric: tabular-nums; text-align: right; }
		.tj-ipo-table .pos { color: #10b981; font-weight: 700; }
		.tj-ipo-table .neg { color: #f43f5e; font-weight: 700; }
		.tj-ipo-table .badge {
			display: inline-block; padding: 2px 8px; border-radius: 999px;
			font-size: 11px; font-weight: 700;
		}
		.tj-ipo-table .badge.tight { background: #f3e8ff; color: #6d28d9; }
		.tj-ipo-table .badge.vol { background: #dcfce7; color: #15803d; }
		.tj-ipo-table .actions a {
			color: #7c3aed; text-decoration: none; font-weight: 600;
			margin-right: 8px; font-size: 12px;
		}
		.tj-ipo-table .actions a:hover { text-decoration: underline; }
		.tj-ipo-empty { padding: 40px; text-align: center; color: #94a3b8; }

		.tj-ipo-detail-row td { background: #faf5ff; padding: 12px 24px; }
		`;
		const style = document.createElement("style");
		style.id = "tj-ipo-css";
		style.textContent = css;
		document.head.appendChild(style);
	}

	_render_skeleton() {
		const $body = $(this.page.body).empty();
		$body.append(`
			<div class="tj-ipo-wrap">
				<div class="tj-ipo-hero">
					<div>
						<h2>IPO Base Screener — All NSE</h2>
						<div class="sub">
							Stocks that recently listed, made their initial surge, and are now forming a tight
							consolidation base. Daily candles from NSE bhavcopy snapshot.
						</div>
					</div>
					<div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
						<span id="tj-ipo-snap-info" style="color:rgba(255,255,255,0.85); font-size:11px;"></span>
						<button class="btn-scan" id="tj-ipo-snap-refresh" style="background:rgba(255,255,255,0.15); color:#fff; border:1px solid rgba(255,255,255,0.4);">↻ Refresh Snapshot</button>
						<button class="btn-scan" id="tj-ipo-run">Run Scan</button>
					</div>
				</div>
				<div class="tj-ipo-status" id="tj-ipo-status" style="display:none;"></div>
				<div class="tj-ipo-summary" id="tj-ipo-summary"></div>
				<div class="tj-ipo-filters">
					<div>
						<label>Universe</label>
						<select id="tj-ipo-universe">
							<option value="All NSE" selected>All NSE</option>
							<option value="FnO">F&amp;O</option>
							<option value="Nifty 500">Nifty 500</option>
						</select>
					</div>
					<div>
						<label>Max Base Depth</label>
						<select id="tj-ipo-max-depth">
							<option value="" selected>All (no filter)</option>
							<option value="20">≤ 20%</option>
							<option value="30">≤ 30%</option>
							<option value="40">≤ 40%</option>
						</select>
					</div>
					<div>
						<label>Max Dist. from High</label>
						<select id="tj-ipo-max-dist">
							<option value="" selected>All (no filter)</option>
							<option value="3">≤ 3%</option>
							<option value="5">≤ 5%</option>
							<option value="10">≤ 10%</option>
						</select>
					</div>
					<div>
						<label>Sector</label>
						<select id="tj-ipo-sector"><option value="">All Sectors</option></select>
					</div>
					<div>
						<label>Search Symbol</label>
						<input type="text" id="tj-ipo-search" placeholder="e.g. SWIGGY">
					</div>
				</div>
				<div class="tj-ipo-table-wrap">
					<table class="tj-ipo-table" id="tj-ipo-table">
						<thead>
							<tr>
								<th>#</th>
								<th>Symbol</th>
								<th>Company</th>
								<th>Sector</th>
								<th class="num">Price ₹</th>
								<th class="num">IPO Surge</th>
								<th class="num">Base Depth</th>
								<th class="num">Dist. from High</th>
								<th class="num">Recent Range</th>
								<th class="num">RS</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody id="tj-ipo-tbody">
							<tr><td colspan="11" class="tj-ipo-empty">Loading…</td></tr>
						</tbody>
					</table>
				</div>
			</div>
		`);
	}

	_bind_controls() {
		const $body = $(this.page.body);
		$body.find("#tj-ipo-run").on("click", () => this._start_scan());
		$body.find("#tj-ipo-snap-refresh").on("click", () => this._refresh_snapshot());
		$body.find("#tj-ipo-universe").on("change", (e) => {
			this.universe = e.target.value || "All NSE";
		});
		$body.find("#tj-ipo-max-depth").on("change", (e) => {
			this.max_depth = e.target.value === "" ? "" : parseFloat(e.target.value);
			this._render_results();
		});
		$body.find("#tj-ipo-max-dist").on("change", (e) => {
			this.max_dist = e.target.value === "" ? "" : parseFloat(e.target.value);
			this._render_results();
		});
		$body.find("#tj-ipo-search").on("input", (e) => {
			this.search = (e.target.value || "").trim().toUpperCase();
			this._render_results();
		});
		$body.find("#tj-ipo-sector").on("change", (e) => {
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
				const $info = $(this.page.body).find("#tj-ipo-snap-info");
				$info.text(m.latest_snapshot_date ? "Snapshot: " + m.latest_snapshot_date : "No snapshot yet");
				if ((m.refresh || {}).running) {
					$info.text("Refreshing snapshot…");
					setTimeout(() => this._update_snap_info(), 4000);
				}
			},
		});
	}

	_refresh_snapshot() {
		const $btn = $(this.page.body).find("#tj-ipo-snap-refresh");
		$btn.prop("disabled", true).text("Refreshing…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.refresh_snapshot_now",
			args: { force: 1 },
			callback: () => {
				frappe.show_alert({ message: "Snapshot refresh queued.", indicator: "blue" }, 4);
				$btn.prop("disabled", false).text("↻ Refresh Snapshot");
				this._update_snap_info();
			},
			error: () => $btn.prop("disabled", false).text("↻ Refresh Snapshot"),
		});
	}

	_load_latest() {
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.latest_run",
			args: { scan_type: "IPO Base" },
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok || !m.name) {
					this._render_empty("No completed IPO Base scan yet. Click \"Run Scan\".");
					return;
				}
				this.run_name = m.name;
				this._absorb_status(m);
			},
		});
	}

	_start_scan() {
		const $body = $(this.page.body);
		$body.find("#tj-ipo-run").prop("disabled", true).text("Queued…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.start_scan",
			args: { scan_type: "IPO Base", universe: this.universe },
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok) {
					frappe.msgprint({ title: "Error", message: m.error || "Failed", indicator: "red" });
					$body.find("#tj-ipo-run").prop("disabled", false).text("Run Scan");
					return;
				}
				this.run_name = m.run_name;
				this._poll_status();
			},
			error: () => $body.find("#tj-ipo-run").prop("disabled", false).text("Run Scan"),
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
						$(this.page.body).find("#tj-ipo-run").prop("disabled", false).text("Run Scan");
					}
				},
			});
		};
		tick();
	}

	_absorb_status(m) {
		const $body = $(this.page.body);
		const $st = $body.find("#tj-ipo-status");
		$st.show();
		const cls = (m.status || "").toLowerCase();
		const errBlock = m.error
			? `<div class="err">${frappe.utils.escape_html(m.error).slice(0, 1500)}</div>`
			: "";
		$st.html(`
			<span class="pill ${cls}">${m.status || "—"}</span>
			<div class="tj-msg">${frappe.utils.escape_html(m.progress || "")}</div>
			<div>Scanned: <b>${m.total_scanned || 0}</b> · Found: <b>${m.passed_count || 0}</b></div>
			${m.completed_at ? `<div style="font-size:11px; color:#94a3b8;">Last scan: ${frappe.datetime.str_to_user(m.completed_at)}</div>` : ""}
			${errBlock}
		`);
		this.results = m.results || [];
		this._render_summary();
		this._render_results();
	}

	_render_empty(msg) {
		$(this.page.body).find("#tj-ipo-tbody").html(
			`<tr><td colspan="11" class="tj-ipo-empty">${frappe.utils.escape_html(msg)}</td></tr>`
		);
		$(this.page.body).find("#tj-ipo-summary").empty();
	}

	_ipo(r) {
		try { return JSON.parse(r.criteria_json || "{}").ipo_base || {}; }
		catch (e) { return {}; }
	}

	_industry_for(r) {
		if (r.industry) return r.industry;
		try { return JSON.parse(r.criteria_json || "{}").industry || ""; }
		catch (e) { return ""; }
	}

	_render_summary() {
		const all = this.results || [];
		const very_tight = all.filter((r) => (this._ipo(r).distance_from_high_pct || 99) <= 5).length;
		const vol_dry = all.filter((r) => this._ipo(r).vol_dry_up).length;
		const avg_surge = all.length
			? (all.reduce((s, r) => s + (this._ipo(r).ipo_surge_pct || 0), 0) / all.length).toFixed(1)
			: "—";
		$(this.page.body).find("#tj-ipo-summary").html(`
			<div class="tj-ipo-card"><div class="lbl">Total IPO Bases</div><div class="val">${all.length}</div></div>
			<div class="tj-ipo-card"><div class="lbl">Within 5% of High</div><div class="val">${very_tight}</div></div>
			<div class="tj-ipo-card"><div class="lbl">Vol Dry-Up</div><div class="val">${vol_dry}</div></div>
			<div class="tj-ipo-card"><div class="lbl">Avg IPO Surge</div><div class="val">${avg_surge}%</div></div>
		`);
	}

	_populate_sector_dropdown() {
		const $sel = $(this.page.body).find("#tj-ipo-sector");
		const inds = Array.from(new Set((this.results || []).map((r) => this._industry_for(r)).filter(Boolean))).sort();
		const cur = $sel.val();
		$sel.empty().append('<option value="">All Sectors</option>');
		inds.forEach((s) => $sel.append(`<option value="${frappe.utils.escape_html(s)}">${frappe.utils.escape_html(s)}</option>`));
		if (cur && inds.includes(cur)) $sel.val(cur);
	}

	_render_results() {
		this._populate_sector_dropdown();
		const $tbody = $(this.page.body).find("#tj-ipo-tbody");
		const filtered = (this.results || []).filter((r) => {
			const ib = this._ipo(r);
			if (this.max_depth !== "" && (ib.base_depth_pct || 0) > this.max_depth) return false;
			if (this.max_dist !== "" && (ib.distance_from_high_pct || 0) > this.max_dist) return false;
			if (this.search && !(r.symbol || "").toUpperCase().includes(this.search)) return false;
			if (this.sector && this._industry_for(r) !== this.sector) return false;
			return true;
		});

		if (!filtered.length) {
			$tbody.html(`<tr><td colspan="11" class="tj-ipo-empty">No symbols match the current filters.</td></tr>`);
			return;
		}

		const rows = filtered.map((r, i) => {
			const ib = this._ipo(r);
			const sym = r.symbol;
			const ind = this._industry_for(r);
			const surge = (ib.ipo_surge_pct || 0).toFixed(1);
			const depth = (ib.base_depth_pct || 0).toFixed(1);
			const dist = (ib.distance_from_high_pct || 0).toFixed(1);
			const range = (ib.recent_range_pct || 0).toFixed(1);
			const volBadge = ib.vol_dry_up ? '<span class="badge vol">Vol ↓</span>' : "";
			const distCls = parseFloat(dist) <= 5 ? "pos" : "";
			return `
				<tr data-symbol="${sym}">
					<td>${i + 1}</td>
					<td class="sym"><a href="#" class="tj-ipo-toggle" data-symbol="${sym}">${sym}</a></td>
					<td>${frappe.utils.escape_html(r.company_name || "")}</td>
					<td style="font-size:11px; color:#64748b;">${frappe.utils.escape_html(ind || "—")}</td>
					<td class="num">${frappe.format(r.current_price || 0, { fieldtype: "Currency", options: "INR" })}</td>
					<td class="num pos">+${surge}%</td>
					<td class="num"><span class="badge tight">${depth}%</span></td>
					<td class="num ${distCls}">${dist}%</td>
					<td class="num">${range}%</td>
					<td class="num">${(r.rs_rating || 0).toFixed(1)}</td>
					<td class="actions">
						${volBadge}
						<a href="#" class="tj-watch" data-symbol="${sym}" data-company="${frappe.utils.escape_html(r.company_name || '')}" data-pivot="${ib.ipo_high || r.current_price || ''}">+ Watch</a>
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
					scan_source: "IPO Base",
				},
				callback: (r) => {
					const m = r.message || {};
					frappe.show_alert({
						message: !m.ok ? (m.error || "Failed") : (m.existed ? `${ds.symbol} already on watchlist` : `${ds.symbol} added`),
						indicator: m.ok ? "green" : "red",
					}, 4);
				},
			});
		});

		$tbody.find(".tj-ipo-toggle").on("click", (e) => {
			e.preventDefault();
			this._toggle_detail(e.currentTarget.dataset.symbol);
		});
	}

	_toggle_detail(symbol) {
		const $tbody = $(this.page.body).find("#tj-ipo-tbody");
		const $row = $tbody.find(`tr[data-symbol="${symbol}"]`).first();
		const $next = $row.next();
		if ($next.hasClass("tj-ipo-detail-row")) { $next.remove(); return; }
		const r = (this.results || []).find((x) => x.symbol === symbol);
		if (!r) return;
		const ib = this._ipo(r);
		$row.after(`
			<tr class="tj-ipo-detail-row">
				<td colspan="11">
					<div style="display:flex; gap:32px; flex-wrap:wrap; align-items:flex-start;">
						<div>
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px;">IPO High</div>
							<div style="font-size:18px; font-weight:800;">₹${(ib.ipo_high || 0).toFixed(2)}</div>
						</div>
						<div>
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px;">IPO Surge</div>
							<div style="font-size:18px; font-weight:800; color:#10b981;">+${(ib.ipo_surge_pct || 0).toFixed(1)}%</div>
						</div>
						<div>
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px;">Base Low</div>
							<div style="font-size:18px; font-weight:800;">₹${(ib.base_low || 0).toFixed(2)}</div>
						</div>
						<div>
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px;">Base Depth</div>
							<div style="font-size:18px; font-weight:800;">${(ib.base_depth_pct || 0).toFixed(1)}%</div>
						</div>
						<div>
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px;">Candle History</div>
							<div style="font-size:14px; font-weight:700;">${ib.candles || 0} days</div>
						</div>
						<div>
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px;">Volume Dry-Up</div>
							<div style="font-size:14px; font-weight:700; color:${ib.vol_dry_up ? "#10b981" : "#94a3b8"};">${ib.vol_dry_up ? "✓ Yes" : "✗ No"}</div>
						</div>
						<div style="flex:1; min-width:240px;">
							<div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px;">Pattern Notes</div>
							<div style="font-size:13px; color:#475569;">${frappe.utils.escape_html(ib.reason || "—")}</div>
						</div>
					</div>
				</td>
			</tr>
		`);
	}
}
