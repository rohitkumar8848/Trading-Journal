frappe.pages["sector-heatmap"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Sector Rotation Heatmap — Nifty 500",
		single_column: true,
	});
	new SectorHeatmapPage(page);
};

class SectorHeatmapPage {
	constructor(page) {
		this.page = page;
		this.sortBy = "ret_1M";
		this._inject_styles();
		this._render_skeleton();
		this._bind();
		this._load_cached();
	}

	_inject_styles() {
		if (document.getElementById("tj-sec-css")) return;
		const css = `
		.tj-sec-wrap { padding: 14px; }
		.tj-sec-hero {
			background: linear-gradient(135deg, #6366f1, #ec4899);
			border-radius: 12px; padding: 16px 20px; color: #fff;
			display: flex; justify-content: space-between; align-items: center;
			gap: 14px; flex-wrap: wrap; margin-bottom: 16px;
		}
		.tj-sec-hero h2 { margin: 0; font-size: 19px; font-weight: 800; }
		.tj-sec-hero .sub { font-size: 12px; opacity: 0.85; margin-top: 3px; }
		.tj-sec-btn {
			background: #fff; color: #1e1b4b; font-weight: 700;
			padding: 8px 16px; border-radius: 8px; border: 0; cursor: pointer;
			font-size: 13px;
		}
		.tj-sec-btn:disabled { opacity: 0.6; }
		.tj-sec-meta { font-size: 12px; color: #64748b; margin-bottom: 12px; }
		.tj-sec-filters {
			display: flex; gap: 14px; flex-wrap: wrap; align-items: end;
			background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 10px 14px; margin-bottom: 12px;
		}
		.tj-sec-filters label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #64748b; display: block; margin-bottom: 3px; }
		.tj-sec-filters select { border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px 10px; font-size: 12px; }

		.tj-sec-grid {
			display: grid; gap: 8px;
			grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		}
		.tj-sec-tile {
			background: #fff; border-radius: 10px; padding: 12px 14px;
			border: 1px solid #e2e8f0; position: relative; overflow: hidden;
			transition: transform 0.1s ease;
		}
		.tj-sec-tile:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(15,23,42,0.08); }
		.tj-sec-tile .ind { font-size: 12px; font-weight: 700; color: #0f172a; margin-bottom: 6px; }
		.tj-sec-tile .count { font-size: 10px; color: #94a3b8; font-weight: 600; }
		.tj-sec-tile .returns { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-top: 6px; }
		.tj-sec-tile .ret { text-align: center; padding: 6px 4px; border-radius: 4px; }
		.tj-sec-tile .ret .lbl { font-size: 9px; color: #64748b; font-weight: 700; text-transform: uppercase; }
		.tj-sec-tile .ret .val { font-size: 13px; font-weight: 800; }
		.tj-sec-tile .top { margin-top: 8px; font-size: 11px; color: #64748b; }
		.tj-sec-tile .top span { font-weight: 600; color: #0f172a; margin-right: 6px; }

		.heat-strong-pos { background: #059669; color: #fff !important; }
		.heat-pos        { background: #d1fae5; }
		.heat-neutral    { background: #f1f5f9; }
		.heat-neg        { background: #fee2e2; }
		.heat-strong-neg { background: #b91c1c; color: #fff !important; }
		.heat-strong-pos .lbl, .heat-strong-pos .val,
		.heat-strong-neg .lbl, .heat-strong-neg .val { color: #fff !important; }

		.tj-sec-tile .accent {
			position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
		}
		.tj-sec-empty { padding: 40px; text-align: center; color: #94a3b8; background: #fff; border-radius: 10px; border: 1px solid #e2e8f0; }
		`;
		const s = document.createElement("style");
		s.id = "tj-sec-css";
		s.textContent = css;
		document.head.appendChild(s);
	}

	_render_skeleton() {
		$(this.page.body).empty().append(`
			<div class="tj-sec-wrap">
				<div class="tj-sec-hero">
					<div>
						<h2>Sector Rotation</h2>
						<div class="sub">Average constituent return per Nifty 500 industry. Refresh takes ~5 min (one Yahoo call per symbol).</div>
					</div>
					<div>
						<button class="tj-sec-btn" id="tj-sec-refresh">↻ Refresh Now</button>
					</div>
				</div>
				<div class="tj-sec-meta" id="tj-sec-meta"></div>
				<div class="tj-sec-filters">
					<div>
						<label>Sort by</label>
						<select id="tj-sec-sort">
							<option value="ret_1M" selected>1 Month</option>
							<option value="ret_1W">1 Week</option>
							<option value="ret_3M">3 Months</option>
							<option value="ret_6M">6 Months</option>
						</select>
					</div>
				</div>
				<div id="tj-sec-grid"></div>
			</div>
		`);
	}

	_bind() {
		const $b = $(this.page.body);
		$b.find("#tj-sec-refresh").on("click", () => this._refresh());
		$b.find("#tj-sec-sort").on("change", (e) => {
			this.sortBy = e.target.value;
			this._render();
		});
	}

	_load_cached() {
		frappe.call({
			method: "trading_journal.trading_journal.utils.sector_heatmap.get_cached_heatmap",
			callback: (r) => {
				const m = r.message || {};
				if (m.sectors && m.sectors.length) {
					this.data = m;
					this._render();
				} else {
					this._render_empty();
				}
			},
		});
	}

	_render_empty() {
		$(this.page.body).find("#tj-sec-grid").html(`
			<div class="tj-sec-empty">
				No heatmap computed yet. Click <b>Refresh Now</b> — first run takes ~5 minutes.
			</div>
		`);
	}

	_refresh() {
		const $btn = $(this.page.body).find("#tj-sec-refresh");
		$btn.prop("disabled", true).text("Computing… (~5 min)");
		frappe.show_alert({message: "Heatmap computation started. This page will reload when done.", indicator: "blue"}, 6);
		frappe.call({
			method: "trading_journal.trading_journal.utils.sector_heatmap.compute_heatmap",
			args: { force: 1 },
			freeze: false,
			callback: (r) => {
				$btn.prop("disabled", false).text("↻ Refresh Now");
				const m = r.message || {};
				if (m.sectors) {
					this.data = m;
					this._render();
					frappe.show_alert({message: `Heatmap ready: ${(m.sectors || []).length} sectors`, indicator: "green"}, 5);
				}
			},
			error: () => $btn.prop("disabled", false).text("↻ Refresh Now"),
		});
	}

	_heat_class(v) {
		if (v === null || v === undefined) return "heat-neutral";
		if (v >= 8)  return "heat-strong-pos";
		if (v >= 1)  return "heat-pos";
		if (v >= -1) return "heat-neutral";
		if (v >= -8) return "heat-neg";
		return "heat-strong-neg";
	}

	_render() {
		const data = this.data;
		if (!data || !data.sectors) return;
		const $b = $(this.page.body);
		const sectors = [...data.sectors].sort((a, b) => (b[this.sortBy] || -999) - (a[this.sortBy] || -999));
		$b.find("#tj-sec-meta").html(
			`<b>${data.total_symbols || sectors.reduce((s, x) => s + (x.count || 0), 0)} symbols</b> across ${sectors.length} sectors. ` +
			(data.as_of ? `Last computed ${frappe.datetime.str_to_user(data.as_of)}` : "")
		);
		const tiles = sectors.map((s) => {
			const accentColor = (s[this.sortBy] || 0) >= 0 ? "#10b981" : "#f43f5e";
			const cells = ["1W", "1M", "3M", "6M"].map((w) => {
				const v = s[`ret_${w}`];
				const cls = this._heat_class(v);
				const txt = v !== null && v !== undefined
					? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`
					: "—";
				return `<div class="ret ${cls}"><div class="lbl">${w}</div><div class="val">${txt}</div></div>`;
			}).join("");
			const top = (s.top_3_1m || []).map((t) => `<span>${t.symbol}</span>`).join("");
			return `
				<div class="tj-sec-tile">
					<div class="accent" style="background:${accentColor};"></div>
					<div class="ind">${frappe.utils.escape_html(s.industry || "Other")} <span class="count">· ${s.count}</span></div>
					<div class="returns">${cells}</div>
					<div class="top">Leaders: ${top || "—"}</div>
				</div>
			`;
		}).join("");
		$b.find("#tj-sec-grid").html(`<div class="tj-sec-grid">${tiles}</div>`);
	}
}
