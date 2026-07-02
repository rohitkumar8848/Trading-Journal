frappe.pages["vcp-all-nse-screener"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "VCP Screener — All NSE Stocks",
		single_column: true,
	});
	new VcpAllNseScreenerPage(page);
};

class VcpAllNseScreenerPage {
	constructor(page) {
		this.page = page;
		this.run_name = null;
		this.poll_timer = null;
		this.max_distance = "";
		this.search = "";
		this.universe_filter = "";
		this._inject_styles();
		this._render_skeleton();
		this._bind_controls();
		this._load_latest();
	}

	_inject_styles() {
		if (document.getElementById("tj-nse-css")) return;
		const css = `
		.tj-nse-wrap { padding: 14px; }
		.tj-nse-hero {
			background: linear-gradient(135deg, #7c3aed, #db2777);
			border-radius: 12px; padding: 18px 22px; color: #fff;
			margin-bottom: 16px; display: flex; justify-content: space-between;
			align-items: center; flex-wrap: wrap; gap: 14px;
		}
		.tj-nse-hero h2 { margin: 0; font-size: 20px; font-weight: 800; }
		.tj-nse-hero .sub { font-size: 12px; opacity: 0.85; margin-top: 4px; }
		.tj-nse-hero .btn-scan {
			background: #fff; color: #4c1d95; font-weight: 700;
			padding: 9px 18px; border-radius: 8px; border: 0; cursor: pointer;
			font-size: 13px;
		}
		.tj-nse-hero .btn-scan:disabled { opacity: 0.6; cursor: not-allowed; }

		.tj-nse-status {
			background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 14px; font-size: 13px;
			display: flex; gap: 16px; flex-wrap: wrap; align-items: center;
		}
		.tj-nse-status .pill {
			display: inline-block; padding: 3px 10px; border-radius: 999px;
			font-size: 11px; font-weight: 700; text-transform: uppercase;
			letter-spacing: 0.5px;
		}
		.tj-nse-status .pill.queued { background: #fef3c7; color: #92400e; }
		.tj-nse-status .pill.running { background: #dbeafe; color: #1e40af; }
		.tj-nse-status .pill.completed { background: #d1fae5; color: #065f46; }
		.tj-nse-status .pill.failed { background: #fee2e2; color: #991b1b; }
		.tj-nse-status .tj-nse-msg { color: #64748b; flex: 1; background: transparent !important; height: auto !important; overflow: visible !important; display: block !important; }
		.tj-nse-status .err { color: #991b1b; font-family: monospace; font-size: 11px; white-space: pre-wrap; max-height: 140px; overflow: auto; }

		.tj-nse-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
		.tj-nse-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
		.tj-nse-card .lbl { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
		.tj-nse-card .val { font-size: 22px; font-weight: 800; margin-top: 4px; color: #0f172a; }

		.tj-nse-filters {
			display: flex; gap: 14px; flex-wrap: wrap; align-items: end;
			background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 12px;
		}
		.tj-nse-filters label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; display: block; margin-bottom: 4px; }
		.tj-nse-filters input, .tj-nse-filters select {
			border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; font-size: 13px;
			min-width: 140px; background: #fff;
		}

		.tj-nse-table-wrap { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
		.tj-nse-table { width: 100%; border-collapse: collapse; font-size: 13px; }
		.tj-nse-table th {
			background: #f1f5f9; font-size: 10px; font-weight: 700;
			text-transform: uppercase; letter-spacing: 0.5px; color: #475569;
			padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0;
			white-space: nowrap;
		}
		.tj-nse-table td {
			padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #0f172a;
		}
		.tj-nse-table tr:hover td { background: #f8fafc; }
		.tj-nse-table .sym { font-weight: 700; color: #7c3aed; }
		.tj-nse-table .sym a { color: inherit; text-decoration: none; }
		.tj-nse-table .sym a:hover { text-decoration: underline; }
		.tj-nse-table .num { font-variant-numeric: tabular-nums; text-align: right; }
		.tj-nse-table .badge {
			display: inline-block; padding: 2px 8px; border-radius: 999px;
			font-size: 11px; font-weight: 700;
		}
		.tj-nse-table .badge.tight { background: #d1fae5; color: #065f46; }
		.tj-nse-table .badge.loose { background: #fef3c7; color: #92400e; }
		.tj-nse-table .badge.n500 { background: #ede9fe; color: #5b21b6; }
		.tj-nse-table .badge.broad { background: #f1f5f9; color: #475569; }
		.tj-nse-table .actions a {
			color: #7c3aed; text-decoration: none; font-weight: 600;
			margin-right: 8px; font-size: 12px;
		}
		.tj-nse-table .actions a:hover { text-decoration: underline; }
		.tj-nse-empty { padding: 40px; text-align: center; color: #94a3b8; }

		.tj-nse-detail-row td { background: #fafbfc; padding: 12px 24px; }
		.tj-nse-contractions { display: flex; gap: 6px; align-items: end; height: 60px; }
		.tj-nse-bar {
			background: linear-gradient(180deg, #7c3aed, #db2777);
			border-radius: 4px 4px 0 0; min-width: 26px; color: #fff;
			font-size: 10px; font-weight: 700; text-align: center;
			padding-top: 4px;
		}
		.tj-nse-notice {
			background: #fefce8; border: 1px solid #fde68a; border-radius: 8px;
			padding: 10px 14px; margin-bottom: 12px; font-size: 12px; color: #92400e;
		}
		`;
		const style = document.createElement("style");
		style.id = "tj-nse-css";
		style.textContent = css;
		document.head.appendChild(style);
	}

	_render_skeleton() {
		const $body = $(this.page.body).empty();
		$body.append(`
			<div class="tj-nse-wrap">
				<div class="tj-nse-hero">
					<div>
						<h2>VCP Scanner — All NSE Stocks</h2>
						<div class="sub">Volatility Contraction Patterns across the full NSE EQ universe (~2000 stocks). Run bootstrap once to build history.</div>
					</div>
					<div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
						<span id="tj-nse-snap-info" style="color:rgba(255,255,255,0.85); font-size:11px;"></span>
						<button class="btn-scan" id="tj-nse-snap-refresh" style="background:rgba(255,255,255,0.15); color:#fff; border:1px solid rgba(255,255,255,0.4);">↻ Refresh Snapshot</button>
						<button class="btn-scan" id="tj-nse-bootstrap" style="background:rgba(255,255,255,0.12); color:#fff; border:1px solid rgba(255,255,255,0.3); font-size:12px;">⬇ Bootstrap History</button>
						<button class="btn-scan" id="tj-nse-run-all" style="background:#db2777;color:#fff;">Run All 9 Scans</button>
						<button class="btn-scan" id="tj-nse-run">Run This Scan</button>
					</div>
				</div>
				<div class="tj-nse-notice">
					<b>First time?</b> Click <b>⬇ Bootstrap History</b> to fetch 140 days of NSE bhavcopy for all ~2000 stocks (~3-5 min). After that, the daily cron keeps it current.
				</div>
				<div class="tj-nse-status" id="tj-nse-status" style="display: none;"></div>
				<div class="tj-nse-summary" id="tj-nse-summary"></div>
				<div class="tj-nse-filters">
					<div>
						<label>Max Distance from Pivot</label>
						<select id="tj-nse-max-dist">
							<option value="" selected>All (no filter)</option>
							<option value="3">≤ 3% (very tight)</option>
							<option value="5">≤ 5%</option>
							<option value="8">≤ 8% (default)</option>
						</select>
					</div>
					<div>
						<label>Universe</label>
						<select id="tj-nse-universe">
							<option value="">All NSE Stocks</option>
							<option value="nifty500">Nifty 500 only</option>
							<option value="broad">Broad market (non-Nifty 500)</option>
						</select>
					</div>
					<div>
						<label>Search Symbol</label>
						<input type="text" id="tj-nse-search" placeholder="e.g. TATAMOTORS">
					</div>
				</div>
				<div class="tj-nse-table-wrap">
					<table class="tj-nse-table" id="tj-nse-table">
						<thead>
							<tr>
								<th>#</th>
								<th>Symbol</th>
								<th>Company</th>
								<th class="num">Price ₹</th>
								<th class="num">Final Tightness</th>
								<th class="num">Contractions</th>
								<th class="num">RS</th>
								<th>Universe</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody id="tj-nse-tbody">
							<tr><td colspan="9" class="tj-nse-empty">Loading…</td></tr>
						</tbody>
					</table>
				</div>
			</div>
		`);
	}

	_bind_controls() {
		const $body = $(this.page.body);
		$body.find("#tj-nse-run").on("click", () => this._start_scan());
		$body.find("#tj-nse-run-all").on("click", () => this._start_all_scans());
		$body.find("#tj-nse-snap-refresh").on("click", () => this._refresh_snapshot());
		$body.find("#tj-nse-bootstrap").on("click", () => this._bootstrap_history());
		$body.find("#tj-nse-max-dist").on("change", (e) => {
			this.max_distance = e.target.value === "" ? "" : parseInt(e.target.value, 10);
			this._render_results();
		});
		$body.find("#tj-nse-search").on("input", (e) => {
			this.search = (e.target.value || "").trim().toUpperCase();
			this._render_results();
		});
		$body.find("#tj-nse-universe").on("change", (e) => {
			this.universe_filter = e.target.value || "";
			this._render_results();
		});
		this._update_snap_info();
	}

	_update_snap_info() {
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.snapshot_status",
			callback: (r) => {
				const m = r.message || {};
				const $info = $(this.page.body).find("#tj-nse-snap-info");
				$info.text(m.latest_snapshot_date ? "Snapshot: " + m.latest_snapshot_date : "No snapshot yet");
				if ((m.refresh || {}).running) {
					$info.text("Refreshing snapshot…");
					setTimeout(() => this._update_snap_info(), 4000);
				}
			},
		});
	}

	_refresh_snapshot() {
		const $btn = $(this.page.body).find("#tj-nse-snap-refresh");
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

	_bootstrap_history() {
		const $btn = $(this.page.body).find("#tj-nse-bootstrap");
		if (!confirm("Fetch 140 days of NSE bhavcopy for all ~2000 stocks?\nThis takes 3-5 minutes and runs in the background.")) return;
		$btn.prop("disabled", true).text("Bootstrapping…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.snapshot.bootstrap_all_nse_history",
			args: { days: 140 },
			callback: (r) => {
				const m = r.message || {};
				frappe.show_alert({
					message: m.ok
						? `Bootstrap done: ${m.rows_written} rows across ${m.days_fetched} days (${m.duration_sec}s).`
						: "Bootstrap failed — check error logs.",
					indicator: m.ok ? "green" : "red",
				}, 8);
				$btn.prop("disabled", false).text("⬇ Bootstrap History");
			},
			error: () => {
				frappe.show_alert({ message: "Bootstrap call failed.", indicator: "red" }, 4);
				$btn.prop("disabled", false).text("⬇ Bootstrap History");
			},
		});
	}

	_load_latest() {
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.latest_run",
			args: { scan_type: "VCP All NSE" },
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok || !m.name) {
					this._render_empty("No completed VCP All NSE scan yet. Click \"Run This Scan\".");
					return;
				}
				this.run_name = m.name;
				this._absorb_status(m);
			},
		});
	}

	_start_scan() {
		const $body = $(this.page.body);
		$body.find("#tj-nse-run").prop("disabled", true).text("Queued…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.start_scan",
			args: { scan_type: "VCP All NSE" },
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok) {
					frappe.msgprint({ title: "Could not start scan", message: m.error || "Unknown error", indicator: "red" });
					$body.find("#tj-nse-run").prop("disabled", false).text("Run This Scan");
					return;
				}
				this.run_name = m.run_name;
				this._poll_status();
			},
			error: () => {
				$body.find("#tj-nse-run").prop("disabled", false).text("Run This Scan");
			},
		});
	}

	_start_all_scans() {
		const $body = $(this.page.body);
		const $btnAll = $body.find("#tj-nse-run-all");
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
				const myRun = (m.run_names || {})["VCP All NSE"];
				if (myRun) this.run_name = myRun;
				frappe.show_alert({ message: "Started all 8 scans.", indicator: "green" }, 6);
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
						this.poll_timer = setTimeout(tick, 4000);
					} else {
						const $b = $(this.page.body);
						$b.find("#tj-nse-run").prop("disabled", false).text("Run This Scan");
						$b.find("#tj-nse-run-all").prop("disabled", false).text("Run All 9 Scans");
					}
				},
			});
		};
		tick();
	}

	_absorb_status(m) {
		this.last_status = m;
		const $body = $(this.page.body);
		const $st = $body.find("#tj-nse-status");
		$st.show();
		const cls = (m.status || "").toLowerCase();
		const errBlock = m.error
			? `<div class="err">${frappe.utils.escape_html(m.error).slice(0, 1500)}</div>`
			: "";
		$st.html(`
			<span class="pill ${cls}">${m.status || "—"}</span>
			<div class="tj-nse-msg">${frappe.utils.escape_html(m.progress || "")}</div>
			<div>Scanned: <b>${m.total_scanned || 0}</b> · VCP found: <b>${m.passed_count || 0}</b></div>
			${m.completed_at ? `<div style="font-size:11px; color:#94a3b8;">Last scan: ${frappe.datetime.str_to_user(m.completed_at)}</div>` : ""}
			${errBlock}
		`);
		this.results = m.results || [];
		this._render_summary();
		this._render_results();
	}

	_render_empty(msg) {
		$(this.page.body).find("#tj-nse-tbody").html(
			`<tr><td colspan="9" class="tj-nse-empty">${frappe.utils.escape_html(msg)}</td></tr>`
		);
		$(this.page.body).find("#tj-nse-summary").empty();
	}

	_extract_vcp(r) {
		try { return JSON.parse(r.criteria_json || "{}").vcp || {}; } catch (e) { return {}; }
	}

	_is_nifty500(r) {
		try { return JSON.parse(r.criteria_json || "{}").in_nifty500 || false; } catch (e) { return false; }
	}

	_render_summary() {
		const all = this.results || [];
		const tight = all.filter((r) => (r.vcp_tightness || 0) <= 8).length;
		const n500 = all.filter((r) => this._is_nifty500(r)).length;
		const broad = all.length - n500;
		$(this.page.body).find("#tj-nse-summary").html(`
			<div class="tj-nse-card"><div class="lbl">Total VCP Setups</div><div class="val">${all.length}</div></div>
			<div class="tj-nse-card"><div class="lbl">Tight (≤ 8%)</div><div class="val">${tight}</div></div>
			<div class="tj-nse-card"><div class="lbl">Nifty 500</div><div class="val">${n500}</div></div>
			<div class="tj-nse-card"><div class="lbl">Broad Market</div><div class="val">${broad}</div></div>
		`);
	}

	_render_results() {
		const $tbody = $(this.page.body).find("#tj-nse-tbody");
		const search = this.search;
		const filtered = (this.results || []).filter((r) => {
			const v = this._extract_vcp(r);
			if (this.max_distance !== "" && (v.distance_from_pivot_pct || 0) > this.max_distance) return false;
			if (search && !(r.symbol || "").toUpperCase().includes(search)) return false;
			if (this.universe_filter === "nifty500" && !this._is_nifty500(r)) return false;
			if (this.universe_filter === "broad" && this._is_nifty500(r)) return false;
			return true;
		});
		if (!filtered.length) {
			$tbody.html(`<tr><td colspan="9" class="tj-nse-empty">No symbols match the current filters.</td></tr>`);
			return;
		}
		const rows = filtered.map((r, i) => {
			const v = this._extract_vcp(r);
			const tight = (r.vcp_tightness || 0);
			const cls = tight <= 8 ? "tight" : "loose";
			const sym = r.symbol;
			const inN500 = this._is_nifty500(r);
			const rs = inN500 ? (r.rs_rating || 0).toFixed(1) : "—";
			return `
				<tr data-symbol="${sym}">
					<td>${i + 1}</td>
					<td class="sym"><a href="#" class="tj-nse-toggle" data-symbol="${sym}">${sym}</a></td>
					<td style="font-size:12px; color:#475569;">${frappe.utils.escape_html(r.company_name || "")}</td>
					<td class="num">${frappe.format(r.current_price || 0, { fieldtype: "Currency", options: "INR" })}</td>
					<td class="num"><span class="badge ${cls}">${tight.toFixed(2)}%</span></td>
					<td class="num">${(v.contraction_count || 0)}</td>
					<td class="num">${rs}</td>
					<td><span class="badge ${inN500 ? 'n500' : 'broad'}">${inN500 ? "Nifty 500" : "Broad"}</span></td>
					<td class="actions">
						<a href="#" class="tj-nse-watch" data-symbol="${sym}" data-company="${frappe.utils.escape_html(r.company_name || '')}" data-pivot="${(v.pivot || r.current_price || '')}">+ Watch</a>
						<a href="https://www.tradingview.com/chart/?symbol=NSE:${sym}" target="_blank" class="tj-chart-hover" data-symbol="${sym}" data-exchange="NSE">Chart</a>
					</td>
				</tr>
			`;
		}).join("");
		$tbody.html(rows);

		$tbody.find(".tj-nse-watch").on("click", (e) => {
			e.preventDefault();
			const ds = e.currentTarget.dataset;
			frappe.call({
				method: "trading_journal.trading_journal.utils.watchlist.add_to_watchlist",
				args: {
					symbol: ds.symbol,
					company_name: ds.company,
					exchange: "NSE",
					pivot_price: parseFloat(ds.pivot) || null,
					scan_source: "VCP All NSE",
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

		$tbody.find(".tj-nse-toggle").on("click", (e) => {
			e.preventDefault();
			this._toggle_detail(e.currentTarget.dataset.symbol);
		});
	}

	_toggle_detail(symbol) {
		const $tbody = $(this.page.body).find("#tj-nse-tbody");
		const $row = $tbody.find(`tr[data-symbol="${symbol}"]`).first();
		const $next = $row.next();
		if ($next.hasClass("tj-nse-detail-row")) { $next.remove(); return; }
		const r = (this.results || []).find((x) => x.symbol === symbol);
		if (!r) return;
		const v = this._extract_vcp(r);
		const contractions = v.contractions || [];
		const maxDepth = Math.max(...contractions.map((c) => c.depth_pct), 1);
		const bars = contractions.map((c) => {
			const h = Math.max(8, (c.depth_pct / maxDepth) * 60);
			return `<div class="tj-nse-bar" style="height:${h}px;">${c.depth_pct}%</div>`;
		}).join("");
		$row.after(`
			<tr class="tj-nse-detail-row">
				<td colspan="9">
					<div style="display:flex; gap:32px; flex-wrap:wrap; align-items:center;">
						<div>
							<div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Contractions</div>
							<div class="tj-nse-contractions">${bars || '<span style="color:#94a3b8;">none</span>'}</div>
						</div>
						<div>
							<div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Pivot</div>
							<div style="font-size:18px;font-weight:800;">₹${(v.pivot || 0).toFixed(2)}</div>
						</div>
						<div>
							<div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Distance from Pivot</div>
							<div style="font-size:18px;font-weight:800;">${(v.distance_from_pivot_pct || 0).toFixed(2)}%</div>
						</div>
						<div>
							<div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Volume Dry-Up</div>
							<div style="font-size:14px;font-weight:700;color:${v.volume_dry_up ? '#10b981' : '#94a3b8'};">${v.volume_dry_up ? '✓ Yes' : '✗ No'}</div>
						</div>
						<div style="flex:1;min-width:240px;">
							<div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Reason</div>
							<div style="font-size:13px;color:#475569;">${frappe.utils.escape_html(v.reason || "—")}</div>
						</div>
					</div>
				</td>
			</tr>
		`);
	}
}
