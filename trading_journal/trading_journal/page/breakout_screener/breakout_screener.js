frappe.pages["breakout-screener"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "52W Breakout Scanner",
		single_column: true,
	});
	new BreakoutScreenerPage(page);
};

class BreakoutScreenerPage {
	constructor(page) {
		this.page = page;
		this.run_name = null;
		this.poll_timer = null;
		this.results = [];
		this.search = "";
		this.min_rs = 60;
		this.universe = "Nifty 500";
		this._inject_styles();
		this._render_skeleton();
		this._bind();
		this._load_latest();
	}

	_inject_styles() {
		if (document.getElementById("tj-bo-css")) return;
		const css = `
		.tj-bo-wrap { padding: 14px; }
		.tj-bo-hero {
			background: linear-gradient(135deg, #064e3b 0%, #065f46 45%, #0f4c75 100%);
			border-radius: 12px; padding: 18px 22px; color: #fff;
			margin-bottom: 16px; display: flex; justify-content: space-between;
			align-items: center; flex-wrap: wrap; gap: 14px;
			position: relative; overflow: hidden;
		}
		.tj-bo-hero::before {
			content: ""; position: absolute; inset: 0;
			background: radial-gradient(700px 200px at 90% -20%, rgba(255,255,255,.12), transparent 60%);
			pointer-events: none;
		}
		.tj-bo-hero h2 { margin: 0; font-size: 20px; font-weight: 800; }
		.tj-bo-hero .sub { font-size: 12px; opacity: .85; margin-top: 4px; }
		.tj-bo-btn {
			background: #fff; color: #064e3b; font-weight: 700;
			padding: 9px 18px; border-radius: 8px; border: 0; cursor: pointer; font-size: 13px;
		}
		.tj-bo-btn:disabled { opacity: .6; cursor: not-allowed; }
		.tj-bo-btn.ghost { background: rgba(255,255,255,.15); color: #fff; border: 1px solid rgba(255,255,255,.3); }

		.tj-bo-status {
			background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 14px; font-size: 13px;
			display: flex; gap: 16px; flex-wrap: wrap; align-items: center;
		}
		.tj-bo-pill { display: inline-block; padding: 3px 10px; border-radius: 999px;
			font-size: 11px; font-weight: 700; text-transform: uppercase; }
		.tj-bo-pill.completed { background: #d1fae5; color: #065f46; }
		.tj-bo-pill.running   { background: #dbeafe; color: #1e40af; }
		.tj-bo-pill.queued    { background: #fef3c7; color: #92400e; }
		.tj-bo-pill.failed    { background: #fee2e2; color: #991b1b; }

		.tj-bo-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
		.tj-bo-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
		.tj-bo-card .lbl { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }
		.tj-bo-card .val { font-size: 22px; font-weight: 800; margin-top: 4px; color: #0f172a; }

		.tj-bo-filters {
			display: flex; gap: 14px; flex-wrap: wrap; align-items: end;
			background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 12px;
		}
		.tj-bo-filters label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: #64748b; display: block; margin-bottom: 4px; }
		.tj-bo-filters input, .tj-bo-filters select { border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; font-size: 13px; min-width: 120px; background: #fff; }

		.tj-bo-table-wrap { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
		.tj-bo-table { width: 100%; border-collapse: collapse; font-size: 13px; }
		.tj-bo-table th {
			background: #f1f5f9; font-size: 10px; font-weight: 700; text-transform: uppercase;
			letter-spacing: .5px; color: #475569; padding: 10px 12px; text-align: left;
			border-bottom: 1px solid #e2e8f0; white-space: nowrap;
		}
		.tj-bo-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #0f172a; }
		.tj-bo-table tr:hover td { background: #f0fdf4; }
		.tj-bo-table .sym { font-weight: 700; color: #065f46; }
		.tj-bo-table .sym a { color: inherit; text-decoration: none; }
		.tj-bo-table .num { font-variant-numeric: tabular-nums; text-align: right; }
		.tj-bo-table .actions a { color: #065f46; text-decoration: none; font-weight: 600; margin-right: 8px; font-size: 12px; }
		.tj-bo-table .actions a:hover { text-decoration: underline; }
		.tj-bo-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
		.tj-bo-badge.tight  { background: #d1fae5; color: #065f46; }
		.tj-bo-badge.near   { background: #dbeafe; color: #1e40af; }
		.tj-bo-badge.sma-ok { background: #ede9fe; color: #5b21b6; }
		.tj-bo-empty { padding: 40px; text-align: center; color: #94a3b8; }
		`;
		const s = document.createElement("style");
		s.id = "tj-bo-css";
		s.textContent = css;
		document.head.appendChild(s);
	}

	_render_skeleton() {
		$(this.page.body).empty().append(`
			<div class="tj-bo-wrap">
				<div class="tj-bo-hero">
					<div>
						<h2>🏔 52W Breakout Scanner</h2>
						<div class="sub">Nifty 500 stocks within 5% of their 52-week high, in a Stage 2 uptrend, RS ≥ 60. Buy the leaders, not the laggards.</div>
					</div>
					<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
						<button class="tj-bo-btn ghost" id="tj-bo-run-all">Run All 9 Scans</button>
						<button class="tj-bo-btn" id="tj-bo-run">Run Scan</button>
					</div>
				</div>
				<div class="tj-bo-status" id="tj-bo-status" style="display:none;"></div>
				<div class="tj-bo-summary" id="tj-bo-summary"></div>
				<div class="tj-bo-filters">
					<div>
						<label>Universe</label>
						<select id="tj-bo-universe">
							<option value="Nifty 500" selected>Nifty 500</option>
							<option value="FnO">F&amp;O</option>
							<option value="All NSE">All NSE</option>
						</select>
					</div>
					<div>
						<label>Min RS Rating</label>
						<select id="tj-bo-rs">
							<option value="60">≥ 60</option>
							<option value="70">≥ 70</option>
							<option value="80">≥ 80</option>
							<option value="0">Any</option>
						</select>
					</div>
					<div>
						<label>Search Symbol</label>
						<input type="text" id="tj-bo-search" placeholder="e.g. RELIANCE">
					</div>
				</div>
				<div class="tj-bo-table-wrap">
					<table class="tj-bo-table">
						<thead><tr>
							<th>#</th>
							<th>Symbol</th>
							<th>Company</th>
							<th class="num">Price ₹</th>
							<th class="num">% from 52W High</th>
							<th class="num">RS Rating</th>
							<th class="num">52W High ₹</th>
							<th class="num">Vol Ratio</th>
							<th>Industry</th>
							<th>SMA</th>
							<th>Actions</th>
						</tr></thead>
						<tbody id="tj-bo-tbody">
							<tr><td colspan="11" class="tj-bo-empty">Loading…</td></tr>
						</tbody>
					</table>
				</div>
			</div>
		`);
	}

	_bind() {
		const $b = $(this.page.body);
		$b.find("#tj-bo-run").on("click", () => this._start_scan());
		$b.find("#tj-bo-run-all").on("click", () => this._start_all());
		$b.find("#tj-bo-universe").on("change", (e) => {
			this.universe = e.target.value || "Nifty 500";
		});
		$b.find("#tj-bo-rs").on("change", (e) => {
			this.min_rs = parseInt(e.target.value);
			this._render_results();
		});
		$b.find("#tj-bo-search").on("input", (e) => {
			this.search = (e.target.value || "").trim().toUpperCase();
			this._render_results();
		});
	}

	_load_latest() {
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.latest_run",
			args: { scan_type: "52W Breakout" },
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok || !m.name) {
					$(this.page.body).find("#tj-bo-tbody").html(
						`<tr><td colspan="11" class="tj-bo-empty">No completed scan yet — click <b>Run Scan</b>.</td></tr>`
					);
					return;
				}
				this.run_name = m.name;
				this._absorb(m);
			},
		});
	}

	_start_scan() {
		const $b = $(this.page.body);
		$b.find("#tj-bo-run").prop("disabled", true).text("Queued…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.start_scan",
			args: { scan_type: "52W Breakout", universe: this.universe },
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok) {
					frappe.msgprint({ title: "Error", message: m.error || "Unknown error", indicator: "red" });
					$b.find("#tj-bo-run").prop("disabled", false).text("Run Scan");
					return;
				}
				this.run_name = m.run_name;
				this._poll();
			},
			error: () => $b.find("#tj-bo-run").prop("disabled", false).text("Run Scan"),
		});
	}

	_start_all() {
		const $b = $(this.page.body);
		$b.find("#tj-bo-run-all").prop("disabled", true).text("Queued…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.start_all_scans",
			callback: (r) => {
				const m = r.message || {};
				if (!m.ok) {
					$b.find("#tj-bo-run-all").prop("disabled", false).text("Run All 9 Scans");
					return;
				}
				const mine = (m.run_names || {})["52W Breakout"];
				if (mine) this.run_name = mine;
				frappe.show_alert({ message: "Started all 9 scans.", indicator: "green" }, 5);
				this._poll();
			},
			error: () => $b.find("#tj-bo-run-all").prop("disabled", false).text("Run All 9 Scans"),
		});
	}

	_poll() {
		if (this.poll_timer) clearTimeout(this.poll_timer);
		const tick = () => {
			frappe.call({
				method: "trading_journal.trading_journal.utils.screener.get_run_status",
				args: { run_name: this.run_name },
				callback: (r) => {
					const m = r.message || {};
					this._absorb(m);
					if (["Queued", "Running"].includes(m.status)) {
						this.poll_timer = setTimeout(tick, 3500);
					} else {
						const $b = $(this.page.body);
						$b.find("#tj-bo-run").prop("disabled", false).text("Run Scan");
						$b.find("#tj-bo-run-all").prop("disabled", false).text("Run All 9 Scans");
					}
				},
			});
		};
		tick();
	}

	_absorb(m) {
		const $b = $(this.page.body);
		const $st = $b.find("#tj-bo-status").show();
		const cls = (m.status || "").toLowerCase();
		$st.html(`
			<span class="tj-bo-pill ${cls}">${m.status || "—"}</span>
			<div style="color:#64748b;flex:1;">${frappe.utils.escape_html(m.progress || "")}</div>
			<div>Scanned: <b>${m.total_scanned || 0}</b> · Found: <b>${m.passed_count || 0}</b></div>
			${m.completed_at ? `<div style="font-size:11px;color:#94a3b8;">Last: ${frappe.datetime.str_to_user(m.completed_at)}</div>` : ""}
		`);
		this.results = m.results || [];
		this._render_summary();
		this._render_results();
	}

	_render_summary() {
		const all = this.results || [];
		const breakouts  = all.filter(r => (this._criteria(r).pct_from_high || 0) >= -1).length;
		const sma_aligned = all.filter(r => this._criteria(r).sma_aligned).length;
		const avg_rs = all.length ? (all.reduce((s, r) => s + (r.rs_rating || 0), 0) / all.length).toFixed(1) : "—";
		$(this.page.body).find("#tj-bo-summary").html(`
			<div class="tj-bo-card"><div class="lbl">Total Setups</div><div class="val">${all.length}</div></div>
			<div class="tj-bo-card"><div class="lbl">At/Near High (&lt;1%)</div><div class="val">${breakouts}</div></div>
			<div class="tj-bo-card"><div class="lbl">SMA Aligned</div><div class="val">${sma_aligned}</div></div>
			<div class="tj-bo-card"><div class="lbl">Avg RS</div><div class="val">${avg_rs}</div></div>
		`);
	}

	_criteria(r) {
		try { return JSON.parse(r.criteria_json || "{}"); } catch (e) { return {}; }
	}

	_render_results() {
		const $tbody = $(this.page.body).find("#tj-bo-tbody");
		const filtered = (this.results || []).filter(r => {
			if ((r.rs_rating || 0) < this.min_rs) return false;
			if (this.search && !(r.symbol || "").includes(this.search)) return false;
			return true;
		});
		if (!filtered.length) {
			$tbody.html(`<tr><td colspan="11" class="tj-bo-empty">No stocks match the current filters.</td></tr>`);
			return;
		}
		const rows = filtered.map((r, i) => {
			const c = this._criteria(r);
			const pct = (r.pct_from_52w_high || 0);
			const pctBadge = pct >= -1
				? `<span class="tj-bo-badge tight">${pct.toFixed(2)}%</span>`
				: `<span class="tj-bo-badge near">${pct.toFixed(2)}%</span>`;
			const smaBadge = c.sma_aligned
				? `<span class="tj-bo-badge sma-ok">✓ Aligned</span>`
				: `<span style="font-size:11px;color:#94a3b8;">Partial</span>`;
			const sym = r.symbol;
			return `
				<tr>
					<td>${i + 1}</td>
					<td class="sym"><a href="#" class="tj-chart-hover" data-symbol="${sym}" data-exchange="NSE">${sym}</a></td>
					<td style="font-size:12px;color:#475569;">${frappe.utils.escape_html(r.company_name || "")}</td>
					<td class="num">₹${frappe.format(r.current_price || 0, { fieldtype: "Float", precision: 2 })}</td>
					<td class="num">${pctBadge}</td>
					<td class="num" style="font-weight:700;color:${(r.rs_rating || 0) >= 80 ? "#10b981" : "#64748b"}">${(r.rs_rating || 0).toFixed(1)}</td>
					<td class="num">₹${frappe.format(c.high_52w || 0, { fieldtype: "Float", precision: 2 })}</td>
					<td class="num" style="color:${(c.vol_ratio_10_20 || 0) >= 1.5 ? "#10b981" : "#64748b"}">${(c.vol_ratio_10_20 || 0).toFixed(2)}x</td>
					<td style="font-size:11px;color:#475569;">${frappe.utils.escape_html(c.industry || "")}</td>
					<td>${smaBadge}</td>
					<td class="actions">
						<a href="#" class="tj-bo-watch" data-symbol="${sym}" data-company="${frappe.utils.escape_html(r.company_name || '')}" data-pivot="${c.high_52w || r.current_price || ''}">+ Watch</a>
						<a href="https://www.tradingview.com/chart/?symbol=NSE:${sym}" target="_blank" class="tj-chart-hover" data-symbol="${sym}" data-exchange="NSE">Chart</a>
					</td>
				</tr>
			`;
		}).join("");
		$tbody.html(rows);

		$tbody.find(".tj-bo-watch").on("click", (e) => {
			e.preventDefault();
			const ds = e.currentTarget.dataset;
			frappe.call({
				method: "trading_journal.trading_journal.utils.watchlist.add_to_watchlist",
				args: { symbol: ds.symbol, company_name: ds.company, exchange: "NSE", pivot_price: parseFloat(ds.pivot) || null, scan_source: "52W Breakout" },
				callback: (r) => {
					const m = r.message || {};
					frappe.show_alert({ message: m.existed ? `${ds.symbol} already on watchlist` : `${ds.symbol} added`, indicator: m.ok ? "green" : "red" }, 3);
				},
			});
		});
	}
}
