frappe.pages["position-sizer"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Position Sizer",
		single_column: true,
	});
	new PositionSizerPage(page);
};

/* ─────────────────────────────────────────────────── */
/*  LOT SIZES for common F&O instruments               */
/* ─────────────────────────────────────────────────── */
const FNO_LOTS = {
	"NIFTY": 75, "BANKNIFTY": 30, "FINNIFTY": 40, "MIDCPNIFTY": 75,
	"SENSEX": 20, "BANKEX": 30,
	"RELIANCE": 250, "TCS": 150, "INFY": 300, "HDFCBANK": 550,
	"ICICIBANK": 700, "SBIN": 1500, "AXISBANK": 625, "KOTAKBANK": 400,
	"BAJFINANCE": 125, "BHARTIARTL": 950, "WIPRO": 1500, "SUNPHARMA": 350,
	"TATAMOTORS": 900, "TATASTEEL": 5500, "LT": 150, "NTPC": 2250,
	"POWERGRID": 4700, "ONGC": 1925, "ADANIENT": 250, "HCLTECH": 350,
	"MARUTI": 50, "ULTRACEMCO": 50, "TITAN": 175, "ASIANPAINT": 200,
};

class PositionSizerPage {
	constructor(page) {
		this.page = page;
		this.mode = "equity"; // equity | fno
		this._inject_styles();
		this._render();
		this._bind();
	}

	_inject_styles() {
		if (document.getElementById("tj-ps-css")) return;
		const css = `
		.tj-ps-wrap { padding: 14px; max-width: 900px; margin: 0 auto; }

		/* ── Hero ── */
		.tj-ps-hero {
			background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0e4429 100%);
			border-radius: 14px; padding: 22px 28px; color: #fff; margin-bottom: 20px;
			position: relative; overflow: hidden;
		}
		.tj-ps-hero::before {
			content: ""; position: absolute; inset: 0;
			background: radial-gradient(700px 200px at 80% -10%, rgba(16,185,129,.2), transparent 60%);
			pointer-events: none;
		}
		.tj-ps-hero h2 { margin: 0; font-size: 22px; font-weight: 900; }
		.tj-ps-hero .sub { font-size: 12px; opacity: .75; margin-top: 4px; }

		/* ── Mode toggle ── */
		.tj-ps-mode {
			display: inline-flex; background: rgba(255,255,255,.1); border-radius: 8px;
			padding: 4px; margin-top: 14px; gap: 4px;
		}
		.tj-ps-mode-btn {
			padding: 7px 20px; border-radius: 6px; font-size: 12px; font-weight: 700;
			cursor: pointer; color: rgba(255,255,255,.6); transition: all .15s; border: 0;
			background: transparent;
		}
		.tj-ps-mode-btn.active { background: #10b981; color: #fff; }

		/* ── Grid ── */
		.tj-ps-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
		@media (max-width: 640px) { .tj-ps-grid { grid-template-columns: 1fr; } }

		/* ── Input card ── */
		.tj-ps-inputs {
			background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
			padding: 22px; display: flex; flex-direction: column; gap: 16px;
		}
		.tj-ps-field { display: flex; flex-direction: column; gap: 5px; }
		.tj-ps-field label {
			font-size: 10px; font-weight: 700; text-transform: uppercase;
			letter-spacing: .5px; color: #64748b;
		}
		.tj-ps-field input, .tj-ps-field select {
			border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 12px;
			font-size: 15px; font-weight: 700; color: #0f172a;
			transition: border-color .15s, box-shadow .15s;
		}
		.tj-ps-field input:focus, .tj-ps-field select:focus {
			outline: none; border-color: #10b981;
			box-shadow: 0 0 0 3px rgba(16,185,129,.15);
		}
		.tj-ps-field input.err { border-color: #ef4444; }
		.tj-ps-field .hint { font-size: 10px; color: #94a3b8; font-weight: 600; }
		.tj-ps-risk-btns { display: flex; gap: 6px; flex-wrap: wrap; }
		.tj-ps-risk-btn {
			padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 700;
			cursor: pointer; background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0;
			transition: all .12s;
		}
		.tj-ps-risk-btn:hover, .tj-ps-risk-btn.active { background: #10b981; color: #fff; border-color: #10b981; }

		/* ── Output card ── */
		.tj-ps-outputs {
			background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
			padding: 22px; display: flex; flex-direction: column; gap: 14px;
		}
		.tj-ps-result-row {
			display: flex; justify-content: space-between; align-items: center;
			padding: 10px 14px; border-radius: 10px; background: #f8fafc;
			border: 1px solid #f1f5f9;
		}
		.tj-ps-result-row.highlight {
			background: linear-gradient(135deg, #f0fdf4, #ecfdf5);
			border-color: #a7f3d0;
		}
		.tj-ps-result-row.warn { background: #fef9c3; border-color: #fde047; }
		.tj-ps-result-row.danger { background: #fff1f2; border-color: #fecdd3; }
		.tj-ps-rl { font-size: 11px; font-weight: 700; text-transform: uppercase;
			letter-spacing: .4px; color: #64748b; }
		.tj-ps-rv { font-size: 18px; font-weight: 900; color: #0f172a; }
		.tj-ps-rv.green { color: #10b981; }
		.tj-ps-rv.red { color: #ef4444; }
		.tj-ps-rv.amber { color: #f59e0b; }

		/* ── Trade bar visualization ── */
		.tj-ps-bar-wrap {
			background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
			padding: 22px; margin-top: 16px;
		}
		.tj-ps-bar-title { font-size: 11px; font-weight: 700; text-transform: uppercase;
			letter-spacing: .6px; color: #64748b; margin-bottom: 14px;
			display: flex; align-items: center; gap: 8px; }
		.tj-ps-bar-title::before { content: ""; width: 4px; height: 14px; border-radius: 2px;
			background: linear-gradient(180deg, #10b981, #0ea5e9); }
		.tj-ps-track { position: relative; height: 28px; border-radius: 6px;
			background: #f1f5f9; overflow: visible; margin: 0 10px; }
		.tj-ps-track-fill { position: absolute; top: 0; bottom: 0; border-radius: 6px;
			transition: all .3s; }
		.tj-ps-marker { position: absolute; top: -6px; bottom: -6px; width: 4px;
			border-radius: 2px; transform: translateX(-50%); }
		.tj-ps-marker-label { position: absolute; top: -22px; font-size: 10px;
			font-weight: 800; white-space: nowrap; transform: translateX(-50%); letter-spacing: .3px; }
		.tj-ps-marker-pct { position: absolute; bottom: -20px; font-size: 10px;
			font-weight: 700; white-space: nowrap; transform: translateX(-50%); color: #94a3b8; }
		.tj-ps-bar-labels { display: flex; justify-content: space-between; margin-top: 28px;
			font-size: 11px; color: #64748b; font-weight: 600; }

		/* ── RR gauge ── */
		.tj-ps-rr-gauge {
			margin-top: 16px; text-align: center; padding: 20px;
			background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
		}
		.tj-ps-rr-num { font-size: 56px; font-weight: 900; letter-spacing: -2px; line-height: 1; }
		.tj-ps-rr-label { font-size: 11px; text-transform: uppercase; letter-spacing: .6px;
			color: #64748b; font-weight: 700; margin-top: 4px; }
		.tj-ps-rr-verdict { font-size: 13px; font-weight: 700; margin-top: 8px; }

		/* ── Tips ── */
		.tj-ps-tip {
			font-size: 11px; padding: 8px 12px; border-radius: 8px;
			background: #fffbeb; border: 1px solid #fde68a; color: #92400e;
			font-weight: 600; margin-top: 8px;
		}
		`;
		const s = document.createElement("style");
		s.id = "tj-ps-css";
		s.textContent = css;
		document.head.appendChild(s);
	}

	_render() {
		$(this.page.body).empty().append(`
			<div class="tj-ps-wrap">
				<div class="tj-ps-hero">
					<h2>⚖️ Position Sizer</h2>
					<div class="sub">Risk-based position sizing. Know your exact quantity, risk rupees, and R:R before entering any trade.</div>
					<div class="tj-ps-mode">
						<button class="tj-ps-mode-btn active" data-mode="equity">Equity</button>
						<button class="tj-ps-mode-btn" data-mode="fno">F&amp;O / Futures</button>
					</div>
				</div>

				<div class="tj-ps-grid">
					<!-- INPUTS -->
					<div class="tj-ps-inputs">
						<div style="font-size:13px;font-weight:800;color:#0f172a;border-bottom:1px solid #f1f5f9;padding-bottom:10px;">Trade Parameters</div>

						<div class="tj-ps-field">
							<label>Total Capital (₹)</label>
							<input type="number" id="ps-capital" value="500000" min="1000" step="10000">
						</div>

						<div class="tj-ps-field">
							<label>Risk per Trade (%)</label>
							<input type="number" id="ps-risk-pct" value="1" min="0.1" max="10" step="0.1">
							<div class="tj-ps-risk-btns">
								<button class="tj-ps-risk-btn" data-risk="0.5">0.5%</button>
								<button class="tj-ps-risk-btn active" data-risk="1">1%</button>
								<button class="tj-ps-risk-btn" data-risk="1.5">1.5%</button>
								<button class="tj-ps-risk-btn" data-risk="2">2%</button>
							</div>
						</div>

						<div class="tj-ps-field">
							<label>Entry Price (₹)</label>
							<input type="number" id="ps-entry" placeholder="e.g. 1250.00" min="0" step="0.05">
						</div>

						<div class="tj-ps-field">
							<label>Stop Loss (₹)</label>
							<input type="number" id="ps-sl" placeholder="e.g. 1200.00" min="0" step="0.05">
							<div class="hint" id="ps-sl-hint"></div>
						</div>

						<div class="tj-ps-field">
							<label>Target Price (₹) <span style="color:#94a3b8;font-size:9px;">(optional)</span></label>
							<input type="number" id="ps-target" placeholder="e.g. 1400.00" min="0" step="0.05">
						</div>

						<div id="ps-fno-row" style="display:none;">
							<div class="tj-ps-field">
								<label>Lot Size (shares per lot)</label>
								<input type="number" id="ps-lot-size" placeholder="e.g. 75 for Nifty" min="1" step="1">
								<div class="hint">Common lots auto-filled when you type a symbol above</div>
							</div>
							<div class="tj-ps-field" style="margin-top:10px;">
								<label>F&amp;O Symbol (optional — auto-fills lot size)</label>
								<input type="text" id="ps-fno-sym" placeholder="e.g. NIFTY, BANKNIFTY, RELIANCE" style="text-transform:uppercase;">
							</div>
						</div>
					</div>

					<!-- OUTPUTS -->
					<div class="tj-ps-outputs" id="ps-outputs">
						<div style="font-size:13px;font-weight:800;color:#0f172a;border-bottom:1px solid #f1f5f9;padding-bottom:10px;">Calculated Position</div>
						<div class="tj-rot-empty" style="color:#94a3b8;padding:20px 0;text-align:center;">Enter entry & SL to calculate →</div>
					</div>
				</div>

				<!-- BAR + GAUGE -->
				<div id="ps-visual" style="display:none;">
					<div class="tj-ps-grid">
						<div class="tj-ps-bar-wrap">
							<div class="tj-ps-bar-title">Trade Range Visualization</div>
							<div class="tj-ps-track" id="ps-track">
								<!-- filled dynamically -->
							</div>
							<div class="tj-ps-bar-labels">
								<span id="ps-lbl-sl" style="color:#ef4444;font-weight:800;"></span>
								<span id="ps-lbl-entry" style="color:#6366f1;font-weight:800;"></span>
								<span id="ps-lbl-target" style="color:#10b981;font-weight:800;"></span>
							</div>
						</div>
						<div class="tj-ps-rr-gauge" id="ps-rr-gauge" style="display:none;">
							<div class="tj-ps-rr-num" id="ps-rr-num">—</div>
							<div class="tj-ps-rr-label">Risk : Reward</div>
							<div class="tj-ps-rr-verdict" id="ps-rr-verdict"></div>
						</div>
					</div>
				</div>
			</div>
		`);
	}

	_bind() {
		const $b = $(this.page.body);

		$b.on("click", ".tj-ps-mode-btn", (e) => {
			this.mode = e.currentTarget.dataset.mode;
			$b.find(".tj-ps-mode-btn").removeClass("active");
			$(e.currentTarget).addClass("active");
			$b.find("#ps-fno-row").toggle(this.mode === "fno");
			this._calculate();
		});

		$b.on("click", ".tj-ps-risk-btn", (e) => {
			$b.find(".tj-ps-risk-btn").removeClass("active");
			$(e.currentTarget).addClass("active");
			$b.find("#ps-risk-pct").val(e.currentTarget.dataset.risk);
			this._calculate();
		});

		$b.on("input", "#ps-capital,#ps-risk-pct,#ps-entry,#ps-sl,#ps-target,#ps-lot-size", () => this._calculate());

		$b.on("input", "#ps-fno-sym", (e) => {
			const sym = (e.target.value || "").toUpperCase().trim();
			if (FNO_LOTS[sym]) {
				$b.find("#ps-lot-size").val(FNO_LOTS[sym]);
			}
			this._calculate();
		});
	}

	_calculate() {
		const $b = $(this.page.body);
		const capital   = parseFloat($b.find("#ps-capital").val()) || 0;
		const riskPct   = parseFloat($b.find("#ps-risk-pct").val()) || 0;
		const entry     = parseFloat($b.find("#ps-entry").val()) || 0;
		const sl        = parseFloat($b.find("#ps-sl").val()) || 0;
		const target    = parseFloat($b.find("#ps-target").val()) || 0;
		const lotSize   = this.mode === "fno" ? (parseInt($b.find("#ps-lot-size").val()) || 1) : 1;

		if (!entry || !sl || sl >= entry) {
			$b.find("#ps-sl-hint").text(sl >= entry ? "⚠ SL must be below entry" : "");
			$b.find("#ps-outputs").html(`
				<div style="font-size:13px;font-weight:800;color:#0f172a;border-bottom:1px solid #f1f5f9;padding-bottom:10px;">Calculated Position</div>
				<div style="color:#94a3b8;padding:20px 0;text-align:center;">Enter entry & SL to calculate →</div>
			`);
			$b.find("#ps-visual").hide();
			return;
		}

		$b.find("#ps-sl-hint").text("");

		const riskPerShare = entry - sl;
		const slPct        = (riskPerShare / entry * 100);
		const riskAmount   = capital * riskPct / 100;

		// Raw qty, then round to lot boundary if F&O
		let rawQty = riskAmount / riskPerShare;
		let qty;
		if (this.mode === "fno") {
			const lots = Math.max(1, Math.floor(rawQty / lotSize));
			qty = lots * lotSize;
		} else {
			qty = Math.floor(rawQty);
		}
		if (qty < 1) qty = 1;

		const positionValue   = entry * qty;
		const actualRisk      = riskPerShare * qty;
		const capitalRiskPct  = actualRisk / capital * 100;
		const lots            = this.mode === "fno" ? Math.floor(qty / lotSize) : null;

		let rr = null, profit = null, tgtPct = null;
		if (target && target > entry) {
			const gainPerShare = target - entry;
			profit = gainPerShare * qty;
			rr = gainPerShare / riskPerShare;
			tgtPct = gainPerShare / entry * 100;
		}

		// Output colour helpers
		const green  = (v) => `<span class="tj-ps-rv green">${v}</span>`;
		const red    = (v) => `<span class="tj-ps-rv red">${v}</span>`;
		const rrClass = rr === null ? "" : (rr >= 2 ? "highlight" : rr >= 1.5 ? "" : "warn");
		const riskClass = capitalRiskPct > 2.5 ? "danger" : (capitalRiskPct > 1.5 ? "warn" : "highlight");

		const rows = [
			{ label: "Quantity", value: qty.toLocaleString("en-IN") + (lots !== null ? ` &nbsp;(${lots} lot${lots > 1 ? "s" : ""})` : ""), cls: "highlight" },
			{ label: "Position Value", value: `₹${positionValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, cls: "" },
			{ label: "Risk Amount", value: `₹${actualRisk.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, cls: riskClass },
			{ label: "Capital at Risk", value: `${capitalRiskPct.toFixed(2)}%`, cls: riskClass },
			{ label: "SL Distance", value: `${slPct.toFixed(2)}% &nbsp;(₹${riskPerShare.toFixed(2)}/share)`, cls: "" },
			...(profit !== null ? [
				{ label: "R:R Ratio", value: `${rr.toFixed(2)}:1`, cls: rrClass },
				{ label: "Expected Profit", value: `${green("₹" + profit.toLocaleString("en-IN", { maximumFractionDigits: 0 }))}`, cls: "highlight" },
				{ label: "Gain to Target", value: `+${tgtPct.toFixed(2)}%`, cls: "" },
			] : []),
		];

		$b.find("#ps-outputs").html(`
			<div style="font-size:13px;font-weight:800;color:#0f172a;border-bottom:1px solid #f1f5f9;padding-bottom:10px;">Calculated Position</div>
			${rows.map(r => `
				<div class="tj-ps-result-row ${r.cls}">
					<span class="tj-ps-rl">${r.label}</span>
					<span class="tj-ps-rv">${r.value}</span>
				</div>
			`).join("")}
			${capitalRiskPct > 2.5 ? `<div class="tj-ps-tip">⚠ You're risking ${capitalRiskPct.toFixed(2)}% of capital on one trade. Consider reducing risk% or checking if SL is too wide.</div>` : ""}
		`);

		// ── Trade bar ──
		const low  = Math.min(sl, entry, target || entry) * 0.998;
		const high = Math.max(sl, entry, target || entry) * 1.002;
		const range = high - low;
		const toW = (v) => ((v - low) / range * 100).toFixed(2);

		const slW  = toW(sl);
		const entW = toW(entry);
		const tgtW = target ? toW(target) : null;

		const $track = $b.find("#ps-track").empty();

		// Green fill (entry → target or just entry marker zone)
		if (tgtW !== null) {
			$track.append(`<div class="tj-ps-track-fill" style="left:${entW}%;width:${tgtW - entW}%;background:rgba(16,185,129,.25);"></div>`);
		}
		// Red fill (SL → entry)
		$track.append(`<div class="tj-ps-track-fill" style="left:${slW}%;width:${entW - slW}%;background:rgba(239,68,68,.2);"></div>`);

		// SL marker
		$track.append(`
			<div class="tj-ps-marker" style="left:${slW}%;background:#ef4444;">
				<div class="tj-ps-marker-label" style="color:#ef4444;">SL ₹${sl}</div>
				<div class="tj-ps-marker-pct">0%</div>
			</div>
		`);
		// Entry marker
		$track.append(`
			<div class="tj-ps-marker" style="left:${entW}%;background:#6366f1;">
				<div class="tj-ps-marker-label" style="color:#6366f1;">Entry ₹${entry}</div>
				<div class="tj-ps-marker-pct">+${slPct.toFixed(1)}%</div>
			</div>
		`);
		// Target marker
		if (tgtW !== null) {
			$track.append(`
				<div class="tj-ps-marker" style="left:${tgtW}%;background:#10b981;">
					<div class="tj-ps-marker-label" style="color:#10b981;">Target ₹${target}</div>
					<div class="tj-ps-marker-pct">+${tgtPct.toFixed(1)}%</div>
				</div>
			`);
		}
		$b.find("#ps-lbl-sl").text(`SL ₹${sl}`);
		$b.find("#ps-lbl-entry").text(`Entry ₹${entry}`);
		$b.find("#ps-lbl-target").text(target ? `Target ₹${target}` : "");

		// ── R:R gauge ──
		if (rr !== null) {
			const rrColor = rr >= 2 ? "#10b981" : rr >= 1.5 ? "#f59e0b" : "#ef4444";
			const verdict = rr >= 3 ? "Excellent setup 🎯" : rr >= 2 ? "Good R:R ✓" : rr >= 1.5 ? "Acceptable" : "Poor R:R — avoid ✗";
			$b.find("#ps-rr-num").text(`${rr.toFixed(1)}:1`).css("color", rrColor);
			$b.find("#ps-rr-verdict").text(verdict).css("color", rrColor);
			$b.find("#ps-rr-gauge").show();
		} else {
			$b.find("#ps-rr-gauge").hide();
		}

		$b.find("#ps-visual").show();
	}
}
