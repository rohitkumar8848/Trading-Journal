frappe.pages["rs-leaders"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({ parent: wrapper, title: "RS Leaders", single_column: true });
	new RSLeadersPage(wrapper);
};

class RSLeadersPage {
	constructor(wrapper) {
		this.wrapper     = wrapper;
		this.min_rs      = 70;
		this.max_from_high = -20;
		this.nifty500    = true;
		this.sort_by     = "rs_rating";
		this.filter_text = "";
		this.data        = null;
		this._build();
		this._load();
	}

	_build() {
		$(this.wrapper).find(".page-content").html(`
		<style>
		.tj-rs-wrap { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 14px; }
		.tj-rs-hero {
			background: linear-gradient(135deg, #6d28d9, #4c1d95);
			border-radius: 12px; padding: 18px 22px; color: #fff;
			margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08);
		}
		.tj-rs-hero h1 { margin: 0 0 4px; font-size: 20px; font-weight: 800; }
		.tj-rs-hero p  { margin: 0 0 16px; color: #ddd6fe; font-size: 12px; }
		.tj-rs-controls { display:flex; flex-wrap:wrap; gap:14px; align-items:end; }
		.tj-rs-control-group { display:flex; flex-direction:column; gap:4px; }
		.tj-rs-control-group label { font-size: 10px; font-weight:700; color: #ede9fe; text-transform: uppercase; letter-spacing: .05em; }
		.tj-rs-slider { -webkit-appearance: none; width: 140px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.35); outline: none; }
		.tj-rs-slider::-webkit-slider-thumb { -webkit-appearance:none; width:14px; height:14px; border-radius:50%; background:#fff; cursor:pointer; }
		.tj-rs-sel { background: #fff; border: 1px solid #cbd5e1; color: #1e1b4b; border-radius: 6px; padding: 6px 10px; font-size: 13px; }
		.tj-rs-search { background: #fff; border: 1px solid #cbd5e1; color: #1e1b4b; border-radius: 6px; padding: 6px 10px; font-size: 13px; width: 160px; }
		.tj-rs-search::placeholder { color: #94a3b8; }
		.tj-rs-toggle { display:flex; gap:4px; }
		.tj-rs-toggle-btn { padding:6px 12px; border-radius:6px; border:1px solid rgba(255,255,255,.4); background:transparent; color:#ede9fe; cursor:pointer; font-size:12px; }
		.tj-rs-toggle-btn.active { background:#fff; border-color:#fff; color:#4c1d95; font-weight:700; }

		.tj-rs-stats { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:16px; }
		.tj-rs-stat { background:#fff; border-radius:10px; padding:12px 18px; border:1px solid #e2e8f0; text-align:center; }
		.tj-rs-stat-val { font-size:1.4rem; font-weight:800; color:#6d28d9; }
		.tj-rs-stat-lbl { font-size:10px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:.5px; }

		.tj-rs-table-wrap { background:#fff; border-radius:12px; border:1px solid #e2e8f0; overflow:hidden; }
		.tj-rs-table { width:100%; border-collapse:collapse; font-size:13px; }
		.tj-rs-table th {
			text-align:left; padding:10px 12px; background:#f1f5f9; color:#475569;
			font-weight:700; font-size:10px; text-transform:uppercase; letter-spacing:.5px;
			border-bottom:1px solid #e2e8f0; cursor:pointer; user-select:none; white-space:nowrap;
		}
		.tj-rs-table th:hover { color:#6d28d9; }
		.tj-rs-table th.sorted { color:#6d28d9; }
		.tj-rs-table td { padding:10px 12px; border-bottom:1px solid #f1f5f9; color:#0f172a; }
		.tj-rs-table tr:hover td { background:#f8fafc; }
		.tj-rs-table tr:last-child td { border:none; }
		.tj-rs-table .sym a { color:#6d28d9; font-weight:700; text-decoration:none; }
		.tj-rs-table .sym a:hover { text-decoration:underline; }
		.tj-rs-table .actions a { color:#6d28d9; text-decoration:none; font-weight:600; margin-right:10px; font-size:12px; }
		.tj-rs-table .actions a:hover { text-decoration:underline; }
		.tj-rs-badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:700; }
		.tj-rs-badge.ultra { background:#ede9fe; color:#5b21b6; }
		.tj-rs-badge.high  { background:#dbeafe; color:#1e40af; }
		.tj-rs-badge.mid   { background:#d1fae5; color:#065f46; }
		.tj-rs-badge.low   { background:#f1f5f9; color:#64748b; }
		.tj-rs-delta { font-size:12px; font-weight:700; }
		.tj-rs-delta.up   { color:#10b981; }
		.tj-rs-delta.down { color:#f43f5e; }
		.tj-rs-delta.flat { color:#94a3b8; }
		.tj-sma-dot { display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:2px; }
		.tj-rs-empty { text-align:center; padding:48px; color:#94a3b8; }
		.tj-rs-watchbtn {
			background:#fff; border:1px solid #cbd5e1; color:#6d28d9; border-radius:4px;
			padding:3px 8px; font-size:12px; cursor:pointer; font-weight:600;
		}
		.tj-rs-watchbtn:hover { background:#6d28d9; color:#fff; border-color:#6d28d9; }
		</style>

		<div class="tj-rs-wrap">
		<div class="tj-rs-hero">
		  <h1>RS Leaders</h1>
		  <p>Highest Relative Strength stocks — IBD-style ranking from latest snapshot</p>
		  <div class="tj-rs-controls">
		    <div class="tj-rs-control-group">
		      <label>Min RS Rating: <span id="tj-rs-val">70</span></label>
		      <input type="range" class="tj-rs-slider" id="tj-rs-slider" min="50" max="95" step="5" value="70">
		    </div>
		    <div class="tj-rs-control-group">
		      <label>Max % from 52W High</label>
		      <select class="tj-rs-sel" id="tj-rs-high">
		        <option value="-5">Within 5%</option>
		        <option value="-10">Within 10%</option>
		        <option value="-20" selected>Within 20%</option>
		        <option value="-50">Any</option>
		      </select>
		    </div>
		    <div class="tj-rs-control-group">
		      <label>Universe</label>
		      <div class="tj-rs-toggle">
		        <button class="tj-rs-toggle-btn active" id="tj-n500-btn">Nifty 500</button>
		        <button class="tj-rs-toggle-btn" id="tj-nall-btn">All NSE</button>
		      </div>
		    </div>
		    <div class="tj-rs-control-group">
		      <label>Search</label>
		      <input type="text" class="tj-rs-search" id="tj-rs-search" placeholder="Filter symbols…">
		    </div>
		  </div>
		</div>

		<div class="tj-rs-stats" id="tj-rs-stats"></div>
		<div class="tj-rs-table-wrap">
		  <table class="tj-rs-table">
		    <thead><tr>
		      <th>#</th>
		      <th>Symbol</th>
		      <th data-sort="rs_rating" class="sorted">RS Rating ▼</th>
		      <th data-sort="rs_delta">RS Δ (5d)</th>
		      <th data-sort="pct_from_52w_high">% from High</th>
		      <th data-sort="vol_ratio">Vol Ratio</th>
		      <th data-sort="range_22d_pct">Volatility%</th>
		      <th>SMA Status</th>
		      <th></th>
		    </tr></thead>
		    <tbody id="tj-rs-tbody"><tr><td colspan="9" class="tj-rs-empty">Loading…</td></tr></tbody>
		  </table>
		</div>
		</div>`);

		// Controls
		const slider = document.getElementById("tj-rs-slider");
		slider.addEventListener("input", () => {
			document.getElementById("tj-rs-val").textContent = slider.value;
			this.min_rs = +slider.value;
			clearTimeout(this._debounce);
			this._debounce = setTimeout(() => this._load(), 400);
		});

		document.getElementById("tj-rs-high").addEventListener("change", e => {
			this.max_from_high = +e.target.value;
			this._load();
		});

		document.getElementById("tj-n500-btn").addEventListener("click", () => {
			this.nifty500 = true;
			document.getElementById("tj-n500-btn").classList.add("active");
			document.getElementById("tj-nall-btn").classList.remove("active");
			this._load();
		});
		document.getElementById("tj-nall-btn").addEventListener("click", () => {
			this.nifty500 = false;
			document.getElementById("tj-nall-btn").classList.add("active");
			document.getElementById("tj-n500-btn").classList.remove("active");
			this._load();
		});

		document.getElementById("tj-rs-search").addEventListener("input", e => {
			this.filter_text = e.target.value.trim().toLowerCase();
			this._render_table();
		});

		// Sortable columns
		document.querySelectorAll(".tj-rs-table th[data-sort]").forEach(th => {
			th.addEventListener("click", () => {
				const s = th.dataset.sort;
				document.querySelectorAll(".tj-rs-table th").forEach(t => { t.classList.remove("sorted"); t.textContent = t.textContent.replace(/ [▲▼]$/, ""); });
				this.sort_by = s;
				th.classList.add("sorted");
				th.textContent += " ▼";
				this._render_table();
			});
		});
	}

	_load() {
		document.getElementById("tj-rs-tbody").innerHTML = `<tr><td colspan="9" class="tj-rs-empty">Loading…</td></tr>`;
		document.getElementById("tj-rs-stats").innerHTML = "";
		frappe.call({
			method: "trading_journal.trading_journal.utils.screener.get_rs_leaders",
			args: {
				min_rs: this.min_rs,
				max_pct_from_high: this.max_from_high,
				nifty500_only: this.nifty500 ? 1 : 0,
			},
			callback: r => {
				const d = r.message;
				if (!d || !d.ok) { document.getElementById("tj-rs-tbody").innerHTML = `<tr><td colspan="9" class="tj-rs-empty">Failed to load data.</td></tr>`; return; }
				this.data = d;
				this._render_stats(d);
				this._render_table();
			},
		});
	}

	_render_stats(d) {
		const results = d.results || [];
		const above200 = results.filter(r => r.above_sma200).length;
		const smaAligned = results.filter(r => r.sma_aligned).length;
		const avgRS = results.length ? Math.round(results.reduce((s, r) => s + r.rs_rating, 0) / results.length) : 0;
		document.getElementById("tj-rs-stats").innerHTML = [
			{ val: d.total,      lbl: "Stocks Found" },
			{ val: avgRS,        lbl: "Avg RS Rating" },
			{ val: above200,     lbl: "Above SMA 200" },
			{ val: smaAligned,   lbl: "SMA 50>150>200" },
			{ val: d.date,       lbl: "Snapshot Date" },
		].map(s => `<div class="tj-rs-stat"><div class="tj-rs-stat-val">${s.val}</div><div class="tj-rs-stat-lbl">${s.lbl}</div></div>`).join("");
	}

	_render_table() {
		if (!this.data) return;
		let rows = [...(this.data.results || [])];

		// Filter by text
		if (this.filter_text) rows = rows.filter(r => r.symbol.toLowerCase().includes(this.filter_text));

		// Sort
		const s = this.sort_by;
		rows.sort((a, b) => (b[s] ?? -999) - (a[s] ?? -999));

		if (!rows.length) {
			document.getElementById("tj-rs-tbody").innerHTML = `<tr><td colspan="9" class="tj-rs-empty">No stocks match the filters.</td></tr>`;
			return;
		}

		const rs_badge = rs => {
			if (rs >= 90) return `<span class="tj-rs-badge ultra">RS ${rs}</span>`;
			if (rs >= 80) return `<span class="tj-rs-badge high">RS ${rs}</span>`;
			if (rs >= 70) return `<span class="tj-rs-badge mid">RS ${rs}</span>`;
			return `<span class="tj-rs-badge low">RS ${rs}</span>`;
		};

		const delta_html = d => {
			if (!d && d !== 0) return `<span class="tj-rs-delta flat">—</span>`;
			const cls = d > 0 ? "up" : d < 0 ? "down" : "flat";
			const sym = d > 0 ? "▲" : d < 0 ? "▼" : "—";
			return `<span class="tj-rs-delta ${cls}">${sym}${Math.abs(d).toFixed(1)}</span>`;
		};

		const sma_html = r => {
			const dots = [
				{ lbl: "50",  ok: r.above_sma50  },
				{ lbl: "150", ok: r.above_sma150 },
				{ lbl: "200", ok: r.above_sma200 },
			];
			return dots.map(d => `<span class="tj-sma-dot" style="background:${d.ok ? "#10b981" : "#f43f5e"}" title="SMA${d.lbl}: ${d.ok ? "above" : "below"}"></span><span style="font-size:11px;color:#64748b;margin-right:5px">${d.lbl}</span>`).join("");
		};

		const fmt_price = p => "₹" + parseFloat(p).toLocaleString("en-IN", { maximumFractionDigits: 2 });
		const pct_color = p => p >= -5 ? "#10b981" : p >= -15 ? "#d97706" : "#e11d48";

		document.getElementById("tj-rs-tbody").innerHTML = rows.map((r, i) => `
		<tr>
		  <td>${i + 1}</td>
		  <td class="sym">
		    <a href="#" class="tj-chart-hover" data-symbol="${r.symbol}" data-exchange="NSE">${r.symbol}</a>
		    <div style="font-size:11px;color:#64748b;font-weight:400">${fmt_price(r.price)}</div>
		  </td>
		  <td>${rs_badge(r.rs_rating)}</td>
		  <td>${delta_html(r.rs_delta)}</td>
		  <td style="color:${pct_color(r.pct_from_52w_high)};font-weight:600">${r.pct_from_52w_high > 0 ? "+" : ""}${r.pct_from_52w_high}%</td>
		  <td style="color:${r.vol_ratio >= 2 ? "#d97706" : "#475569"}">${r.vol_ratio}x</td>
		  <td style="color:#475569">${r.range_22d_pct}%</td>
		  <td>${sma_html(r)}</td>
		  <td class="actions">
		    <a href="#" class="tj-rs-watch" data-symbol="${r.symbol}">+ Watch</a>
		    <a href="https://www.tradingview.com/chart/?symbol=NSE:${r.symbol}" target="_blank" class="tj-chart-hover" data-symbol="${r.symbol}" data-exchange="NSE">Chart</a>
		  </td>
		</tr>`).join("");

		document.querySelectorAll(".tj-rs-watch").forEach(a => {
			a.addEventListener("click", (e) => {
				e.preventDefault();
				const sym = e.currentTarget.dataset.symbol;
				frappe.call({
					method: "trading_journal.trading_journal.utils.watchlist.add_to_watchlist",
					args: { symbol: sym, scan_source: "RS Leaders" },
					callback: () => frappe.show_alert({ message: `${sym} added to watchlist`, indicator: "green" }, 3),
				});
			});
		});
	}
}
