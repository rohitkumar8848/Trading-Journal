frappe.pages["trade-charts"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Trade Charts — Before & After",
		single_column: true,
	});
	new TradeChartsPage(page);
};

class TradeChartsPage {
	constructor(page) {
		this.page = page;
		this.from_date = frappe.datetime.add_months(frappe.datetime.get_today(), -3);
		this.to_date = frappe.datetime.get_today();
		this.outcome = "";
		this.symbol = "";
		this.include_reviewed = false;
		this._inject_styles();
		this._render_skeleton();
		this._bind_controls();
		this.refresh();
	}

	_inject_styles() {
		if (document.getElementById("tj-charts-css")) return;
		const css = `
		.tj-charts-wrap { padding: 14px; }
		.tj-charts-filters {
			background: linear-gradient(135deg, #6366f1, #a855f7);
			border-radius: 12px; padding: 16px 20px; color: #fff;
			display: flex; gap: 14px; align-items: end; flex-wrap: wrap;
			margin-bottom: 16px;
		}
		.tj-charts-filters label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: rgba(255,255,255,0.8); display: block; margin-bottom: 4px; }
		.tj-charts-filters input:not([type="checkbox"]), .tj-charts-filters select {
			border: 1px solid rgba(255,255,255,0.3); background: rgba(255,255,255,0.95);
			border-radius: 8px; padding: 6px 10px; font-size: 13px; min-width: 140px;
		}
		.tj-charts-filters input[type="checkbox"] {
			width: 16px; height: 16px; min-width: 0; padding: 0;
			border: 1px solid rgba(255,255,255,0.6); border-radius: 3px;
			accent-color: #10b981; cursor: pointer; vertical-align: middle;
		}
		.tj-charts-summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 18px; }
		.tj-sum-card { background: #fff; border-radius: 10px; padding: 14px 16px; border: 1px solid #e2e8f0; }
		.tj-sum-card .lbl { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
		.tj-sum-card .val { font-size: 22px; font-weight: 800; margin-top: 4px; color: #0f172a; }
		.tj-sum-card.win .val { color: #10b981; }
		.tj-sum-card.loss .val { color: #f43f5e; }
		.tj-sum-card.pnl-pos .val { color: #10b981; }
		.tj-sum-card.pnl-neg .val { color: #f43f5e; }

		.tj-trade-card {
			background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
			padding: 16px; margin-bottom: 16px;
		}
		.tj-trade-card.win { border-left: 4px solid #10b981; }
		.tj-trade-card.loss { border-left: 4px solid #f43f5e; }
		.tj-trade-card.breakeven { border-left: 4px solid #f59e0b; }

		.tj-card-head {
			display: flex; justify-content: space-between; align-items: start;
			flex-wrap: wrap; gap: 12px; margin-bottom: 14px;
		}
		.tj-card-meta h3 { margin: 0; font-size: 18px; font-weight: 800; color: #0f172a; }
		.tj-card-meta h3 a { color: inherit; text-decoration: none; }
		.tj-card-meta h3 a:hover { color: #6366f1; }
		.tj-card-meta .sub { font-size: 12px; color: #64748b; margin-top: 3px; }
		.tj-card-meta .tags { margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; }
		.tj-tag {
			display: inline-block; padding: 2px 8px; border-radius: 999px;
			font-size: 10px; font-weight: 700; text-transform: uppercase;
			background: #eef2ff; color: #4338ca;
		}
		.tj-tag.win { background: #d1fae5; color: #065f46; }
		.tj-tag.loss { background: #fee2e2; color: #991b1b; }
		.tj-tag.breakeven { background: #fef3c7; color: #92400e; }
		.tj-tag.reviewed { background: #d1fae5; color: #065f46; border: 1px solid #10b981; }
		.tj-trade-card.reviewed { opacity: 0.78; background: #f8fafc; }
		.tj-trade-card.reviewed:hover { opacity: 1; }

		.tj-card-pnl { text-align: right; }
		.tj-card-pnl .amount { font-size: 22px; font-weight: 800; }
		.tj-card-pnl .pct { font-size: 12px; color: #64748b; margin-top: 2px; }
		.tj-card-pnl.pos .amount { color: #10b981; }
		.tj-card-pnl.neg .amount { color: #f43f5e; }

		.tj-charts-grid {
			display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
		}
		@media (max-width: 768px) { .tj-charts-grid { grid-template-columns: 1fr; } }
		.tj-chart-slot {
			background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px;
			overflow: hidden; position: relative; min-height: 200px;
			display: flex; flex-direction: column;
		}
		.tj-chart-slot .lbl {
			background: #1e293b; color: #fff; padding: 6px 10px; font-size: 11px;
			font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
		}
		.tj-chart-slot .lbl.before { background: #4338ca; }
		.tj-chart-slot .lbl.after { background: #059669; }
		.tj-chart-slot img {
			width: 100%; display: block; flex: 1; object-fit: contain; cursor: zoom-in;
			background: #0f172a;
		}
		.tj-chart-slot .empty {
			flex: 1; display: flex; align-items: center; justify-content: center;
			color: #94a3b8; font-size: 13px; padding: 20px; text-align: center;
		}
		.tj-card-footer {
			margin-top: 12px; display: grid; grid-template-columns: repeat(4, 1fr);
			gap: 10px; font-size: 12px;
		}
		.tj-card-footer div { background: #f1f5f9; padding: 8px 10px; border-radius: 6px; }
		.tj-card-footer .k { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
		.tj-card-footer .v { font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 2px; }

		.tj-lightbox-backdrop {
			position: fixed; inset: 0; background: rgba(15,23,42,0.92); z-index: 9999;
			display: flex; align-items: center; justify-content: center; cursor: zoom-out;
		}
		.tj-lightbox-backdrop img { max-width: 92vw; max-height: 92vh; object-fit: contain; }

		.tj-empty-state {
			text-align: center; padding: 60px 20px; color: #64748b;
		}
		`;
		const style = document.createElement("style");
		style.id = "tj-charts-css";
		style.textContent = css;
		document.head.appendChild(style);
	}

	_render_skeleton() {
		this.page.main.html(`
			<div class="tj-charts-wrap">
				<div class="tj-charts-filters">
					<div><label>From</label><input type="date" class="tj-from" value="${this.from_date}" /></div>
					<div><label>To</label><input type="date" class="tj-to" value="${this.to_date}" /></div>
					<div>
						<label>Outcome</label>
						<select class="tj-outcome">
							<option value="">All closed</option>
							<option value="win">Wins only</option>
							<option value="loss">Losses only</option>
							<option value="breakeven">Breakeven</option>
						</select>
					</div>
					<div><label>Symbol</label><input type="text" class="tj-symbol" placeholder="e.g. RELIANCE" /></div>
					<div style="align-self:center;margin-left:auto">
						<label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#fff;font-size:13px;font-weight:600;text-transform:none;letter-spacing:0;margin-bottom:0">
							<input type="checkbox" class="tj-include-reviewed"/>
							Show reviewed
						</label>
					</div>
				</div>
				<div class="tj-charts-summary"></div>
				<div class="tj-charts-list"></div>
			</div>
		`);
	}

	_bind_controls() {
		const $main = this.page.main;
		$main.find(".tj-from").on("change", (e) => { this.from_date = e.target.value; this.refresh(); });
		$main.find(".tj-to").on("change", (e) => { this.to_date = e.target.value; this.refresh(); });
		$main.find(".tj-outcome").on("change", (e) => { this.outcome = e.target.value; this.refresh(); });
		$main.find(".tj-include-reviewed").on("change", (e) => { this.include_reviewed = e.target.checked; this.refresh(); });
		let debounce = null;
		$main.find(".tj-symbol").on("input", (e) => {
			clearTimeout(debounce);
			debounce = setTimeout(() => { this.symbol = e.target.value.toUpperCase(); this.refresh(); }, 350);
		});
	}

	refresh() {
		frappe.call({
			method: "trading_journal.trading_journal.page.trade_charts.trade_charts.get_chart_trades",
			args: {
				from_date: this.from_date,
				to_date: this.to_date,
				outcome: this.outcome,
				symbol: this.symbol,
				include_reviewed: this.include_reviewed ? 1 : 0,
			},
			callback: (r) => this._render(r.message || {}),
		});
	}

	_render(data) {
		this._render_summary(data.summary || {});
		this._render_list(data.trades || []);
	}

	_render_summary(s) {
		const pnlCls = s.net_pnl > 0 ? "pnl-pos" : (s.net_pnl < 0 ? "pnl-neg" : "");
		this.page.main.find(".tj-charts-summary").html(`
			<div class="tj-sum-card"><div class="lbl">In View</div><div class="val">${s.total || 0}</div></div>
			<div class="tj-sum-card"><div class="lbl">Pending Review</div><div class="val" style="color:#f59e0b">${s.pending || 0}</div></div>
			<div class="tj-sum-card"><div class="lbl">Reviewed</div><div class="val" style="color:#10b981">${s.reviewed || 0}</div></div>
			<div class="tj-sum-card win"><div class="lbl">Wins</div><div class="val">${s.wins || 0}</div></div>
			<div class="tj-sum-card ${pnlCls}"><div class="lbl">Net P&L (view)</div><div class="val">${format_currency(s.net_pnl || 0)}</div></div>
		`);
	}

	_render_list(trades) {
		const $list = this.page.main.find(".tj-charts-list");
		if (!trades.length) {
			$list.html(`
				<div class="tj-empty-state">
					<h4>No closed trades with screenshots in this range.</h4>
					<p>Attach a "Before Buy" and "After Sell" chart on any closed Trade — then revisit this page.</p>
				</div>
			`);
			return;
		}
		const html = trades.map(t => this._card_html(t)).join("");
		$list.html(html);
		$list.off("click", "img.tj-zoom").on("click", "img.tj-zoom", (e) => {
			const src = e.currentTarget.src;
			const $bd = $(`<div class="tj-lightbox-backdrop"><img src="${src}"/></div>`);
			$bd.on("click", () => $bd.remove());
			$("body").append($bd);
		});
		$list.off("click", ".tj-mark-reviewed").on("click", ".tj-mark-reviewed", (e) => {
			e.preventDefault();
			const name = e.currentTarget.dataset.name;
			this._prompt_mark_reviewed(name);
		});
		$list.off("click", ".tj-unmark-reviewed").on("click", ".tj-unmark-reviewed", (e) => {
			e.preventDefault();
			const name = e.currentTarget.dataset.name;
			this._mark_reviewed(name, 0);
		});
	}

	_prompt_mark_reviewed(name) {
		const d = new frappe.ui.Dialog({
			title: __("Mark as Reviewed"),
			fields: [
				{
					fieldtype: "Small Text",
					fieldname: "notes",
					label: __("What did you learn? (optional)"),
					description: __("Saved on the Trade as chart_review_notes."),
				},
			],
			primary_action_label: __("Mark Reviewed"),
			primary_action: (values) => {
				d.hide();
				this._mark_reviewed(name, 1, values.notes || "");
			},
		});
		d.show();
	}

	_mark_reviewed(name, reviewed, notes = "") {
		frappe.call({
			method: "trading_journal.trading_journal.page.trade_charts.trade_charts.mark_reviewed",
			args: { trade: name, reviewed: reviewed, notes: notes },
			freeze: true,
			freeze_message: reviewed ? __("Marking reviewed…") : __("Undoing…"),
			callback: (r) => {
				const m = r.message || {};
				if (m.ok) {
					frappe.show_alert({
						message: reviewed ? __("Marked as reviewed") : __("Review cleared"),
						indicator: "green",
					}, 4);
					this.refresh();
				} else {
					frappe.msgprint({ title: __("Error"), indicator: "red", message: m.error || "Failed" });
				}
			},
		});
	}

	_card_html(t) {
		const cls = (t.status || "").toLowerCase();
		const pnlCls = t.pnl > 0 ? "pos" : (t.pnl < 0 ? "neg" : "");
		const pnlSign = t.pnl > 0 ? "+" : "";
		const tradeUrl = `/app/trade/${encodeURIComponent(t.name)}`;
		const entryImg = t.entry_img
			? `<img src="${frappe.utils.escape_html(t.entry_img)}" class="tj-zoom" alt="Entry chart"/>`
			: `<div class="empty">No entry chart attached</div>`;
		const exitImg = t.exit_img
			? `<img src="${frappe.utils.escape_html(t.exit_img)}" class="tj-zoom" alt="Exit chart"/>`
			: `<div class="empty">No exit chart attached</div>`;

		const missedMove = (t.current_price && t.exit_price)
			? (t.current_price - t.exit_price)
			: null;
		const missedPct = (missedMove !== null && t.exit_price)
			? ((missedMove / t.exit_price) * 100)
			: null;

		const reviewed = !!t.chart_reviewed;
		const reviewedTag = reviewed
			? `<span class="tj-tag reviewed">✓ Reviewed${t.chart_reviewed_at ? ` · ${t.chart_reviewed_at.split(" ")[0]}` : ""}</span>`
			: "";
		const reviewBtn = reviewed
			? `<button class="btn btn-xs btn-default tj-unmark-reviewed" data-name="${frappe.utils.escape_html(t.name)}">Undo Review</button>`
			: `<button class="btn btn-xs btn-primary tj-mark-reviewed" data-name="${frappe.utils.escape_html(t.name)}">✓ Mark Reviewed</button>`;
		const reviewNotes = (reviewed && t.chart_review_notes)
			? `<div style="margin-top:10px;padding:8px 10px;background:#ecfdf5;border-left:3px solid #10b981;border-radius:4px;font-size:12px;color:#064e3b"><b>Review note:</b> ${frappe.utils.escape_html(t.chart_review_notes)}</div>`
			: "";

		return `
			<div class="tj-trade-card ${cls} ${reviewed ? "reviewed" : ""}">
				<div class="tj-card-head">
					<div class="tj-card-meta">
						<h3><a href="${tradeUrl}">${t.symbol}</a> <span style="font-weight:400;font-size:13px;color:#64748b">${t.company_name || ""}</span></h3>
						<div class="sub">${t.buy_date} → ${t.sell_date} · ${t.broker || ""} · ${t.exchange || ""}</div>
						<div class="tags">
							<span class="tj-tag ${cls}">${t.status}</span>
							${t.setup_type ? `<span class="tj-tag">${t.setup_type}</span>` : ""}
							${t.outcome ? `<span class="tj-tag">${t.outcome}</span>` : ""}
							${t.trade_grade ? `<span class="tj-tag">Grade ${t.trade_grade}</span>` : ""}
							${reviewedTag}
						</div>
					</div>
					<div class="tj-card-pnl ${pnlCls}">
						<div class="amount">${pnlSign}${format_currency(t.pnl)}</div>
						<div class="pct">${pnlSign}${(t.pnl_percent || 0).toFixed(2)}% · R ${(t.r_multiple || 0).toFixed(2)}x</div>
					</div>
				</div>
				<div class="tj-charts-grid">
					<div class="tj-chart-slot"><div class="lbl before">Before Buy · ${t.buy_date}</div>${entryImg}</div>
					<div class="tj-chart-slot"><div class="lbl after">After Sell · ${t.sell_date}</div>${exitImg}</div>
				</div>
				<div class="tj-card-footer">
					<div><div class="k">Entry</div><div class="v">${format_currency(t.entry_price)}</div></div>
					<div><div class="k">Exit</div><div class="v">${format_currency(t.exit_price)}</div></div>
					<div><div class="k">Qty</div><div class="v">${t.quantity}</div></div>
					<div>
						<div class="k">Since exit</div>
						<div class="v">${missedMove !== null
							? `${missedMove >= 0 ? "+" : ""}${format_currency(missedMove)} (${missedPct >= 0 ? "+" : ""}${missedPct.toFixed(2)}%)`
							: "—"}</div>
					</div>
				</div>
				${reviewNotes}
				<div style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px">
					${reviewBtn}
				</div>
			</div>
		`;
	}
}
