frappe.pages["option-chain-analyzer"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Option Chain Analyzer",
		single_column: true,
	});
	new OptionChainAnalyzer(page);
};

class OptionChainAnalyzer {
	constructor(page) {
		this.page = page;
		this.underlying = "NIFTY";
		this.expiry = null;
		this.strike_count = 15;
		this._inject_styles();
		this._render_skeleton();
		this._bind();
		this._load_underlyings();
	}

	_inject_styles() {
		if (document.getElementById("tj-oc-css")) return;
		const css = `
		.tj-oc-wrap { padding: 14px; }
		.tj-oc-controls {
			background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
			padding: 14px 16px; margin-bottom: 14px; display: flex;
			gap: 14px; flex-wrap: wrap; align-items: end;
		}
		.tj-oc-control { display: flex; flex-direction: column; gap: 4px; }
		.tj-oc-control label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .4px; font-weight: 700; }
		.tj-oc-control select, .tj-oc-control input {
			padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 6px;
			font-size: 13px; min-width: 140px; background: #fff;
		}
		.tj-oc-btn {
			padding: 8px 14px; border-radius: 6px; border: 0; cursor: pointer;
			font-weight: 700; font-size: 12px; background: #6366f1; color: #fff;
		}
		.tj-oc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
		.tj-oc-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
		.tj-oc-tile { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; }
		.tj-oc-tile .lbl { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: .4px; font-weight: 700; }
		.tj-oc-tile .val { font-size: 19px; font-weight: 800; color: #0f172a; margin-top: 2px; }
		.tj-oc-tile.bull .val { color: #10b981; }
		.tj-oc-tile.bear .val { color: #f43f5e; }
		.tj-oc-tile.warn .val { color: #f59e0b; }
		.tj-oc-table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; font-size: 11.5px; }
		.tj-oc-table th, .tj-oc-table td { padding: 6px 8px; text-align: right; border-bottom: 1px solid #f1f5f9; }
		.tj-oc-table th {
			background: #f8fafc; color: #64748b; text-transform: uppercase;
			letter-spacing: .3px; font-size: 9.5px; font-weight: 700;
			position: sticky; top: 0; z-index: 1;
		}
		.tj-oc-table th.ce-h { background: #fef2f2; color: #b91c1c; }
		.tj-oc-table th.pe-h { background: #ecfdf5; color: #047857; }
		.tj-oc-table th.k-h { background: #f1f5f9; color: #0f172a; text-align: center; }
		.tj-oc-table td.k {
			background: #f8fafc; font-weight: 800; color: #0f172a;
			text-align: center; font-size: 13px;
			border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;
		}
		.tj-oc-table tr.atm td.k { background: #fef3c7; color: #92400e; }
		.tj-oc-table tr.atm td { background: #fffbeb; }
		.tj-oc-table td.itm { background: #fef2f2; }
		.tj-oc-table td.itm-pe { background: #ecfdf5; }
		.tj-oc-table .pos { color: #10b981; font-weight: 700; }
		.tj-oc-table .neg { color: #f43f5e; font-weight: 700; }
		.tj-oc-table .muted { color: #94a3b8; }
		.tj-oc-empty { padding: 30px; text-align: center; color: #94a3b8; }
		.tj-oc-asof { font-size: 11px; color: #64748b; margin-left: auto; }
		.tj-oc-table td.clk { cursor: pointer; }
		.tj-oc-table td.clk:hover { background: #eef2ff !important; }
		.tj-oc-strike-pane {
			background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
			padding: 16px 18px; margin-top: 16px;
		}
		.tj-oc-strike-pane h3 { margin: 0 0 8px; font-size: 16px; font-weight: 800; color: #0f172a; }
		.tj-oc-strike-pane .pill {
			display: inline-block; font-size: 10px; font-weight: 700;
			padding: 2px 8px; border-radius: 999px; margin-right: 6px;
		}
		.tj-oc-strike-pane .pill.ce { background: #fee2e2; color: #b91c1c; }
		.tj-oc-strike-pane .pill.pe { background: #d1fae5; color: #047857; }
		.tj-oc-strike-pane .pill.muted { background: #f1f5f9; color: #64748b; }
		.tj-oc-snap { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin: 12px 0 14px; }
		.tj-oc-snap .item { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; }
		.tj-oc-snap .item .lbl { font-size: 9.5px; color: #64748b; text-transform: uppercase; letter-spacing: .4px; font-weight: 700; }
		.tj-oc-snap .item .val { font-size: 14px; font-weight: 800; color: #0f172a; margin-top: 2px; }
		.tj-oc-snap .item .val.pos { color: #10b981; }
		.tj-oc-snap .item .val.neg { color: #f43f5e; }
		.tj-oc-scenario { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-top: 6px; }
		.tj-oc-scenario th, .tj-oc-scenario td { padding: 6px 8px; text-align: right; border: 1px solid #f1f5f9; }
		.tj-oc-scenario th { background: #f8fafc; color: #64748b; text-transform: uppercase; letter-spacing: .3px; font-size: 9.5px; font-weight: 700; }
		.tj-oc-scenario td.spot-h { background: #f1f5f9; color: #0f172a; font-weight: 800; text-align: center; }
		.tj-oc-scenario td.zero { background: #fef3c7; }
		.tj-oc-verdict { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
		.tj-oc-verdict .card { padding: 10px 12px; border-radius: 8px; border: 1px solid #e2e8f0; }
		.tj-oc-verdict .card.buy { background: #f0f9ff; border-color: #bae6fd; }
		.tj-oc-verdict .card.sell { background: #fef2f2; border-color: #fecdd3; }
		.tj-oc-verdict .card h4 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .4px; }
		.tj-oc-verdict .card.buy h4 { color: #0369a1; }
		.tj-oc-verdict .card.sell h4 { color: #b91c1c; }
		.tj-oc-verdict ul { margin: 0; padding-left: 16px; }
		.tj-oc-verdict li { font-size: 12px; color: #334155; line-height: 1.6; }
		`;
		const s = document.createElement("style");
		s.id = "tj-oc-css";
		s.textContent = css;
		document.head.appendChild(s);
	}

	_render_skeleton() {
		$(this.page.body).empty().append(`
			<div class="tj-oc-wrap">
				<div class="tj-oc-controls">
					<div class="tj-oc-control">
						<label>Underlying</label>
						<select id="tj-oc-underlying"></select>
					</div>
					<div class="tj-oc-control">
						<label>Expiry</label>
						<select id="tj-oc-expiry"><option value="">—</option></select>
					</div>
					<div class="tj-oc-control">
						<label>Strikes (each side)</label>
						<input type="number" id="tj-oc-strikes" value="15" min="5" max="40">
					</div>
					<button class="tj-oc-btn" id="tj-oc-refresh">↻ Refresh</button>
					<div class="tj-oc-asof" id="tj-oc-asof"></div>
				</div>
				<div id="tj-oc-tiles" class="tj-oc-tiles"></div>
				<div id="tj-oc-body"><div class="tj-oc-empty">Pick an underlying + expiry to load the chain.</div></div>
				<div id="tj-oc-strike" style="display:none"></div>
			</div>
		`);
	}

	_bind() {
		const $b = $(this.page.body);
		$b.on("change", "#tj-oc-underlying", (e) => {
			this.underlying = e.target.value;
			this._load_expiries();
		});
		$b.on("change", "#tj-oc-expiry", (e) => {
			this.expiry = e.target.value || null;
			if (this.expiry) this._load_chain();
		});
		$b.on("change", "#tj-oc-strikes", (e) => {
			this.strike_count = parseInt(e.target.value, 10) || 15;
		});
		$b.on("click", "#tj-oc-refresh", () => {
			if (this.expiry) this._load_chain();
		});
		$b.on("click", ".tj-oc-table td.clk", (e) => {
			const $td = $(e.currentTarget);
			const strike = parseFloat($td.data("strike"));
			const opt = $td.data("opt");
			if (strike && opt) this._analyze_strike(strike, opt);
		});
	}

	_load_underlyings() {
		frappe.call({
			method: "trading_journal.trading_journal.utils.option_chain.get_underlyings",
			callback: (r) => {
				const list = (r.message || {}).underlyings || [];
				const $sel = $(this.page.body).find("#tj-oc-underlying").empty();
				list.forEach((u) => {
					$sel.append(`<option value="${u.key}">${u.name}</option>`);
				});
				$sel.val(this.underlying);
				this._load_expiries();
			},
		});
	}

	_load_expiries() {
		frappe.call({
			method: "trading_journal.trading_journal.utils.option_chain.get_expiries",
			args: { underlying: this.underlying },
			callback: (r) => {
				const expiries = (r.message || {}).expiries || [];
				const $sel = $(this.page.body).find("#tj-oc-expiry").empty();
				$sel.append(`<option value="">— pick —</option>`);
				expiries.forEach((e) => {
					$sel.append(`<option value="${e}">${frappe.datetime.str_to_user(e)}</option>`);
				});
				if (expiries.length) {
					this.expiry = expiries[0];
					$sel.val(this.expiry);
					this._load_chain();
				}
			},
		});
	}

	_load_chain() {
		const $btn = $(this.page.body).find("#tj-oc-refresh").prop("disabled", true).text("Loading…");
		$(this.page.body).find("#tj-oc-body").html(`<div class="tj-oc-empty">Fetching live OI + computing greeks…</div>`);
		frappe.call({
			method: "trading_journal.trading_journal.utils.option_chain.get_chain",
			args: {
				underlying: this.underlying,
				expiry: this.expiry,
				strike_count: this.strike_count,
			},
			callback: (r) => {
				$btn.prop("disabled", false).text("↻ Refresh");
				const m = r.message;
				if (!m || !m.ok) {
					$(this.page.body).find("#tj-oc-body").html(
						`<div class="tj-oc-empty">No data returned.</div>`
					);
					return;
				}
				this._render(m);
			},
			error: (xhr) => {
				$btn.prop("disabled", false).text("↻ Refresh");
				// Frappe encodes server_messages as a JSON-stringified array of
				// JSON-stringified message objects. Unwrap once or twice.
				let pretty = "Request failed.";
				try {
					const sm = xhr && xhr.responseJSON && xhr.responseJSON._server_messages;
					if (sm) {
						const arr = JSON.parse(sm);
						const first = arr[0] ? JSON.parse(arr[0]) : null;
						if (first && first.message) pretty = first.message;
					}
				} catch (_) { /* fallthrough */ }
				$(this.page.body).find("#tj-oc-body").html(
					`<div class="tj-oc-empty">⚠ ${pretty}</div>`
				);
			},
		});
	}

	_render(m) {
		this._render_tiles(m);
		this._render_table(m);
		const asof = m.as_of ? frappe.datetime.str_to_user(m.as_of) : "";
		$(this.page.body).find("#tj-oc-asof").text(asof ? `as of ${asof}` : "");
	}

	_render_tiles(m) {
		const s = m.summary || {};
		const fmt = (n) => (n || n === 0) ? frappe.format(n, { fieldtype: "Float" }) : "—";
		const fmtInt = (n) => (n || n === 0) ? Math.round(n).toLocaleString("en-IN") : "—";
		const fmtSigned = (n) => {
			if (!n && n !== 0) return "—";
			const sign = n > 0 ? "+" : "";
			return sign + Math.round(n).toLocaleString("en-IN");
		};
		const pcrCls = s.pcr >= 1 ? "bull" : (s.pcr < 0.7 ? "bear" : "");
		const tiles = [
			{ lbl: "Spot (EOD)", val: fmt(m.spot), cls: "" },
			{ lbl: "ATM Strike", val: fmt(m.atm_strike), cls: "warn" },
			{ lbl: "Days to Expiry", val: m.days_to_expiry, cls: "" },
			{ lbl: "PCR (OI)", val: s.pcr, cls: pcrCls },
			{ lbl: "Max Pain", val: fmt(s.max_pain), cls: "warn" },
			{ lbl: "Total CE OI", val: fmtInt(s.total_ce_oi), cls: "bear" },
			{ lbl: "Total PE OI", val: fmtInt(s.total_pe_oi), cls: "bull" },
			{ lbl: "ΔCE OI (day)", val: fmtSigned(s.total_ce_oi_chg), cls: (s.total_ce_oi_chg || 0) >= 0 ? "bear" : "bull" },
			{ lbl: "ΔPE OI (day)", val: fmtSigned(s.total_pe_oi_chg), cls: (s.total_pe_oi_chg || 0) >= 0 ? "bull" : "bear" },
		];
		$(this.page.body).find("#tj-oc-tiles").html(
			tiles.map((t) => `
				<div class="tj-oc-tile ${t.cls}">
					<div class="lbl">${t.lbl}</div>
					<div class="val">${t.val}</div>
				</div>
			`).join("")
		);
	}

	_render_table(m) {
		const rows = m.rows || [];
		if (!rows.length) {
			$(this.page.body).find("#tj-oc-body").html(`<div class="tj-oc-empty">No strikes returned.</div>`);
			return;
		}
		const fmtN = (n, dp = 2) => (n === undefined || n === null) ? "—" : Number(n).toFixed(dp);
		const fmtInt = (n) => (n || n === 0) ? Math.round(n).toLocaleString("en-IN") : "—";
		const cell = (v, cls = "") => `<td class="${cls}">${v}</td>`;
		const sign = (v, dp = 2) => {
			if (v === 0 || v === undefined || v === null) return `<span class="muted">${fmtN(v, dp)}</span>`;
			return `<span class="${v >= 0 ? "pos" : "neg"}">${fmtN(v, dp)}</span>`;
		};

		const headRow = `
			<tr>
				<th class="ce-h">OI</th>
				<th class="ce-h">ΔOI</th>
				<th class="ce-h">Vol</th>
				<th class="ce-h">IV %</th>
				<th class="ce-h">Δ</th>
				<th class="ce-h">Γ</th>
				<th class="ce-h">Θ</th>
				<th class="ce-h">V</th>
				<th class="ce-h">LTP</th>
				<th class="k-h">STRIKE</th>
				<th class="pe-h">LTP</th>
				<th class="pe-h">V</th>
				<th class="pe-h">Θ</th>
				<th class="pe-h">Γ</th>
				<th class="pe-h">Δ</th>
				<th class="pe-h">IV %</th>
				<th class="pe-h">Vol</th>
				<th class="pe-h">ΔOI</th>
				<th class="pe-h">OI</th>
			</tr>
		`;

		const signCell = (v, cls = "") => {
			if (v === undefined || v === null || v === 0)
				return `<td class="${cls} muted">—</td>`;
			const txt = (v > 0 ? "+" : "") + Math.round(v).toLocaleString("en-IN");
			return `<td class="${cls} ${v > 0 ? "pos" : "neg"}">${txt}</td>`;
		};

		const tr = (r) => {
			const ce = r.ce || {};
			const pe = r.pe || {};
			const cls = r.is_atm ? "atm" : "";
			const ceItm = (m.spot && r.strike < m.spot) ? "itm" : "";
			const peItm = (m.spot && r.strike > m.spot) ? "itm-pe" : "";
			return `
				<tr class="${cls}">
					${cell(fmtInt(ce.oi), ceItm)}
					${signCell(ce.oi_change, ceItm)}
					${cell(fmtInt(ce.volume), ceItm)}
					${cell(fmtN(ce.iv, 1), ceItm)}
					${cell(fmtN(ce.delta, 3), ceItm)}
					${cell(fmtN(ce.gamma, 5), ceItm)}
					${cell(fmtN(ce.theta, 2), ceItm)}
					${cell(fmtN(ce.vega, 2), ceItm)}
					<td class="${ceItm} clk" data-strike="${r.strike}" data-opt="CE" title="Click to analyze"><b>${fmtN(ce.ltp)}</b></td>
					<td class="k">${fmtN(r.strike, 0)}</td>
					<td class="${peItm} clk" data-strike="${r.strike}" data-opt="PE" title="Click to analyze"><b>${fmtN(pe.ltp)}</b></td>
					${cell(fmtN(pe.vega, 2), peItm)}
					${cell(fmtN(pe.theta, 2), peItm)}
					${cell(fmtN(pe.gamma, 5), peItm)}
					${cell(fmtN(pe.delta, 3), peItm)}
					${cell(fmtN(pe.iv, 1), peItm)}
					${cell(fmtInt(pe.volume), peItm)}
					${signCell(pe.oi_change, peItm)}
					${cell(fmtInt(pe.oi), peItm)}
				</tr>
			`;
		};

		const bhavLine = m.bhavcopy_date
			? `<div style="font-size:11px;color:#64748b;margin-bottom:6px">EOD bhavcopy: <b>${m.bhavcopy_date}</b> · ΔOI = day-over-day change</div>`
			: "";

		$(this.page.body).find("#tj-oc-body").html(`
			${bhavLine}
			<div style="overflow-x:auto">
				<table class="tj-oc-table">
					<thead>${headRow}</thead>
					<tbody>${rows.map(tr).join("")}</tbody>
				</table>
			</div>
		`);
	}

	_analyze_strike(strike, optType) {
		const $pane = $(this.page.body).find("#tj-oc-strike").show()
			.html(`<div class="tj-oc-strike-pane"><div class="tj-oc-empty">Analyzing ${optType} ${strike}…</div></div>`);
		frappe.call({
			method: "trading_journal.trading_journal.utils.option_chain.analyze_strike",
			args: {
				underlying: this.underlying,
				expiry: this.expiry,
				strike: strike,
				option_type: optType,
			},
			callback: (r) => {
				const m = r.message;
				if (!m || !m.ok) {
					$pane.find(".tj-oc-strike-pane").html(`<div class="tj-oc-empty">No analysis returned.</div>`);
					return;
				}
				$pane.html(this._render_strike_pane(m));
				// Scroll into view
				const el = $pane.get(0);
				if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
			},
			error: (xhr) => {
				let pretty = "Analysis failed.";
				try {
					const sm = xhr && xhr.responseJSON && xhr.responseJSON._server_messages;
					if (sm) {
						const arr = JSON.parse(sm);
						const first = arr[0] ? JSON.parse(arr[0]) : null;
						if (first && first.message) pretty = first.message;
					}
				} catch (_) {}
				$pane.find(".tj-oc-strike-pane").html(`<div class="tj-oc-empty">⚠ ${pretty}</div>`);
			},
		});
	}

	_render_strike_pane(m) {
		const fmt = (n, dp = 2) => (n === undefined || n === null) ? "—" : Number(n).toFixed(dp);
		const fmtInt = (n) => (n || n === 0) ? Math.round(n).toLocaleString("en-IN") : "—";
		const fmtINR = (n) => "₹" + (Math.round(n || 0)).toLocaleString("en-IN");
		const sideTag = m.option_type === "CE"
			? `<span class="pill ce">CE · CALL</span>`
			: `<span class="pill pe">PE · PUT</span>`;
		const ivPill = m.iv_label ? `<span class="pill muted">${m.iv_label}</span>` : "";

		const snap = [
			{ lbl: "Spot", val: fmt(m.spot, 2) },
			{ lbl: "Strike", val: fmt(m.strike, 0) },
			{ lbl: "LTP", val: fmt(m.ltp, 2) },
			{ lbl: "Premium / lot", val: fmtINR(m.premium_per_lot) },
			{ lbl: "Lot size", val: fmt(m.lot_size, 0) },
			{ lbl: "Days to Expiry", val: m.days_to_expiry },
			{ lbl: "IV %", val: fmt(m.iv, 2) },
			{ lbl: "OI", val: fmtInt(m.oi) },
			{ lbl: "ΔOI (day)", val: (m.oi_change >= 0 ? "+" : "") + fmtInt(m.oi_change), cls: m.oi_change >= 0 ? "pos" : "neg" },
			{ lbl: "Delta", val: fmt(m.delta, 3) },
			{ lbl: "Gamma", val: fmt(m.gamma, 5) },
			{ lbl: "Theta /day", val: fmt(m.theta, 2) },
			{ lbl: "Vega /1%", val: fmt(m.vega, 2) },
			{ lbl: "Breakeven", val: fmt(m.breakeven, 2) + " (" + (m.breakeven_move_pct >= 0 ? "+" : "") + fmt(m.breakeven_move_pct, 2) + "%)" },
			{ lbl: "Prob ITM", val: fmt(m.prob_itm, 1) + "%" },
			{ lbl: "Theta cost /day", val: fmtINR(m.daily_theta_cost) },
			{ lbl: "Max loss (long)", val: fmtINR(m.max_loss_long) },
			{ lbl: "IV %ile (band)", val: m.iv_percentile_in_band !== null ? m.iv_percentile_in_band + "%" : "—" },
		];

		const snapHtml = snap.map(s => `
			<div class="item">
				<div class="lbl">${s.lbl}</div>
				<div class="val ${s.cls || ""}">${s.val}</div>
			</div>
		`).join("");

		// Scenario matrix
		const dayHeaders = (m.day_buckets || []).map(d => `<th>${d === 0 ? "Today" : (d === m.days_to_expiry ? "Expiry" : "+" + d + "d")}</th>`).join("");
		const scenarioRows = (m.scenarios || []).map(row => {
			const isZero = row.spot_move_pct === 0;
			const cells = (row.cells || []).map(c => {
				const buy = c.pnl_buy;
				const sell = c.pnl_sell;
				const buyCls = buy > 0 ? "pos" : (buy < 0 ? "neg" : "muted");
				return `<td>
					<div><b>₹${fmt(c.premium, 2)}</b></div>
					<div style="font-size:10.5px"><span class="${buyCls}">B: ${(buy>=0?"+":"")}${fmtInt(buy)}</span></div>
					<div style="font-size:10.5px;color:#94a3b8">S: ${(sell>=0?"+":"")}${fmtInt(sell)}</div>
				</td>`;
			}).join("");
			return `
				<tr>
					<td class="spot-h ${isZero ? "zero" : ""}">${row.spot_move_pct > 0 ? "+" : ""}${fmt(row.spot_move_pct, 1)}%<br><span style="color:#64748b;font-size:10px">₹${fmt(row.spot, 0)}</span></td>
					${cells}
				</tr>
			`;
		}).join("");

		// Verdicts
		const buyHtml = (m.buy_notes || []).map(n => `<li>${n}</li>`).join("") || `<li class="muted">—</li>`;
		const sellHtml = (m.sell_notes || []).map(n => `<li>${n}</li>`).join("") || `<li class="muted">—</li>`;

		return `
			<div class="tj-oc-strike-pane">
				<h3>${sideTag} ${fmt(m.strike, 0)} · ${m.underlying} · expires ${m.expiry} ${ivPill}</h3>
				<div style="font-size:11px;color:#64748b">EOD bhavcopy: ${m.bhavcopy_date} · numbers below assume entry at LTP ₹${fmt(m.ltp, 2)} for ${fmt(m.lot_size, 0)} lot</div>
				<div class="tj-oc-snap">${snapHtml}</div>
				<h3 style="margin-top:18px">Scenario P&L (per lot)</h3>
				<div style="font-size:11px;color:#64748b;margin-bottom:8px">Each cell shows option premium + P&L. <span class="pos" style="font-weight:700">B</span> = if you BUY at LTP, <span style="color:#94a3b8;font-weight:700">S</span> = if you SELL at LTP. Spot move is hypothetical change vs current spot.</div>
				<div style="overflow-x:auto">
					<table class="tj-oc-scenario">
						<thead>
							<tr><th>Spot move</th>${dayHeaders}</tr>
						</thead>
						<tbody>${scenarioRows}</tbody>
					</table>
				</div>
				<div class="tj-oc-verdict">
					<div class="card buy">
						<h4>If you BUY this ${m.option_type}</h4>
						<ul>${buyHtml}</ul>
					</div>
					<div class="card sell">
						<h4>If you SELL this ${m.option_type}</h4>
						<ul>${sellHtml}</ul>
					</div>
				</div>
			</div>
		`;
	}
}
