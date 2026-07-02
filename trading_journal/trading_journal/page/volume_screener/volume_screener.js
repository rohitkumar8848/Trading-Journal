frappe.pages["volume-screener"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({ parent: wrapper, title: "Volume Surge Scanner", single_column: true });
	new VolumeSurgePage(wrapper);
};

class VolumeSurgePage {
	constructor(wrapper) {
		this.wrapper      = wrapper;
		this.min_vol      = 2.0;
		this.min_rs       = 50;
		this.nifty500     = true;
		this.vol_universe = "Nifty 500";
		this.filter_text  = "";
		this.sort_by      = "vol_ratio";
		this.data         = null;
		this._build();
		this._load();
	}

	_build() {
		$(this.wrapper).find(".page-content").html(`
		<style>
		.tj-vol-wrap { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 14px; }
		.tj-vol-hero {
			background: linear-gradient(135deg, #c2410c, #7c2d12);
			border-radius: 12px; padding: 18px 22px; color: #fff;
			margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08);
		}
		.tj-vol-hero h1 { margin: 0 0 4px; font-size: 20px; font-weight: 800; }
		.tj-vol-hero p  { margin: 0 0 16px; color: #fed7aa; font-size: 12px; }
		.tj-vol-controls { display:flex; flex-wrap:wrap; gap:14px; align-items:end; }
		.tj-vol-control-group { display:flex; flex-direction:column; gap:4px; }
		.tj-vol-control-group label { font-size: 10px; font-weight:700; color: #ffedd5; text-transform: uppercase; letter-spacing: .05em; }
		.tj-vol-sel { background: #fff; border: 1px solid #cbd5e1; color: #1c1917; border-radius: 6px; padding: 6px 10px; font-size: 13px; }
		.tj-vol-search { background: #fff; border: 1px solid #cbd5e1; color: #1c1917; border-radius: 6px; padding: 6px 10px; font-size: 13px; width: 160px; }
		.tj-vol-search::placeholder { color: #94a3b8; }
		.tj-vol-toggle-btn { padding:6px 12px; border-radius:6px; border:1px solid rgba(255,255,255,.4); background:transparent; color:#ffedd5; cursor:pointer; font-size:12px; margin-right:4px; }
		.tj-vol-toggle-btn.active { background:#fff; border-color:#fff; color:#7c2d12; font-weight:700; }

		.tj-vol-stats { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:16px; }
		.tj-vol-stat { background:#fff; border-radius:10px; padding:12px 18px; border:1px solid #e2e8f0; text-align:center; }
		.tj-vol-stat-val { font-size:1.4rem; font-weight:800; color:#c2410c; }
		.tj-vol-stat-lbl { font-size:10px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:.5px; }

		.tj-vol-table-wrap { background:#fff; border-radius:12px; border:1px solid #e2e8f0; overflow:hidden; }
		.tj-vol-table { width:100%; border-collapse:collapse; font-size:13px; }
		.tj-vol-table th {
			text-align:left; padding:10px 12px; background:#f1f5f9; color:#475569;
			font-weight:700; font-size:10px; text-transform:uppercase; letter-spacing:.5px;
			border-bottom:1px solid #e2e8f0; cursor:pointer; user-select:none; white-space:nowrap;
		}
		.tj-vol-table th:hover { color:#c2410c; }
		.tj-vol-table th.sorted { color:#c2410c; }
		.tj-vol-table td { padding:10px 12px; border-bottom:1px solid #f1f5f9; color:#0f172a; }
		.tj-vol-table tr:hover td { background:#f8fafc; }
		.tj-vol-table tr:last-child td { border:none; }
		.tj-vol-table .sym a { color:#c2410c; font-weight:700; text-decoration:none; }
		.tj-vol-table .sym a:hover { text-decoration:underline; }
		.tj-vol-table .actions a { color:#c2410c; text-decoration:none; font-weight:600; margin-right:10px; font-size:12px; }
		.tj-vol-table .actions a:hover { text-decoration:underline; }
		.tj-vol-badge { display:inline-block; padding:3px 9px; border-radius:999px; font-size:12px; font-weight:700; }
		.tj-vol-badge.mega { background:#ffedd5; color:#9a3412; }
		.tj-vol-badge.high { background:#fef3c7; color:#92400e; }
		.tj-vol-badge.mod  { background:#dbeafe; color:#1e40af; }
		.tj-vol-bar { height:6px; border-radius:3px; background:#c2410c; max-width:80px; }
		.tj-sma-pip { display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:2px; }
		.tj-vol-empty { text-align:center; padding:48px; color:#94a3b8; }
		.tj-vol-watchbtn {
			background:#fff; border:1px solid #cbd5e1; color:#c2410c; border-radius:4px;
			padding:3px 8px; font-size:12px; cursor:pointer; font-weight:600;
		}
		.tj-vol-watchbtn:hover { background:#c2410c; color:#fff; border-color:#c2410c; }
		.tj-vol-near52 { background:#d1fae5; border:1px solid #6ee7b7; border-radius:4px; padding:2px 6px; font-size:11px; color:#065f46; font-weight:600; }
		</style>

		<div class="tj-vol-wrap">
		<div class="tj-vol-hero">
		  <h1>Volume Surge Scanner</h1>
		  <p>Stocks with abnormally high volume — pocket pivot & accumulation signals</p>
		  <div class="tj-vol-controls">
		    <div class="tj-vol-control-group">
		      <label>Min Vol Ratio</label>
		      <select class="tj-vol-sel" id="tj-vol-ratio">
		        <option value="1.5">1.5x</option>
		        <option value="2.0" selected>2.0x</option>
		        <option value="2.5">2.5x</option>
		        <option value="3.0">3.0x</option>
		        <option value="4.0">4.0x+</option>
		      </select>
		    </div>
		    <div class="tj-vol-control-group">
		      <label>Min RS Rating</label>
		      <select class="tj-vol-sel" id="tj-vol-rs">
		        <option value="0">Any</option>
		        <option value="50" selected>≥ 50</option>
		        <option value="60">≥ 60</option>
		        <option value="70">≥ 70</option>
		        <option value="80">≥ 80</option>
		      </select>
		    </div>
		    <div class="tj-vol-control-group">
		      <label>Universe</label>
		      <div>
		        <button class="tj-vol-toggle-btn active" id="tj-vn500-btn">Nifty 500</button>
		        <button class="tj-vol-toggle-btn" id="tj-vnall-btn">All NSE</button>
		        <button class="tj-vol-toggle-btn" id="tj-vnfno-btn">F&amp;O</button>
		      </div>
		    </div>
		    <div class="tj-vol-control-group">
		      <label>Search</label>
		      <input type="text" class="tj-vol-search" id="tj-vol-search" placeholder="Filter symbols…">
		    </div>
		  </div>
		</div>

		<div class="tj-vol-stats" id="tj-vol-stats"></div>
		<div class="tj-vol-table-wrap">
		  <table class="tj-vol-table">
		    <thead><tr>
		      <th>#</th>
		      <th>Symbol</th>
		      <th data-sort="vol_ratio" class="sorted">Vol Ratio ▼</th>
		      <th data-sort="rs_rating">RS Rating</th>
		      <th data-sort="pct_from_52w_high">% from 52W High</th>
		      <th data-sort="range_22d_pct">Volatility%</th>
		      <th>SMA</th>
		      <th></th>
		    </tr></thead>
		    <tbody id="tj-vol-tbody"><tr><td colspan="8" class="tj-vol-empty">Loading…</td></tr></tbody>
		  </table>
		</div>
		</div>`);

		document.getElementById("tj-vol-ratio").addEventListener("change", e => { this.min_vol = +e.target.value; this._load(); });
		document.getElementById("tj-vol-rs").addEventListener("change", e => { this.min_rs = +e.target.value; this._load(); });
		const _vol_btns = () => ["tj-vn500-btn", "tj-vnall-btn", "tj-vnfno-btn"].forEach(id => document.getElementById(id).classList.remove("active"));
		document.getElementById("tj-vn500-btn").addEventListener("click", () => {
			this.nifty500 = true;
			this.vol_universe = "Nifty 500";
			_vol_btns(); document.getElementById("tj-vn500-btn").classList.add("active");
			this._load();
		});
		document.getElementById("tj-vnall-btn").addEventListener("click", () => {
			this.nifty500 = false;
			this.vol_universe = "All NSE";
			_vol_btns(); document.getElementById("tj-vnall-btn").classList.add("active");
			this._load();
		});
		document.getElementById("tj-vnfno-btn").addEventListener("click", () => {
			this.nifty500 = false;
			this.vol_universe = "FnO";
			_vol_btns(); document.getElementById("tj-vnfno-btn").classList.add("active");
			this._load();
		});
		document.getElementById("tj-vol-search").addEventListener("input", e => {
			this.filter_text = e.target.value.trim().toLowerCase();
			this._render_table();
		});

		document.querySelectorAll(".tj-vol-table th[data-sort]").forEach(th => {
			th.addEventListener("click", () => {
				const s = th.dataset.sort;
				document.querySelectorAll(".tj-vol-table th").forEach(t => { t.classList.remove("sorted"); t.textContent = t.textContent.replace(/ [▲▼]$/, ""); });
				this.sort_by = s;
				th.classList.add("sorted");
				th.textContent += " ▼";
				this._render_table();
			});
		});
	}

	_load() {
		document.getElementById("tj-vol-tbody").innerHTML = `<tr><td colspan="8" class="tj-vol-empty">Loading…</td></tr>`;
		document.getElementById("tj-vol-stats").innerHTML = "";
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.get_volume_surge",
			args: { min_vol_ratio: this.min_vol, min_rs: this.min_rs, nifty500_only: this.nifty500 ? 1 : 0, universe: this.vol_universe },
			callback: r => {
				const d = r.message;
				if (!d || !d.ok) { document.getElementById("tj-vol-tbody").innerHTML = `<tr><td colspan="8" class="tj-vol-empty">Failed to load.</td></tr>`; return; }
				this.data = d;
				this._render_stats(d);
				this._render_table();
			},
		});
	}

	_render_stats(d) {
		const results = d.results || [];
		const nearHigh  = results.filter(r => r.near_52w_high).length;
		const smaOk     = results.filter(r => r.sma_aligned).length;
		const avgVol    = results.length ? (results.reduce((s, r) => s + r.vol_ratio, 0) / results.length).toFixed(1) : 0;
		document.getElementById("tj-vol-stats").innerHTML = [
			{ val: d.total,  lbl: "Surging Stocks" },
			{ val: avgVol + "x", lbl: "Avg Vol Ratio" },
			{ val: nearHigh, lbl: "Near 52W High" },
			{ val: smaOk,    lbl: "SMA Aligned" },
			{ val: d.date,   lbl: "As of Date" },
		].map(s => `<div class="tj-vol-stat"><div class="tj-vol-stat-val">${s.val}</div><div class="tj-vol-stat-lbl">${s.lbl}</div></div>`).join("");
	}

	_render_table() {
		if (!this.data) return;
		let rows = [...(this.data.results || [])];
		if (this.filter_text) rows = rows.filter(r => r.symbol.toLowerCase().includes(this.filter_text));
		const s = this.sort_by;
		rows.sort((a, b) => (b[s] ?? -999) - (a[s] ?? -999));

		if (!rows.length) {
			document.getElementById("tj-vol-tbody").innerHTML = `<tr><td colspan="8" class="tj-vol-empty">No stocks match filters.</td></tr>`;
			return;
		}

		const maxVol = Math.max(...rows.map(r => r.vol_ratio), 1);

		const vol_badge = v => {
			if (v >= 4)   return `<span class="tj-vol-badge mega">${v}x</span>`;
			if (v >= 2.5) return `<span class="tj-vol-badge high">${v}x</span>`;
			return           `<span class="tj-vol-badge mod">${v}x</span>`;
		};

		const rs_color = rs => rs >= 80 ? "#7c3aed" : rs >= 70 ? "#1d4ed8" : rs >= 60 ? "#059669" : "#64748b";
		const pct_color = p => p >= -5 ? "#10b981" : p >= -15 ? "#d97706" : "#e11d48";

		const sma_pips = r => [
			{ lbl: "50",  ok: r.above_sma50 },
			{ lbl: "150", ok: r.above_sma150 },
			{ lbl: "200", ok: r.above_sma200 },
		].map(d => `<span class="tj-sma-pip" style="background:${d.ok ? "#10b981":"#f43f5e"}" title="SMA${d.lbl}"></span><span style="font-size:11px;color:#64748b;margin-right:4px">${d.lbl}</span>`).join("");

		document.getElementById("tj-vol-tbody").innerHTML = rows.map((r, i) => `
		<tr>
		  <td>${i + 1}</td>
		  <td class="sym">
		    <a href="#" class="tj-chart-hover" data-symbol="${r.symbol}" data-exchange="NSE">${r.symbol}</a>
		    <div style="font-size:11px;color:#64748b;font-weight:400">₹${parseFloat(r.price).toLocaleString("en-IN")}</div>
		    ${r.near_52w_high ? `<span class="tj-vol-near52">Near 52W High</span>` : ""}
		  </td>
		  <td>
		    ${vol_badge(r.vol_ratio)}
		    <div class="tj-vol-bar" style="width:${Math.round(r.vol_ratio / maxVol * 80)}px;margin-top:4px"></div>
		  </td>
		  <td style="color:${rs_color(r.rs_rating)};font-weight:700">${r.rs_rating}</td>
		  <td style="color:${pct_color(r.pct_from_52w_high)};font-weight:600">${r.pct_from_52w_high > 0 ? "+" : ""}${r.pct_from_52w_high}%</td>
		  <td style="color:#475569">${r.range_22d_pct}%</td>
		  <td>${sma_pips(r)}</td>
		  <td class="actions">
		    <a href="#" class="tj-vol-watch" data-symbol="${r.symbol}">+ Watch</a>
		    <a href="https://www.tradingview.com/chart/?symbol=NSE:${r.symbol}" target="_blank" class="tj-chart-hover" data-symbol="${r.symbol}" data-exchange="NSE">Chart</a>
		  </td>
		</tr>`).join("");

		document.querySelectorAll(".tj-vol-watch").forEach(a => {
			a.addEventListener("click", (e) => {
				e.preventDefault();
				const sym = e.currentTarget.dataset.symbol;
				frappe.call({
					method: "trading_journal.trading_journal.utils.watchlist.add_to_watchlist",
					args: { symbol: sym, scan_source: "Volume Surge" },
					callback: () => frappe.show_alert({ message: `${sym} added`, indicator: "green" }, 2),
				});
			});
		});
	}
}
