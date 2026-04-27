frappe.pages["trade-review"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Review",
		single_column: true,
	});
	new TradeReview(page);
};

class TradeReview {
	constructor(page) {
		this.page = page;
		this.period = "week";
		this.anchor = frappe.datetime.get_today();
		this.page.set_primary_action(__("Save Review"), () => this._save_review_pdf(), "save");
		this.page.add_button(__("Export Tax CSV"), () => this._tax_dialog(), { icon: "file" });
		this._inject_styles();
		this._render_shell();
		this._refresh();
	}

	_render_shell() {
		this.page.main.html(`
			<div class="tr-root">
				<div class="tr-controls no-print">
					<div class="tr-period-toggle">
						<button class="tr-tab active" data-period="week">📅 Weekly</button>
						<button class="tr-tab" data-period="month">📆 Monthly</button>
					</div>
					<div class="tr-nav">
						<button class="btn btn-default tr-prev">←</button>
						<button class="btn btn-default tr-today">Today</button>
						<button class="btn btn-default tr-next">→</button>
					</div>
				</div>

				<div class="tr-report">
					<div class="tr-hero">
						<div class="tr-hero-kicker" id="tr-period-label"></div>
						<h1 class="tr-hero-title">Trading Review</h1>
						<div class="tr-hero-range" id="tr-range"></div>
					</div>

					<div class="tr-summary" id="tr-summary"></div>
					<div class="tr-compare" id="tr-compare"></div>

					<h3 class="tr-section-title">Setup Performance</h3>
					<div id="tr-setups"></div>

					<h3 class="tr-section-title">Mistake Leaks</h3>
					<div id="tr-mistakes"></div>

					<h3 class="tr-section-title">Highlights</h3>
					<div class="tr-highlights" id="tr-highlights"></div>

					<h3 class="tr-section-title">Trade Log</h3>
					<div id="tr-log"></div>

					<h3 class="tr-section-title">
						Reflection
						<span class="tr-save-status no-print" id="tr-save-status"></span>
					</h3>
					<div class="tr-reflect">
						<div class="tr-reflect-block">
							<label class="tr-reflect-label" for="tr-went-right">What went right?</label>
							<textarea id="tr-went-right" class="tr-reflect-input" data-key="went_right" rows="3" placeholder="Setups that worked, disciplined entries, good exits…"></textarea>
						</div>
						<div class="tr-reflect-block">
							<label class="tr-reflect-label" for="tr-went-wrong">What went wrong?</label>
							<textarea id="tr-went-wrong" class="tr-reflect-input" data-key="went_wrong" rows="3" placeholder="Mistakes, emotional trades, broken rules…"></textarea>
						</div>
						<div class="tr-reflect-block">
							<label class="tr-reflect-label" for="tr-improvement">One thing to improve next period</label>
							<textarea id="tr-improvement" class="tr-reflect-input" data-key="improvement" rows="3" placeholder="Concrete action you'll take next week/month…"></textarea>
						</div>
					</div>
				</div>
			</div>
		`);

		// Debounced auto-save on reflection textareas
		let saveTimer = null;
		this.page.main.on("input", ".tr-reflect-input", () => {
			clearTimeout(saveTimer);
			this._set_save_status("Unsaved…", "#f59e0b");
			saveTimer = setTimeout(() => this._save_reflection(), 800);
		});

		this.page.main.find(".tr-tab").on("click", (e) => {
			this.period = $(e.currentTarget).data("period");
			this.page.main.find(".tr-tab").removeClass("active");
			$(e.currentTarget).addClass("active");
			this._refresh();
		});
		this.page.main.find(".tr-prev").on("click", () => this._shift(-1));
		this.page.main.find(".tr-next").on("click", () => this._shift(1));
		this.page.main.find(".tr-today").on("click", () => {
			this.anchor = frappe.datetime.get_today();
			this._refresh();
		});
	}

	_shift(n) {
		const days = this.period === "week" ? 7 * n : 30 * n;
		this.anchor = frappe.datetime.add_days(this.anchor, days);
		this._refresh();
	}

	_refresh() {
		frappe.call({
			method: "trading_journal.trading_journal.page.trade_review.trade_review.get_review",
			args: { period: this.period, anchor: this.anchor },
			callback: (r) => {
				this.data = r.message || {};
				this._render(this.data);
			},
		});
	}

	_render(d) {
		if (!d.start) return;
		$("#tr-period-label").text(this.period === "week" ? "WEEKLY REVIEW" : "MONTHLY REVIEW");
		$("#tr-range").text(`${d.start}  →  ${d.end}`);

		const s = d.stats || {};
		$("#tr-summary").html(`
			<div class="tr-kpi-grid">
				${this._kpi("Net P&L", format_currency(s.pnl), s.pnl >= 0 ? "pos" : "neg")}
				${this._kpi("Trades", s.total)}
				${this._kpi("Win Rate", s.win_rate + "%", s.win_rate >= 50 ? "pos" : "neg")}
				${this._kpi("Profit Factor", s.profit_factor + "x", s.profit_factor >= 1.5 ? "pos" : (s.profit_factor < 1 ? "neg" : ""))}
				${this._kpi("Avg R", s.avg_r + "R", s.avg_r >= 0.5 ? "pos" : (s.avg_r < 0 ? "neg" : ""))}
				${this._kpi("Best Trade", format_currency(s.best), "pos")}
				${this._kpi("Worst Trade", format_currency(s.worst), "neg")}
			</div>
		`);

		const p = d.prev_stats || {};
		const delta = (a, b) => {
			if (b === 0 && a === 0) return "—";
			const diff = a - b;
			const pct = b ? (diff / Math.abs(b) * 100).toFixed(0) : "—";
			return `<span style="color:${diff >= 0 ? '#10b981' : '#f43f5e'}">${diff >= 0 ? "▲" : "▼"} ${pct === "—" ? "" : pct + "%"}</span>`;
		};
		$("#tr-compare").html(`
			<div class="tr-compare-card">
				<div class="tr-compare-title">vs Previous Period</div>
				<div class="tr-compare-grid">
					<div><span class="tr-compare-label">P&L</span> ${format_currency(s.pnl)} ${delta(s.pnl, p.pnl)} <span class="tr-compare-prev">was ${format_currency(p.pnl)}</span></div>
					<div><span class="tr-compare-label">Win Rate</span> ${s.win_rate}% ${delta(s.win_rate, p.win_rate)} <span class="tr-compare-prev">was ${p.win_rate}%</span></div>
					<div><span class="tr-compare-label">Trades</span> ${s.total} ${delta(s.total, p.total)} <span class="tr-compare-prev">was ${p.total}</span></div>
				</div>
			</div>
		`);

		// Setups
		const setupRows = (d.setups || []).map(x => `
			<tr>
				<td><b>${x.setup}</b></td>
				<td>${x.total}</td>
				<td>${x.wins}</td>
				<td>${x.win_rate}%</td>
				<td style="color:${x.pnl >= 0 ? '#10b981' : '#f43f5e'};font-weight:700">${format_currency(x.pnl)}</td>
			</tr>
		`).join("");
		$("#tr-setups").html(`
			<table class="tr-table">
				<thead><tr><th>Setup</th><th>Trades</th><th>Wins</th><th>Win%</th><th>P&L</th></tr></thead>
				<tbody>${setupRows || '<tr><td colspan="5" class="tr-empty">No trades in range.</td></tr>'}</tbody>
			</table>
		`);

		// Mistakes
		if (!d.mistakes || !d.mistakes.length) {
			$("#tr-mistakes").html('<div class="tr-empty">No mistakes tagged in this period.</div>');
		} else {
			const rows = d.mistakes.map(m => `
				<tr>
					<td><b>${m.mistake}</b></td>
					<td>${m.count}×</td>
					<td style="color:${m.pnl >= 0 ? '#10b981' : '#f43f5e'};font-weight:700">${format_currency(m.pnl)}</td>
				</tr>
			`).join("");
			$("#tr-mistakes").html(`
				<table class="tr-table">
					<thead><tr><th>Mistake</th><th>Occurrences</th><th>Total P&L Impact</th></tr></thead>
					<tbody>${rows}</tbody>
				</table>
			`);
		}

		// Best/Worst
		const card = (t, kind) => {
			if (!t) return `<div class="tr-highlight tr-${kind}"><div class="tr-empty">No trades</div></div>`;
			const color = kind === "best" ? "#10b981" : "#f43f5e";
			return `
				<div class="tr-highlight tr-${kind}">
					<div class="tr-highlight-label">${kind === "best" ? "Best Trade" : "Worst Trade"}</div>
					<div class="tr-highlight-pnl" style="color:${color}">${format_currency(t.pnl)}</div>
					<div class="tr-highlight-sym"><b>${t.symbol}</b> · ${t.date}</div>
					<div class="tr-highlight-meta">${t.setup ? t.setup + " · " : ""}R-Multiple: ${t.r_multiple}R</div>
				</div>
			`;
		};
		$("#tr-highlights").html(`${card(d.best, "best")} ${card(d.worst, "worst")}`);

		// Trade log
		const logRows = (d.trades || []).map(t => `
			<tr>
				<td>${t.date}</td>
				<td><b>${t.symbol}</b></td>
				<td>${t.type}</td>
				<td>${t.setup}</td>
				<td><span class="tr-status tr-status-${(t.status || 'open').toLowerCase()}">${t.status}</span></td>
				<td>${t.entry}</td>
				<td>${t.exit}</td>
				<td>${t.rr.toFixed(2)}x</td>
				<td>${t.r_multiple.toFixed(2)}R</td>
				<td>${t.grade || '-'}</td>
				<td style="color:${t.pnl >= 0 ? '#10b981' : '#f43f5e'};font-weight:700">${format_currency(t.pnl)}</td>
			</tr>
		`).join("");
		$("#tr-log").html(`
			<table class="tr-table tr-log-table">
				<thead><tr>
					<th>Date</th><th>Symbol</th><th>Type</th><th>Setup</th><th>Status</th>
					<th>Entry</th><th>Exit</th><th>R:R</th><th>R</th><th>Grade</th><th>P&L</th>
				</tr></thead>
				<tbody>${logRows || '<tr><td colspan="11" class="tr-empty">No trades</td></tr>'}</tbody>
			</table>
		`);

		// Populate reflection textareas from loaded entry
		const r = d.reflection || {};
		$("#tr-went-right").val(r.went_right || "");
		$("#tr-went-wrong").val(r.went_wrong || "");
		$("#tr-improvement").val(r.improvement || "");
		this._set_save_status(
			(r.went_right || r.went_wrong || r.improvement) ? "✓ Loaded" : "",
			"#10b981"
		);
	}

	_save_reflection() {
		if (!this.data || !this.data.start) return;
		const payload = {
			period: this.period,
			start: this.data.start,
			end: this.data.end,
			went_right: $("#tr-went-right").val() || "",
			went_wrong: $("#tr-went-wrong").val() || "",
			improvement: $("#tr-improvement").val() || "",
		};
		this._set_save_status("Saving…", "#6366f1");
		frappe.call({
			method: "trading_journal.trading_journal.page.trade_review.trade_review.save_reflection",
			args: payload,
			callback: (r) => {
				if (r.message && r.message.ok) {
					this._set_save_status("✓ Saved", "#10b981");
				} else {
					this._set_save_status("✗ Failed", "#f43f5e");
				}
			},
			error: () => this._set_save_status("✗ Failed", "#f43f5e"),
		});
	}

	_set_save_status(text, color) {
		$("#tr-save-status").text(text).css("color", color || "#64748b");
	}

	async _save_review_pdf() {
		if (!this.data || !this.data.start) {
			frappe.show_alert({ message: "Nothing to save yet.", indicator: "orange" });
			return;
		}
		// Persist reflections first so they appear in the PDF
		await new Promise((resolve) => {
			frappe.call({
				method: "trading_journal.trading_journal.page.trade_review.trade_review.save_reflection",
				args: {
					period: this.period,
					start: this.data.start,
					end: this.data.end,
					went_right: $("#tr-went-right").val() || "",
					went_wrong: $("#tr-went-wrong").val() || "",
					improvement: $("#tr-improvement").val() || "",
				},
				callback: () => resolve(),
				error: () => resolve(),
			});
		});

		frappe.call({
			method: "trading_journal.trading_journal.page.trade_review.trade_review.save_review_pdf",
			args: { period: this.period, start: this.data.start, end: this.data.end },
			freeze: true,
			freeze_message: "Generating PDF…",
			callback: (r) => {
				const m = r.message || {};
				if (m.ok) {
					frappe.msgprint({
						title: __("Review Saved"),
						indicator: "green",
						message: `
							<p>Saved as <b>${frappe.utils.escape_html(m.file_name)}</b></p>
							<p style="margin-top:10px">
								<a href="${m.file_url}" target="_blank" class="btn btn-primary btn-sm">📄 Open PDF</a>
								<a href="/app/trade-review-entry/${encodeURIComponent(m.entry_name)}" class="btn btn-default btn-sm">View Entry</a>
								<a href="/app/file?attached_to_doctype=Trade Review Entry" target="_blank" class="btn btn-default btn-sm">All Review PDFs</a>
							</p>
						`,
					});
					this._set_save_status("✓ Saved & PDF generated", "#10b981");
				} else {
					frappe.msgprint({
						title: __("Could not save"),
						indicator: "red",
						message: m.error || "Unknown error",
					});
				}
			},
		});
	}

	_kpi(label, value, cls) {
		return `
			<div class="tr-kpi">
				<div class="tr-kpi-label">${label}</div>
				<div class="tr-kpi-value ${cls || ''}">${value}</div>
			</div>
		`;
	}

	_tax_dialog() {
		const d = new frappe.ui.Dialog({
			title: __("Tax Export (Indian FY)"),
			fields: [
				{ fieldtype: "Date", fieldname: "fy_start", label: "FY Start", default: this._default_fy()[0] },
				{ fieldtype: "Date", fieldname: "fy_end", label: "FY End", default: this._default_fy()[1] },
				{ fieldtype: "Select", fieldname: "category", label: "Category",
				  options: ["intraday", "stcg", "ltcg"].join("\n"), default: "intraday",
				  description: "Intraday = speculative, STCG = <1yr, LTCG = ≥1yr" },
			],
			primary_action_label: __("Download CSV"),
			primary_action: (v) => {
				const url = `/api/method/trading_journal.trading_journal.utils.tax_export.download_csv?fy_start=${v.fy_start}&fy_end=${v.fy_end}&category=${v.category}`;
				window.open(url, "_blank");
				d.hide();
			},
		});
		d.show();
	}

	_default_fy() {
		const today = new Date();
		const y = today.getFullYear();
		if (today.getMonth() >= 3) return [`${y}-04-01`, `${y + 1}-03-31`];
		return [`${y - 1}-04-01`, `${y}-03-31`];
	}

	_inject_styles() {
		if ($("#tr-styles").length) return;
		$("head").append(`<style id="tr-styles">
			body [data-page-route="trade-review"] .container,
			body [data-page-route="trade-review"] .page-body,
			body [data-page-route="trade-review"] .layout-main-section { max-width:100% !important; width:100% !important; }
			body [data-page-route="trade-review"] .page-body { background:#f6f7fb; }

			.tr-root { padding:20px; max-width:1100px; margin:0 auto; color:#0f172a; font-feature-settings:"tnum" 1; }
			.tr-controls { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:10px; }
			.tr-period-toggle { display:flex; gap:4px; background:#fff; border:1px solid #e6e8f0; border-radius:10px; padding:4px; box-shadow:0 1px 3px rgba(15,23,42,.04); }
			.tr-tab { border:0; background:transparent; padding:8px 18px; font-weight:600; font-size:13px; color:#64748b; border-radius:8px; cursor:pointer; transition:background .15s; }
			.tr-tab.active { background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; box-shadow:0 2px 8px rgba(99,102,241,.4); }
			.tr-nav { display:flex; gap:6px; }

			.tr-report { background:#fff; border-radius:16px; padding:40px 48px; box-shadow:0 4px 16px rgba(15,23,42,.06); }
			.tr-hero { text-align:center; padding:20px 0 30px; border-bottom:2px solid #f1f2f8; margin-bottom:30px; }
			.tr-hero-kicker { font-size:11px; color:#6366f1; font-weight:800; letter-spacing:2px; margin-bottom:10px; }
			.tr-hero-title { font-size:36px; font-weight:800; letter-spacing:-1px; margin:0 0 8px; background:linear-gradient(135deg,#6366f1,#8b5cf6,#d946ef); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
			.tr-hero-range { color:#64748b; font-size:14px; font-weight:600; }

			.tr-kpi-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:12px; margin-bottom:24px; }
			.tr-kpi { background:#f8f9fd; border:1px solid #e6e8f0; border-radius:10px; padding:14px 16px; }
			.tr-kpi-label { font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:.5px; font-weight:700; }
			.tr-kpi-value { font-size:22px; font-weight:800; margin-top:4px; letter-spacing:-.3px; }
			.tr-kpi-value.pos { color:#10b981; }
			.tr-kpi-value.neg { color:#f43f5e; }

			.tr-compare-card { background:linear-gradient(135deg,#f1f2f8,#e6e8f0); border-radius:12px; padding:16px 20px; margin-bottom:30px; }
			.tr-compare-title { font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:.5px; font-weight:700; margin-bottom:10px; }
			.tr-compare-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; font-size:13px; }
			.tr-compare-label { font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:.4px; font-weight:700; display:block; margin-bottom:2px; }
			.tr-compare-prev { color:#94a3b8; font-size:11px; margin-left:4px; }

			.tr-section-title { font-size:16px; font-weight:800; margin:32px 0 12px; padding-bottom:8px; border-bottom:2px solid #f1f2f8; }
			.tr-table { width:100%; border-collapse:separate; border-spacing:0; font-size:12.5px; }
			.tr-table th { background:#f1f2f8; padding:10px; text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.4px; color:#64748b; font-weight:700; }
			.tr-table td { padding:10px; border-bottom:1px solid #f0f1f7; }
			.tr-log-table { font-size:11px; }
			.tr-log-table th, .tr-log-table td { padding:7px 8px; }
			.tr-empty { color:#94a3b8; font-style:italic; text-align:center; padding:14px; }

			.tr-highlights { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
			.tr-highlight { padding:18px 22px; border-radius:12px; border:1px solid #e6e8f0; }
			.tr-highlight.tr-best { background:linear-gradient(135deg, #d1fae5, #ecfdf5); border-color:#a7f3d0; }
			.tr-highlight.tr-worst { background:linear-gradient(135deg, #ffe4e6, #fef2f2); border-color:#fecdd3; }
			.tr-highlight-label { font-size:10px; text-transform:uppercase; letter-spacing:.5px; font-weight:700; color:#64748b; }
			.tr-highlight-pnl { font-size:30px; font-weight:800; letter-spacing:-.5px; margin:6px 0 4px; }
			.tr-highlight-sym { font-size:14px; }
			.tr-highlight-meta { font-size:11px; color:#64748b; margin-top:4px; }

			.tr-status { padding:2px 8px; border-radius:999px; font-size:10px; font-weight:700; }
			.tr-status-win { background:#d1fae5; color:#065f46; }
			.tr-status-loss { background:#ffe4e6; color:#9f1239; }
			.tr-status-open { background:#e0f2fe; color:#075985; }
			.tr-status-breakeven { background:#fef3c7; color:#92400e; }

			.tr-reflect { display:grid; gap:18px; }
			.tr-reflect-block { display:flex; flex-direction:column; gap:6px; }
			.tr-reflect-label { font-weight:700; font-size:13px; color:#334155; display:block; }
			.tr-reflect-input {
				width:100%; min-height:70px;
				border:1px solid #e6e8f0; border-radius:10px;
				padding:10px 12px; font-size:13px; line-height:1.5;
				background:#f8f9fd; color:#0f172a;
				resize:vertical; font-family:inherit;
				transition: border-color .15s, background .15s, box-shadow .15s;
			}
			.tr-reflect-input:focus {
				outline:none; border-color:#6366f1; background:#fff;
				box-shadow:0 0 0 3px rgba(99,102,241,.12);
			}
			.tr-reflect-input::placeholder { color:#94a3b8; }
			.tr-save-status {
				margin-left:10px; font-size:11px; font-weight:600;
				color:#64748b; text-transform:none; letter-spacing:0;
			}

			@media print {
				@page { margin: 1.2cm; size: A4 portrait; }
				body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
				/* Hide desk chrome */
				body [data-page-route="trade-review"] .page-head,
				body [data-page-route="trade-review"] .navbar,
				body [data-page-route="trade-review"] .desk-sidebar,
				body [data-page-route="trade-review"] .layout-side-section,
				body [data-page-route="trade-review"] footer,
				body > .navbar, body > header, .page-head, .sidebar,
				.no-print { display:none !important; }
				/* Flatten body */
				body, body [data-page-route="trade-review"] .page-body,
				body [data-page-route="trade-review"] .container,
				body [data-page-route="trade-review"] .layout-main-section { background:#fff !important; padding:0 !important; margin:0 !important; max-width:100% !important; }
				.tr-root { padding:0 !important; max-width:100% !important; }
				.tr-report { box-shadow:none !important; padding:20px !important; border:0 !important; border-radius:0 !important; }
				/* Preserve gradient heading in print */
				.tr-hero-title { -webkit-text-fill-color:#6366f1 !important; color:#6366f1 !important; background:none !important; }
				/* Textareas print flat */
				.tr-reflect-input { border:1px solid #cbd5e1 !important; background:#fff !important; box-shadow:none !important; min-height:60px; }
				/* Avoid awkward page breaks inside blocks */
				.tr-kpi-grid, .tr-table, .tr-highlights, .tr-reflect-block { break-inside: avoid; }
				.tr-section-title { break-after: avoid; }
			}
		</style>`);
	}
}
