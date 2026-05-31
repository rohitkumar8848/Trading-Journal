frappe.pages["momentum-screener"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Momentum Screener — Mark Minervini Trend Template",
		single_column: true,
	});
	new MomentumScreenerPage(page, {
		scan_type: "Trend Template",
		title_short: "Trend Template",
		accent: "#6366f1",
		accent2: "#a855f7",
	});
};

class MomentumScreenerPage {
	constructor(page, opts) {
		this.page = page;
		this.opts = opts;
		this.run_name = null;
		this.poll_timer = null;
		this.min_passed = ""; // empty = no filter, show all
		this.search = "";
		this.sector = "";
		this._inject_styles();
		this._render_skeleton();
		this._bind_controls();
		this._load_latest();
	}

	_inject_styles() {
		if (document.getElementById("tj-screener-css")) return;
		const css = `
		.tj-scr-wrap { padding: 14px; }
		.tj-scr-hero {
			background: linear-gradient(135deg, ${this.opts.accent}, ${this.opts.accent2});
			border-radius: 12px; padding: 18px 22px; color: #fff;
			margin-bottom: 16px; display: flex; justify-content: space-between;
			align-items: center; flex-wrap: wrap; gap: 14px;
		}
		.tj-scr-hero h2 { margin: 0; font-size: 20px; font-weight: 800; }
		.tj-scr-hero .sub { font-size: 12px; opacity: 0.85; margin-top: 4px; }
		.tj-scr-hero .actions { display: flex; gap: 10px; align-items: center; }
		.tj-scr-hero .btn-scan {
			background: #fff; color: #1e293b; font-weight: 700;
			padding: 9px 18px; border-radius: 8px; border: 0; cursor: pointer;
			font-size: 13px;
		}
		.tj-scr-hero .btn-scan:disabled { opacity: 0.6; cursor: not-allowed; }

		.tj-scr-status {
			background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 14px; font-size: 13px;
			display: flex; gap: 16px; flex-wrap: wrap; align-items: center;
		}
		.tj-scr-status .pill {
			display: inline-block; padding: 3px 10px; border-radius: 999px;
			font-size: 11px; font-weight: 700; text-transform: uppercase;
			letter-spacing: 0.5px;
		}
		.tj-scr-status .pill.queued { background: #fef3c7; color: #92400e; }
		.tj-scr-status .pill.running { background: #dbeafe; color: #1e40af; }
		.tj-scr-status .pill.completed { background: #d1fae5; color: #065f46; }
		.tj-scr-status .pill.failed { background: #fee2e2; color: #991b1b; }
		.tj-scr-status .tj-msg { color: #64748b; flex: 1; background: transparent !important; height: auto !important; overflow: visible !important; display: block !important; }
		.tj-scr-status .err { color: #991b1b; font-family: monospace; font-size: 11px; white-space: pre-wrap; max-height: 140px; overflow: auto; }

		.tj-scr-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
		.tj-scr-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
		.tj-scr-card .lbl { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
		.tj-scr-card .val { font-size: 22px; font-weight: 800; margin-top: 4px; color: #0f172a; }
		.tj-scr-card.win .val { color: #10b981; }

		.tj-scr-filters {
			display: flex; gap: 14px; flex-wrap: wrap; align-items: end;
			background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 12px;
		}
		.tj-scr-filters label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; display: block; margin-bottom: 4px; }
		.tj-scr-filters input, .tj-scr-filters select {
			border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; font-size: 13px;
			min-width: 140px; background: #fff;
		}

		.tj-scr-table-wrap { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
		.tj-scr-table { width: 100%; border-collapse: collapse; font-size: 13px; }
		.tj-scr-table th {
			background: #f1f5f9; font-size: 10px; font-weight: 700;
			text-transform: uppercase; letter-spacing: 0.5px; color: #475569;
			padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0;
			white-space: nowrap;
		}
		.tj-scr-table td {
			padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #0f172a;
		}
		.tj-scr-table tr:hover td { background: #f8fafc; }
		.tj-scr-table .sym { font-weight: 700; color: ${this.opts.accent}; }
		.tj-scr-table .sym a { color: inherit; text-decoration: none; }
		.tj-scr-table .sym a:hover { text-decoration: underline; }
		.tj-scr-table .num { font-variant-numeric: tabular-nums; text-align: right; }
		.tj-scr-table .pos { color: #10b981; font-weight: 700; }
		.tj-scr-table .neg { color: #f43f5e; font-weight: 700; }
		.tj-scr-table .badge {
			display: inline-block; padding: 2px 8px; border-radius: 999px;
			font-size: 11px; font-weight: 700;
		}
		.tj-scr-table .badge.full { background: #d1fae5; color: #065f46; }
		.tj-scr-table .badge.partial { background: #fef3c7; color: #92400e; }
		.tj-scr-table .actions a {
			color: ${this.opts.accent}; text-decoration: none; font-weight: 600;
			margin-right: 8px; font-size: 12px;
		}
		.tj-scr-table .actions a:hover { text-decoration: underline; }
		.tj-scr-empty { padding: 40px; text-align: center; color: #94a3b8; }

		.tj-criteria-row td { background: #fafbfc; padding: 12px 24px; }
		.tj-criteria-grid {
			display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
		}
		.tj-crit { font-size: 11px; padding: 6px 10px; border-radius: 6px; }
		.tj-crit.ok { background: #d1fae5; color: #065f46; }
		.tj-crit.no { background: #fee2e2; color: #991b1b; }
		`;
		const style = document.createElement("style");
		style.id = "tj-screener-css";
		style.textContent = css;
		document.head.appendChild(style);
	}

	_render_skeleton() {
		const $body = $(this.page.body).empty();
		$body.append(`
			<div class="tj-scr-wrap">
				<div class="tj-scr-hero">
					<div>
						<h2>${this.opts.title_short} — Nifty 500</h2>
						<div class="sub">Mark Minervini's 8-rule momentum filter. Daily candles via Yahoo Finance.</div>
					</div>
					<div class="actions" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
						<span id="tj-scr-snap-info" style="color:rgba(255,255,255,0.85); font-size:11px;"></span>
						<button class="btn-scan" id="tj-scr-snap-refresh" style="background:rgba(255,255,255,0.15); color:#fff; border:1px solid rgba(255,255,255,0.4);">↻ Refresh Snapshot</button>
						<button class="btn-scan" id="tj-scr-run-all" style="background:#10b981;color:#fff;">Run All 7 Scans</button>
						<button class="btn-scan" id="tj-scr-run">Run This Scan</button>
					</div>
				</div>
				<div class="tj-scr-status" id="tj-scr-status" style="display: none;"></div>
				<div class="tj-scr-summary" id="tj-scr-summary"></div>
				<div class="tj-scr-filters">
					<div>
						<label>Min Rules Passed</label>
						<select id="tj-scr-min-passed">
							<option value="" selected>All (no filter)</option>
							<option value="8">All 8 (full pass)</option>
							<option value="7">7+ (one miss allowed)</option>
							<option value="6">6+ (loose)</option>
						</select>
					</div>
					<div>
						<label>Sector</label>
						<select id="tj-scr-sector"><option value="">All Sectors</option></select>
					</div>
					<div>
						<label>Search Symbol</label>
						<input type="text" id="tj-scr-search" placeholder="e.g. TATAMOTORS">
					</div>
				</div>
				<div class="tj-scr-table-wrap">
					<table class="tj-scr-table" id="tj-scr-table">
						<thead>
							<tr>
								<th>#</th>
								<th>Symbol</th>
								<th>Company</th>
								<th>Sector</th>
								<th class="num">Price ₹</th>
								<th class="num">Passed</th>
								<th class="num">RS Rating</th>
								<th class="num">From 52w High</th>
								<th class="num">Above 52w Low</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody id="tj-scr-tbody">
							<tr><td colspan="10" class="tj-scr-empty">Loading…</td></tr>
						</tbody>
					</table>
				</div>
			</div>
		`);
	}

	_bind_controls() {
		const $body = $(this.page.body);
		$body.find("#tj-scr-run").on("click", () => this._start_scan());
		$body.find("#tj-scr-run-all").on("click", () => this._start_all_scans());
		$body.find("#tj-scr-snap-refresh").on("click", () => this._refresh_snapshot());
		this._update_snap_info();
		$body.find("#tj-scr-min-passed").on("change", (e) => {
			this.min_passed = e.target.value === "" ? "" : parseInt(e.target.value, 10);
			this._render_results();
		});
		$body.find("#tj-scr-search").on("input", (e) => {
			this.search = (e.target.value || "").trim().toUpperCase();
			this._render_results();
		});
		$body.find("#tj-scr-sector").on("change", (e) => {
			this.sector = e.target.value || "";
			this._render_results();
		});
	}

	_load_latest() {
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.latest_run",
			args: { scan_type: this.opts.scan_type },
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok) {
					this._render_empty("No completed scan yet. Click \"Run Fresh Scan\".");
					return;
				}
				if (!m.name) {
					this._render_empty("No completed scan yet. Click \"Run Fresh Scan\".");
					return;
				}
				this.run_name = m.name;
				this._absorb_status(m);
			},
		});
	}

	_start_scan() {
		const $body = $(this.page.body);
		$body.find("#tj-scr-run").prop("disabled", true).text("Queued…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.start_scan",
			args: { scan_type: this.opts.scan_type },
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok) {
					frappe.msgprint({ title: "Could not start scan", message: m.error || "Unknown error", indicator: "red" });
					$body.find("#tj-scr-run").prop("disabled", false).text("Run This Scan");
					return;
				}
				this.run_name = m.run_name;
				this._poll_status();
			},
			error: () => {
				$body.find("#tj-scr-run").prop("disabled", false).text("Run This Scan");
			},
		});
	}

	_update_snap_info() {
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.snapshot_status",
			callback: (r) => {
				const m = r.message || {};
				const $info = $(this.page.body).find("#tj-scr-snap-info");
				if (m.latest_snapshot_date) {
					$info.text("Snapshot: " + m.latest_snapshot_date);
				} else {
					$info.text("No snapshot yet");
				}
				const ref = m.refresh || {};
				if (ref.running) {
					$info.text("Snapshot refresh: " + (ref.message || "running…"));
					setTimeout(() => this._update_snap_info(), 4000);
				}
			},
		});
	}

	_refresh_snapshot() {
		const $btn = $(this.page.body).find("#tj-scr-snap-refresh");
		$btn.prop("disabled", true).text("Refreshing…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.refresh_snapshot_now",
			args: { force: 1 },
			callback: () => {
				frappe.show_alert({message: "Snapshot refresh queued. Status updates above.", indicator: "blue"}, 5);
				$btn.prop("disabled", false).text("↻ Refresh Snapshot");
				this._poll_snap();
			},
			error: () => $btn.prop("disabled", false).text("↻ Refresh Snapshot"),
		});
	}

	_poll_snap() {
		const tick = () => {
			frappe.call({
				method: "trading_journal.trading_journal.utils.screener.snapshot_status",
				callback: (r) => {
					const m = r.message || {};
					const ref = m.refresh || {};
					const $info = $(this.page.body).find("#tj-scr-snap-info");
					if (ref.running) {
						$info.text(ref.message || "Refreshing snapshot…");
						setTimeout(tick, 5000);
					} else {
						$info.text("Snapshot: " + (m.latest_snapshot_date || "—"));
						if (ref.result && ref.result.ok) {
							frappe.show_alert({message: `Snapshot refreshed (${ref.result.indicators_updated || 0} symbols)`, indicator: "green"}, 5);
						}
					}
				},
			});
		};
		tick();
	}

	_start_all_scans() {
		const $body = $(this.page.body);
		const $btnAll = $body.find("#tj-scr-run-all");
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
				const myRun = (m.run_names || {})[this.opts.scan_type];
				if (myRun) this.run_name = myRun;
				frappe.show_alert({
					message: "Started all 7 scans (single shared fetch ~10 min). Other screener pages will update on refresh.",
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
						$b.find("#tj-scr-run").prop("disabled", false).text("Run This Scan");
						$b.find("#tj-scr-run-all").prop("disabled", false).text("Run All 7 Scans");
					}
				},
			});
		};
		tick();
	}

	_absorb_status(m) {
		this.last_status = m;
		const $body = $(this.page.body);
		const $st = $body.find("#tj-scr-status");
		$st.show();
		const cls = (m.status || "").toLowerCase();
		const errBlock = m.error
			? `<div class="err">${frappe.utils.escape_html(m.error).slice(0, 1500)}</div>`
			: "";
		$st.html(`
			<span class="pill ${cls}">${m.status || "—"}</span>
			<div class="tj-msg">${frappe.utils.escape_html(m.progress || "")}</div>
			<div>Scanned: <b>${m.total_scanned || 0}</b> · Passed: <b>${m.passed_count || 0}</b></div>
			${m.completed_at ? `<div style="font-size:11px; color:#94a3b8;">Last scan: ${frappe.datetime.str_to_user(m.completed_at)}</div>` : ""}
			${errBlock}
		`);
		this.results = m.results || [];
		this._render_summary();
		this._render_results();
	}

	_render_empty(msg) {
		const $body = $(this.page.body);
		$body.find("#tj-scr-tbody").html(
			`<tr><td colspan="10" class="tj-scr-empty">${frappe.utils.escape_html(msg)}</td></tr>`
		);
		$body.find("#tj-scr-summary").empty();
	}

	_render_summary() {
		const all = this.results || [];
		const fullPass = all.filter((r) => (r.passed_count || 0) === 8).length;
		const sevenPass = all.filter((r) => (r.passed_count || 0) === 7).length;
		const avgRs = all.length
			? (all.reduce((s, r) => s + (r.rs_rating || 0), 0) / all.length).toFixed(1)
			: "—";
		$(this.page.body).find("#tj-scr-summary").html(`
			<div class="tj-scr-card win"><div class="lbl">Full Pass (8/8)</div><div class="val">${fullPass}</div></div>
			<div class="tj-scr-card"><div class="lbl">Near Miss (7/8)</div><div class="val">${sevenPass}</div></div>
			<div class="tj-scr-card"><div class="lbl">Total Candidates</div><div class="val">${all.length}</div></div>
			<div class="tj-scr-card"><div class="lbl">Avg RS Rating</div><div class="val">${avgRs}</div></div>
		`);
	}

	_industry_for(r) {
		if (r.industry) return r.industry;
		try { return JSON.parse(r.criteria_json || "{}").industry || ""; } catch (e) { return ""; }
	}

	_populate_sector_dropdown() {
		const $sel = $(this.page.body).find("#tj-scr-sector");
		const inds = Array.from(new Set((this.results || []).map((r) => this._industry_for(r)).filter(Boolean))).sort();
		const cur = $sel.val();
		$sel.empty().append('<option value="">All Sectors</option>');
		inds.forEach((s) => $sel.append(`<option value="${frappe.utils.escape_html(s)}">${frappe.utils.escape_html(s)}</option>`));
		if (cur && inds.includes(cur)) $sel.val(cur);
	}

	_render_results() {
		this._populate_sector_dropdown();
		const $tbody = $(this.page.body).find("#tj-scr-tbody");
		const min = this.min_passed;
		const search = this.search;
		const sector = this.sector;
		const filtered = (this.results || []).filter((r) => {
			if (min !== "" && (r.passed_count || 0) < min) return false;
			if (search && !(r.symbol || "").toUpperCase().includes(search)) return false;
			if (sector && this._industry_for(r) !== sector) return false;
			return true;
		});

		if (!filtered.length) {
			$tbody.html(`<tr><td colspan="10" class="tj-scr-empty">No symbols match the current filters.</td></tr>`);
			return;
		}
		const rows = filtered.map((r, i) => {
			const fromHi = (r.pct_from_52w_high || 0).toFixed(2);
			const aboveLo = (r.pct_above_52w_low || 0).toFixed(2);
			const cls = (r.passed_count || 0) === 8 ? "full" : "partial";
			const sym = r.symbol;
			const ind = this._industry_for(r);
			return `
				<tr data-symbol="${sym}">
					<td>${i + 1}</td>
					<td class="sym"><a href="#" class="tj-toggle" data-symbol="${sym}">${sym}</a></td>
					<td>${frappe.utils.escape_html(r.company_name || "")}</td>
					<td style="font-size:11px; color:#64748b;">${frappe.utils.escape_html(ind || "—")}</td>
					<td class="num">${frappe.format(r.current_price || 0, { fieldtype: "Currency", options: "INR" })}</td>
					<td class="num"><span class="badge ${cls}">${r.passed_count || 0}/8</span></td>
					<td class="num">${(r.rs_rating || 0).toFixed(1)}</td>
					<td class="num neg">${fromHi}%</td>
					<td class="num pos">${aboveLo}%</td>
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
					scan_source: this.opts.scan_type,
				},
				callback: (r) => {
					const m = r.message || {};
					if (!m.ok) {
						frappe.show_alert({message: m.error || "Failed", indicator: "red"}, 4);
						return;
					}
					frappe.show_alert({
						message: m.existed ? `${ds.symbol} already on watchlist` : `${ds.symbol} added to watchlist`,
						indicator: "green",
					}, 4);
				},
			});
		});

		// click sym → expand criteria detail row
		$tbody.find(".tj-toggle").on("click", (e) => {
			e.preventDefault();
			const sym = e.currentTarget.dataset.symbol;
			this._toggle_criteria(sym);
		});
	}

	_toggle_criteria(symbol) {
		const $tbody = $(this.page.body).find("#tj-scr-tbody");
		const $row = $tbody.find(`tr[data-symbol="${symbol}"]`).first();
		const $next = $row.next();
		if ($next.hasClass("tj-criteria-row")) {
			$next.remove();
			return;
		}
		const r = (this.results || []).find((x) => x.symbol === symbol);
		if (!r) return;
		let crits = {};
		try {
			const parsed = JSON.parse(r.criteria_json || "{}");
			crits = parsed.trend_template || parsed.vcp || parsed;
		} catch (e) {}
		const labels = {
			"1_price_above_150_200": "Price > 150 & 200 SMA",
			"2_150_above_200": "150 SMA > 200 SMA",
			"3_200_uptrending": "200 SMA up ≥ 1 month",
			"4_50_150_200_stack": "50 > 150 > 200 SMA",
			"5_price_above_50": "Price > 50 SMA",
			"6_30pct_above_52w_low": "≥ 30% above 52w low",
			"7_within_25pct_of_52w_high": "Within 25% of 52w high",
			"8_rs_rating_70_plus": "RS Rating ≥ 70",
		};
		const items = Object.keys(labels).map((k) => {
			const ok = !!crits[k];
			return `<div class="tj-crit ${ok ? "ok" : "no"}">${ok ? "✓" : "✗"} ${labels[k]}</div>`;
		}).join("");
		$row.after(`
			<tr class="tj-criteria-row">
				<td colspan="10">
					<div style="font-size:11px; color:#64748b; font-weight:700; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">Trend Template Breakdown</div>
					<div class="tj-criteria-grid">${items}</div>
				</td>
			</tr>
		`);
	}
}
