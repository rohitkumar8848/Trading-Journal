frappe.pages["sector-heatmap"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Sector Rotation",
		single_column: true,
	});
	new SectorRotationPage(page);
};

/* ─────────────────────────────────────────────────────── */
/*  QUADRANT CONFIG                                         */
/* ─────────────────────────────────────────────────────── */
const Q = {
	Leading:   { color: "#10b981", bg: "rgba(16,185,129,0.08)",  label: "Leading",   icon: "🚀", desc: "Strong & improving" },
	Weakening: { color: "#f59e0b", bg: "rgba(245,158,11,0.08)",  label: "Weakening", icon: "📉", desc: "Strong but fading" },
	Improving: { color: "#3b82f6", bg: "rgba(59,130,246,0.08)",  label: "Improving", icon: "📈", desc: "Weak but picking up" },
	Lagging:   { color: "#ef4444", bg: "rgba(239,68,68,0.08)",   label: "Lagging",   icon: "❄️", desc: "Weak & worsening" },
	Unknown:   { color: "#94a3b8", bg: "rgba(148,163,184,0.05)", label: "—",         icon: "○",  desc: "Insufficient data" },
};

class SectorRotationPage {
	constructor(page) {
		this.page = page;
		this.sortBy = "rotation_score";
		this.data = null;
		this._inject_styles();
		this._render_skeleton();
		this._bind();
		this._load();
	}

	/* ─── STYLES ─── */
	_inject_styles() {
		if (document.getElementById("tj-rot-css")) return;
		const css = `
		/* ── Base ── */
		.tj-rot-wrap { padding: 14px; }

		/* ── Hero ── */
		.tj-rot-hero {
			background: linear-gradient(135deg, #1e1b4b 0%, #4c1d95 40%, #831843 100%);
			border-radius: 14px; padding: 20px 24px; color: #fff;
			display: flex; justify-content: space-between; align-items: center;
			gap: 16px; flex-wrap: wrap; margin-bottom: 18px;
			position: relative; overflow: hidden;
		}
		.tj-rot-hero::before {
			content: ""; position: absolute; inset: 0;
			background: radial-gradient(900px 300px at 80% -30%, rgba(255,255,255,.12), transparent 60%);
			pointer-events: none;
		}
		.tj-rot-hero h2 { margin: 0; font-size: 22px; font-weight: 900; letter-spacing: -.3px; }
		.tj-rot-hero .sub { font-size: 12px; opacity: .8; margin-top: 4px; }
		.tj-rot-hero-right { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
		.tj-rot-btn {
			background: rgba(255,255,255,.15); color: #fff; font-weight: 700;
			padding: 9px 18px; border-radius: 8px; border: 1px solid rgba(255,255,255,.3);
			cursor: pointer; font-size: 13px; backdrop-filter: blur(4px);
			transition: background .18s, transform .1s;
		}
		.tj-rot-btn:hover { background: rgba(255,255,255,.25); transform: translateY(-1px); }
		.tj-rot-btn:disabled { opacity: .5; cursor: not-allowed; }
		.tj-rot-btn.primary { background: #fff; color: #4c1d95; border-color: transparent; }
		.tj-rot-btn.primary:hover { background: #f1f0ff; }
		.tj-rot-meta { font-size: 11px; opacity: .7; }

		/* ── Sort tabs ── */
		.tj-rot-tabs {
			display: flex; gap: 6px; background: #f8fafc;
			border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 10px 14px; margin-bottom: 16px; flex-wrap: wrap; align-items: center;
		}
		.tj-rot-tabs .lbl { font-size: 10px; font-weight: 700; text-transform: uppercase;
			letter-spacing: .5px; color: #64748b; margin-right: 4px; }
		.tj-rot-tab {
			padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 700;
			cursor: pointer; border: 1px solid transparent; color: #64748b;
			transition: all .15s;
		}
		.tj-rot-tab:hover { background: #e2e8f0; color: #1e293b; }
		.tj-rot-tab.active { background: #4c1d95; color: #fff; border-color: #4c1d95; }

		/* ── Quadrant summary cards ── */
		.tj-rot-quadrants {
			display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
			margin-bottom: 18px;
		}
		@media (max-width: 860px) { .tj-rot-quadrants { grid-template-columns: repeat(2, 1fr); } }
		.tj-rot-qcard {
			border-radius: 12px; padding: 14px 16px;
			border: 1.5px solid; position: relative; overflow: hidden;
			transition: transform .15s, box-shadow .2s;
		}
		.tj-rot-qcard:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,.1); }
		.tj-rot-qcard-icon { font-size: 20px; margin-bottom: 6px; }
		.tj-rot-qcard-title { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; }
		.tj-rot-qcard-desc { font-size: 10px; opacity: .75; margin-bottom: 8px; font-weight: 600; }
		.tj-rot-qcard-sectors { display: flex; flex-wrap: wrap; gap: 4px; }
		.tj-rot-qcard-chip {
			font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px;
			background: rgba(255,255,255,.6); color: #1e293b;
		}
		.tj-rot-qcard-count { font-size: 18px; font-weight: 900; margin-bottom: 2px; }

		/* ── RRG Scatter Plot ── */
		.tj-rot-rrg-wrap {
			background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
			padding: 20px; margin-bottom: 18px; overflow: hidden;
		}
		.tj-rot-rrg-title {
			font-size: 11px; font-weight: 700; text-transform: uppercase;
			letter-spacing: .6px; color: #64748b; margin-bottom: 14px;
			display: flex; align-items: center; gap: 8px;
		}
		.tj-rot-rrg-title::before {
			content: ""; width: 4px; height: 14px; border-radius: 2px;
			background: linear-gradient(180deg, #4c1d95, #831843);
		}
		.tj-rot-rrg { width: 100%; overflow-x: auto; }
		svg.tj-rrg-svg { display: block; min-width: 480px; }
		.tj-rrg-dot { cursor: pointer; transition: r .2s; }
		.tj-rrg-dot:hover { opacity: .85; }
		.tj-rrg-label {
			font-size: 9.5px; font-weight: 700; fill: #1e293b;
			pointer-events: none; text-anchor: middle;
		}
		.tj-rrg-axis-label { font-size: 10px; fill: #94a3b8; font-weight: 700; }
		.tj-rrg-q-label { font-size: 10px; font-weight: 800; opacity: .55; }
		.tj-rrg-tooltip {
			position: fixed; z-index: 9999; background: #1e293b; color: #fff;
			border-radius: 10px; padding: 10px 14px; font-size: 12px;
			pointer-events: none; display: none; min-width: 180px;
			box-shadow: 0 8px 24px rgba(0,0,0,.25);
		}
		.tj-rrg-tooltip .tt-sym { font-size: 14px; font-weight: 900; margin-bottom: 6px; }
		.tj-rrg-tooltip .tt-row { display: flex; justify-content: space-between; gap: 14px; }
		.tj-rrg-tooltip .tt-lbl { color: #94a3b8; font-size: 11px; }
		.tj-rrg-tooltip .tt-val { font-weight: 700; }

		/* ── Sector bars ── */
		.tj-rot-bars-wrap {
			background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
			overflow: hidden;
		}
		.tj-rot-bars-head {
			padding: 14px 18px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
			font-size: 11px; font-weight: 700; text-transform: uppercase;
			letter-spacing: .5px; color: #64748b;
			display: flex; align-items: center; gap: 8px;
		}
		.tj-rot-bars-head::before {
			content: ""; width: 4px; height: 14px; border-radius: 2px;
			background: linear-gradient(180deg, #4c1d95, #831843);
		}
		.tj-rot-sector-row {
			display: grid;
			grid-template-columns: 28px 1fr 110px 90px 90px 90px 90px 80px;
			gap: 0; align-items: center;
			padding: 11px 18px; border-bottom: 1px solid #f1f5f9;
			transition: background .12s;
		}
		.tj-rot-sector-row:hover { background: #faf5ff; }
		.tj-rot-sector-row:last-child { border-bottom: 0; }
		.tj-rot-rank { font-size: 11px; color: #94a3b8; font-weight: 700; }
		.tj-rot-name { font-size: 12.5px; font-weight: 700; color: #0f172a; }
		.tj-rot-bar-cell { padding-right: 12px; }
		.tj-rot-bar-outer { height: 6px; background: #f1f5f9; border-radius: 999px; overflow: hidden; min-width: 60px; }
		.tj-rot-bar-inner { height: 100%; border-radius: 999px; transition: width .5s; }
		.tj-rot-ret { font-size: 12px; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }
		.tj-rot-delta { font-size: 11px; font-weight: 700; text-align: center; }
		.tj-rot-q-badge {
			display: inline-block; padding: 2px 8px; border-radius: 999px;
			font-size: 10px; font-weight: 700;
		}
		.tj-rot-header-row {
			display: grid;
			grid-template-columns: 28px 1fr 110px 90px 90px 90px 90px 80px;
			gap: 0;
			padding: 8px 18px; background: #f1f5f9;
			font-size: 10px; font-weight: 700; text-transform: uppercase;
			letter-spacing: .5px; color: #64748b; border-bottom: 1px solid #e2e8f0;
		}
		.tj-rot-header-row span { text-align: right; }
		.tj-rot-header-row span:nth-child(1),
		.tj-rot-header-row span:nth-child(2) { text-align: left; }
		.tj-rot-leader-chips { display: flex; gap: 4px; flex-wrap: wrap; }
		.tj-rot-leader { font-size: 10px; font-weight: 700; color: #4c1d95; }
		.tj-rot-empty { padding: 40px; text-align: center; color: #94a3b8; }
		`;
		const s = document.createElement("style");
		s.id = "tj-rot-css";
		s.textContent = css;
		document.head.appendChild(s);
	}

	/* ─── SKELETON ─── */
	_render_skeleton() {
		$(this.page.body).empty().append(`
			<div class="tj-rot-wrap">
				<div class="tj-rot-hero">
					<div>
						<h2>Sector Rotation</h2>
						<div class="sub">Relative Rotation Graph — Nifty 500 by industry. Leading → Weakening → Lagging → Improving.</div>
					</div>
					<div class="tj-rot-hero-right">
						<span class="tj-rot-meta" id="tj-rot-meta"></span>
						<button class="tj-rot-btn primary" id="tj-rot-refresh">↻ Refresh</button>
					</div>
				</div>

				<div class="tj-rot-tabs">
					<span class="lbl">Sort by:</span>
					<span class="tj-rot-tab active" data-sort="rotation_score">Score</span>
					<span class="tj-rot-tab" data-sort="ret_1W">1 Week</span>
					<span class="tj-rot-tab" data-sort="ret_1M">1 Month</span>
					<span class="tj-rot-tab" data-sort="ret_3M">3 Months</span>
					<span class="tj-rot-tab" data-sort="ret_6M">6 Months</span>
				</div>

				<div class="tj-rot-quadrants" id="tj-rot-quadrants">
					${["Leading","Weakening","Improving","Lagging"].map(q => `
						<div class="tj-rot-qcard" style="background:${Q[q].bg};border-color:${Q[q].color}40;">
							<div class="tj-rot-qcard-icon">${Q[q].icon}</div>
							<div class="tj-rot-qcard-title" style="color:${Q[q].color};">${Q[q].label}</div>
							<div class="tj-rot-qcard-desc">${Q[q].desc}</div>
							<div class="tj-rot-qcard-count" style="color:${Q[q].color};" id="tj-q-count-${q}">—</div>
							<div class="tj-rot-qcard-sectors" id="tj-q-sectors-${q}"></div>
						</div>
					`).join("")}
				</div>

				<div class="tj-rot-rrg-wrap">
					<div class="tj-rot-rrg-title">Relative Rotation Graph</div>
					<div class="tj-rot-rrg" id="tj-rrg-container">
						<div class="tj-rot-empty">Loading…</div>
					</div>
				</div>

				<div class="tj-rot-bars-wrap" id="tj-rot-bars">
					<div class="tj-rot-bars-head">Sector Rankings</div>
					<div class="tj-rot-empty">Loading…</div>
				</div>
			</div>
			<div class="tj-rrg-tooltip" id="tj-rrg-tooltip"></div>
		`);
	}

	/* ─── BIND ─── */
	_bind() {
		const $b = $(this.page.body);
		$b.find("#tj-rot-refresh").on("click", () => this._refresh());
		$b.on("click", ".tj-rot-tab", (e) => {
			$b.find(".tj-rot-tab").removeClass("active");
			$(e.currentTarget).addClass("active");
			this.sortBy = e.currentTarget.dataset.sort;
			this._render();
		});
	}

	/* ─── LOAD ─── */
	_load() {
		frappe.call({
			method: "trading_journal.trading_journal.utils.sector_heatmap.get_cached_heatmap",
			callback: (r) => {
				const m = r.message || {};
				if (m.sectors && m.sectors.length) {
					this.data = m;
					this._render();
				} else {
					$(this.page.body).find("#tj-rrg-container, #tj-rot-bars").html(
						`<div class="tj-rot-empty">No data yet — click <b>↻ Refresh</b> to compute sector data.</div>`
					);
				}
			},
		});
	}

	/* ─── REFRESH ─── */
	_refresh() {
		const $btn = $(this.page.body).find("#tj-rot-refresh");
		$btn.prop("disabled", true).text("Computing…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.sector_heatmap.compute_heatmap",
			args: { force: 1 },
			callback: (r) => {
				$btn.prop("disabled", false).text("↻ Refresh");
				const m = r.message || {};
				if (m.sectors) {
					this.data = m;
					this._render();
					frappe.show_alert({ message: `Updated — ${(m.sectors || []).length} sectors`, indicator: "green" }, 4);
				}
			},
			error: () => $btn.prop("disabled", false).text("↻ Refresh"),
		});
	}

	/* ─── MAIN RENDER ─── */
	_render() {
		if (!this.data || !this.data.sectors) return;
		const d = this.data;
		const $b = $(this.page.body);

		$b.find("#tj-rot-meta").text(
			(d.snapshot_date ? `As of ${d.snapshot_date}` : "") +
			(d.total_symbols ? ` · ${d.total_symbols} stocks` : "")
		);

		const sectors = [...d.sectors].sort((a, b) => (b[this.sortBy] || -999) - (a[this.sortBy] || -999));
		this._render_quadrant_cards(sectors);
		this._render_rrg(sectors);
		this._render_bars(sectors);
	}

	/* ─── QUADRANT CARDS ─── */
	_render_quadrant_cards(sectors) {
		const groups = { Leading: [], Weakening: [], Improving: [], Lagging: [] };
		sectors.forEach(s => {
			if (groups[s.quadrant]) groups[s.quadrant].push(s.industry);
		});
		Object.entries(groups).forEach(([q, names]) => {
			$(this.page.body).find(`#tj-q-count-${q}`).text(names.length);
			$(this.page.body).find(`#tj-q-sectors-${q}`).html(
				names.slice(0, 5).map(n => `
					<span class="tj-rot-qcard-chip">${frappe.utils.escape_html(n)}</span>
				`).join("")
			);
		});
	}

	/* ─── RRG SCATTER PLOT ─── */
	_render_rrg(sectors) {
		const container = $(this.page.body).find("#tj-rrg-container")[0];
		if (!container) return;

		const W = Math.max(520, container.clientWidth || 600);
		const H = 400;
		const PAD = { top: 20, right: 24, bottom: 44, left: 44 };
		const pw = W - PAD.left - PAD.right;
		const ph = H - PAD.top - PAD.bottom;

		// Normalize rotation_score and momentum_delta to plot coordinates
		const valid = sectors.filter(s => s.rotation_score !== null && s.momentum_delta !== null);
		if (!valid.length) {
			container.innerHTML = `<div class="tj-rot-empty">Not enough data for RRG. Refresh to compute.</div>`;
			return;
		}

		const scores = valid.map(s => s.rotation_score);
		const deltas = valid.map(s => s.momentum_delta);
		const sMin = Math.min(...scores), sMax = Math.max(...scores);
		const dMin = Math.min(...deltas), dMax = Math.max(...deltas);
		const sPad = (sMax - sMin) * 0.15 || 2;
		const dPad = (dMax - dMin) * 0.15 || 2;
		const sRange = [sMin - sPad, sMax + sPad];
		const dRange = [dMin - dPad, dMax + dPad];

		const toX = (v) => PAD.left + ((v - sRange[0]) / (sRange[1] - sRange[0])) * pw;
		const toY = (v) => PAD.top + (1 - (v - dRange[0]) / (dRange[1] - dRange[0])) * ph;

		// Center lines
		const cx = toX(0);
		const cy = toY(0);

		// Build SVG
		const ns = "http://www.w3.org/2000/svg";
		const svg = document.createElementNS(ns, "svg");
		svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
		svg.setAttribute("width", W);
		svg.setAttribute("height", H);
		svg.classList.add("tj-rrg-svg");

		const el = (tag, attrs = {}, text = "") => {
			const e = document.createElementNS(ns, tag);
			Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
			if (text) e.textContent = text;
			return e;
		};

		// Quadrant backgrounds
		const quadBg = [
			{ x: PAD.left, y: PAD.top, w: cx - PAD.left, h: cy - PAD.top, fill: Q.Improving.bg, label: "IMPROVING", lx: PAD.left + 6, ly: PAD.top + 14, color: Q.Improving.color },
			{ x: cx, y: PAD.top, w: PAD.left + pw - cx, h: cy - PAD.top, fill: Q.Leading.bg, label: "LEADING", lx: cx + 6, ly: PAD.top + 14, color: Q.Leading.color },
			{ x: PAD.left, y: cy, w: cx - PAD.left, h: PAD.top + ph - cy, fill: Q.Lagging.bg, label: "LAGGING", lx: PAD.left + 6, ly: cy + 14, color: Q.Lagging.color },
			{ x: cx, y: cy, w: PAD.left + pw - cx, h: PAD.top + ph - cy, fill: Q.Weakening.bg, label: "WEAKENING", lx: cx + 6, ly: cy + 14, color: Q.Weakening.color },
		];
		quadBg.forEach(q => {
			svg.appendChild(el("rect", { x: q.x, y: q.y, width: q.w, height: q.h, fill: q.fill }));
			const t = el("text", { x: q.lx, y: q.ly, "class": "tj-rrg-q-label", fill: q.color });
			t.textContent = q.label;
			svg.appendChild(t);
		});

		// Grid lines (centre crosshairs)
		svg.appendChild(el("line", { x1: PAD.left, y1: cy, x2: PAD.left + pw, y2: cy, stroke: "#94a3b8", "stroke-width": "1", "stroke-dasharray": "4,3" }));
		svg.appendChild(el("line", { x1: cx, y1: PAD.top, x2: cx, y2: PAD.top + ph, stroke: "#94a3b8", "stroke-width": "1", "stroke-dasharray": "4,3" }));

		// Axis labels
		svg.appendChild(el("text", { x: PAD.left + pw / 2, y: H - 6, "class": "tj-rrg-axis-label", "text-anchor": "middle" }, "← Lagging   Rotation Score   Leading →"));
		const yLabel = el("text", { x: 12, y: PAD.top + ph / 2, "class": "tj-rrg-axis-label", "text-anchor": "middle", transform: `rotate(-90, 12, ${PAD.top + ph / 2})` });
		yLabel.textContent = "↑ Momentum ↑";
		svg.appendChild(yLabel);

		// Dots + labels
		valid.forEach(s => {
			const x = toX(s.rotation_score);
			const y = toY(s.momentum_delta);
			const q = Q[s.quadrant] || Q.Unknown;
			const r = Math.min(14, Math.max(7, (s.count || 1) / 3));

			const circle = el("circle", {
				cx: x, cy: y, r,
				fill: q.color,
				stroke: "#fff",
				"stroke-width": "2",
				opacity: ".85",
				"class": "tj-rrg-dot",
				"data-industry": s.industry,
			});
			svg.appendChild(circle);

			const lbl = el("text", {
				x, y: y + r + 11,
				"class": "tj-rrg-label",
			});
			lbl.textContent = (s.industry || "").replace(/&/g, "&amp;").substring(0, 16);
			svg.appendChild(lbl);
		});

		container.innerHTML = "";
		container.appendChild(svg);

		// Tooltip on hover
		const $tooltip = $("#tj-rrg-tooltip");
		const fmtR = (v) => v === null || v === undefined ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
		$(svg).on("mouseenter", ".tj-rrg-dot", function (e) {
			const ind = this.dataset.industry;
			const s = valid.find(x => x.industry === ind);
			if (!s) return;
			const q = Q[s.quadrant] || Q.Unknown;
			$tooltip.html(`
				<div class="tt-sym" style="color:${q.color}">${q.icon} ${frappe.utils.escape_html(s.industry || "")}</div>
				<div class="tt-row"><span class="tt-lbl">Score</span><span class="tt-val">${fmtR(s.rotation_score)}</span></div>
				<div class="tt-row"><span class="tt-lbl">Momentum</span><span class="tt-val">${fmtR(s.momentum_delta)}</span></div>
				<div class="tt-row"><span class="tt-lbl">1W</span><span class="tt-val">${fmtR(s.ret_1W)}</span></div>
				<div class="tt-row"><span class="tt-lbl">1M</span><span class="tt-val">${fmtR(s.ret_1M)}</span></div>
				<div class="tt-row"><span class="tt-lbl">3M</span><span class="tt-val">${fmtR(s.ret_3M)}</span></div>
				<div class="tt-row"><span class="tt-lbl">Stocks</span><span class="tt-val">${s.count}</span></div>
			`).css({ display: "block", left: e.clientX + 14, top: e.clientY - 60 });
		}).on("mousemove", ".tj-rrg-dot", function (e) {
			$tooltip.css({ left: e.clientX + 14, top: e.clientY - 60 });
		}).on("mouseleave", ".tj-rrg-dot", function () {
			$tooltip.hide();
		});
	}

	/* ─── SECTOR BARS ─── */
	_render_bars(sectors) {
		const $wrap = $(this.page.body).find("#tj-rot-bars");
		if (!sectors.length) {
			$wrap.html(`<div class="tj-rot-bars-head">Sector Rankings</div><div class="tj-rot-empty">No data.</div>`);
			return;
		}

		const key = this.sortBy;
		const sorted = [...sectors].sort((a, b) => (b[key] || -999) - (a[key] || -999));
		const values = sorted.map(s => s[key] || 0);
		const maxAbs = Math.max(1, ...values.map(Math.abs));
		const fmtR = (v) => v === null || v === undefined ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
		const fmtDelta = (v) => v === null || v === undefined ? "—" : `${v >= 0 ? "▲" : "▼"}${Math.abs(v).toFixed(2)}%`;
		const deltaColor = (v) => v === null ? "#94a3b8" : (v >= 0 ? "#10b981" : "#ef4444");
		const retColor = (v) => v === null ? "#94a3b8" : (v > 5 ? "#10b981" : v < -5 ? "#ef4444" : v > 0 ? "#34d399" : "#f87171");

		const sortLabel = {
			rotation_score: "Score", ret_1W: "1W Ret", ret_1M: "1M Ret", ret_3M: "3M Ret", ret_6M: "6M Ret",
		}[key] || key;

		const header = `
			<div class="tj-rot-header-row">
				<span>#</span>
				<span>Sector</span>
				<span>${sortLabel} bar</span>
				<span>1W</span>
				<span>1M</span>
				<span>3M</span>
				<span>6M</span>
				<span>Momentum</span>
			</div>
		`;

		const rows = sorted.map((s, i) => {
			const q = Q[s.quadrant] || Q.Unknown;
			const barPct = ((s[key] || 0) / maxAbs * 100).toFixed(1);
			const barColor = (s[key] || 0) >= 0 ? "#10b981" : "#ef4444";
			const leaders = (s.top_5_1m || s.top_3_1m || []).slice(0, 4).map(l =>
				`<span class="tj-rot-leader">${l.symbol}</span>`
			).join("<span style='color:#cbd5e1;font-size:10px'> · </span>");
			return `
				<div class="tj-rot-sector-row">
					<span class="tj-rot-rank">${i + 1}</span>
					<div>
						<div class="tj-rot-name">${frappe.utils.escape_html(s.industry || "")}</div>
						<div class="tj-rot-leader-chips" style="margin-top:2px">${leaders}</div>
						<span class="tj-rot-q-badge" style="background:${q.bg};color:${q.color};margin-top:3px;">${q.icon} ${q.label}</span>
					</div>
					<div class="tj-rot-bar-cell">
						<div class="tj-rot-bar-outer">
							<div class="tj-rot-bar-inner" style="width:${Math.abs(barPct)}%;background:${barColor};"></div>
						</div>
					</div>
					<span class="tj-rot-ret" style="color:${retColor(s.ret_1W)}">${fmtR(s.ret_1W)}</span>
					<span class="tj-rot-ret" style="color:${retColor(s.ret_1M)}">${fmtR(s.ret_1M)}</span>
					<span class="tj-rot-ret" style="color:${retColor(s.ret_3M)}">${fmtR(s.ret_3M)}</span>
					<span class="tj-rot-ret" style="color:${retColor(s.ret_6M)}">${fmtR(s.ret_6M)}</span>
					<span class="tj-rot-delta" style="color:${deltaColor(s.momentum_delta)}">${fmtDelta(s.momentum_delta)}</span>
				</div>
			`;
		}).join("");

		$wrap.html(`
			<div class="tj-rot-bars-head">Sector Rankings</div>
			${header}
			${rows}
		`);
	}
}
