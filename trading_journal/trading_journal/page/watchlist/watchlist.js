frappe.pages["watchlist"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Watchlist — Pivot Breakout Alerts",
		single_column: true,
	});
	new WatchlistPage(page);
};

class WatchlistPage {
	constructor(page) {
		this.page = page;
		this.status = "Active";
		this.search = "";
		this._inject_styles();
		this._render_skeleton();
		this._bind_controls();
		this.refresh();
	}

	_inject_styles() {
		if (document.getElementById("tj-wl-css")) return;
		const css = `
		.tj-wl-wrap { padding: 14px; }
		.tj-wl-hero {
			background: linear-gradient(135deg, #14b8a6, #6366f1);
			border-radius: 12px; padding: 16px 20px; color: #fff;
			display: flex; justify-content: space-between; align-items: center;
			gap: 14px; flex-wrap: wrap; margin-bottom: 16px;
		}
		.tj-wl-hero h2 { margin: 0; font-size: 19px; font-weight: 800; }
		.tj-wl-hero .sub { font-size: 12px; opacity: 0.85; margin-top: 3px; }
		.tj-wl-hero .actions { display: flex; gap: 10px; }
		.tj-wl-btn {
			background: #fff; color: #134e4a; font-weight: 700;
			padding: 8px 14px; border-radius: 8px; border: 0; cursor: pointer;
			font-size: 12px;
		}
		.tj-wl-btn.ghost {
			background: rgba(255,255,255,0.15); color: #fff;
			border: 1px solid rgba(255,255,255,0.4);
		}

		.tj-wl-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 14px; }
		.tj-wl-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; }
		.tj-wl-card .lbl { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
		.tj-wl-card .val { font-size: 22px; font-weight: 800; margin-top: 4px; color: #0f172a; }

		.tj-wl-filters {
			display: flex; gap: 12px; flex-wrap: wrap; align-items: end;
			background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
			padding: 12px 16px; margin-bottom: 12px;
		}
		.tj-wl-filters label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; display: block; margin-bottom: 4px; }
		.tj-wl-filters input, .tj-wl-filters select {
			border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; font-size: 13px;
			min-width: 140px; background: #fff;
		}

		.tj-wl-table-wrap { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
		.tj-wl-table { width: 100%; border-collapse: collapse; font-size: 13px; }
		.tj-wl-table th {
			background: #f1f5f9; font-size: 10px; font-weight: 700;
			text-transform: uppercase; letter-spacing: 0.5px; color: #475569;
			padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0;
			white-space: nowrap;
		}
		.tj-wl-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #0f172a; }
		.tj-wl-table tr:hover td { background: #f8fafc; }
		.tj-wl-table tr.triggered td { background: #ecfdf5; }
		.tj-wl-table tr.dismissed td { color: #94a3b8; }
		.tj-wl-table .sym { font-weight: 700; color: #0d9488; }
		.tj-wl-table .sym a { color: inherit; text-decoration: none; }
		.tj-wl-table .num { font-variant-numeric: tabular-nums; text-align: right; }
		.tj-wl-table .pos { color: #10b981; font-weight: 700; }
		.tj-wl-table .neg { color: #f43f5e; font-weight: 700; }
		.tj-wl-table .badge {
			display: inline-block; padding: 2px 8px; border-radius: 999px;
			font-size: 11px; font-weight: 700;
		}
		.tj-wl-table .badge.active { background: #dbeafe; color: #1e40af; }
		.tj-wl-table .badge.triggered { background: #d1fae5; color: #065f46; }
		.tj-wl-table .badge.dismissed { background: #e2e8f0; color: #475569; }
		.tj-wl-table .badge.traded { background: #ede9fe; color: #5b21b6; }
		.tj-wl-table .actions { display: flex; gap: 6px; flex-wrap: nowrap; }
		.tj-wl-table .actions a, .tj-wl-table .actions button {
			color: #0d9488; text-decoration: none; font-weight: 600; font-size: 11px;
			background: transparent; border: 1px solid #e2e8f0; padding: 3px 8px; border-radius: 6px; cursor: pointer;
		}
		.tj-wl-table .actions a:hover, .tj-wl-table .actions button:hover { background: #f0fdfa; }
		.tj-wl-table .actions .danger { color: #b91c1c; }
		.tj-wl-empty { padding: 50px; text-align: center; color: #94a3b8; }
		`;
		const style = document.createElement("style");
		style.id = "tj-wl-css";
		style.textContent = css;
		document.head.appendChild(style);
	}

	_render_skeleton() {
		const $body = $(this.page.body).empty();
		$body.append(`
			<div class="tj-wl-wrap">
				<div class="tj-wl-hero">
					<div>
						<h2>Watchlist</h2>
						<div class="sub">Stocks flagged from screeners. Auto-checked every 15 min during market hours; Telegram pings on pivot breakout.</div>
					</div>
					<div class="actions">
						<button class="tj-wl-btn ghost" id="tj-wl-refresh">↻ Refresh Prices</button>
						<button class="tj-wl-btn" id="tj-wl-add">+ Add Symbol</button>
					</div>
				</div>
				<div class="tj-wl-summary" id="tj-wl-summary"></div>
				<div class="tj-wl-filters">
					<div>
						<label>Status</label>
						<select id="tj-wl-status">
							<option value="Active">Active</option>
							<option value="Triggered">Triggered</option>
							<option value="Dismissed">Dismissed</option>
							<option value="Traded">Traded</option>
							<option value="">All</option>
						</select>
					</div>
					<div>
						<label>Search</label>
						<input type="text" id="tj-wl-search" placeholder="symbol">
					</div>
				</div>
				<div class="tj-wl-table-wrap">
					<table class="tj-wl-table" id="tj-wl-table">
						<thead>
							<tr>
								<th>Symbol</th>
								<th>Source</th>
								<th class="num">Pivot</th>
								<th class="num">Stop</th>
								<th class="num">Target</th>
								<th class="num">LTP</th>
								<th class="num">Δ to Pivot</th>
								<th>Status</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody id="tj-wl-tbody">
							<tr><td colspan="9" class="tj-wl-empty">Loading…</td></tr>
						</tbody>
					</table>
				</div>
			</div>
		`);
	}

	_bind_controls() {
		const $body = $(this.page.body);
		$body.find("#tj-wl-status").on("change", (e) => {
			this.status = e.target.value;
			this.refresh();
		});
		$body.find("#tj-wl-search").on("input", (e) => {
			this.search = (e.target.value || "").trim().toUpperCase();
			this._render();
		});
		$body.find("#tj-wl-refresh").on("click", () => this._refresh_prices());
		$body.find("#tj-wl-add").on("click", () => this._open_add_dialog());
	}

	refresh() {
		frappe.call({
			method: "trading_journal.trading_journal.utils.watchlist.get_watchlist",
			args: { status: this.status },
			callback: (r) => {
				this.items = r.message || [];
				this._render();
			},
		});
	}

	_refresh_prices() {
		const $btn = $(this.page.body).find("#tj-wl-refresh");
		$btn.prop("disabled", true).text("Refreshing…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.watchlist.refresh_prices",
			args: { names: null },
			callback: (r) => {
				$btn.prop("disabled", false).text("↻ Refresh Prices");
				const m = r.message || {};
				frappe.show_alert({
					message: `Updated ${m.updated || 0} of ${m.total || 0} prices`,
					indicator: "green",
				}, 4);
				this.refresh();
			},
			error: () => $btn.prop("disabled", false).text("↻ Refresh Prices"),
		});
	}

	_render() {
		const $tbody = $(this.page.body).find("#tj-wl-tbody");
		const items = (this.items || []).filter((i) =>
			!this.search || (i.symbol || "").toUpperCase().includes(this.search)
		);
		if (!items.length) {
			$tbody.html(`<tr><td colspan="9" class="tj-wl-empty">No items.</td></tr>`);
			$(this.page.body).find("#tj-wl-summary").empty();
			return;
		}
		const total = items.length;
		const triggered = items.filter((i) => i.status === "Triggered").length;
		const nearPivot = items.filter((i) => Math.abs(i.pct_to_pivot) <= 2 && i.pivot_price).length;
		const tradeable = items.filter((i) => i.status === "Active" && i.pct_to_pivot >= -2 && i.pct_to_pivot <= 2).length;
		$(this.page.body).find("#tj-wl-summary").html(`
			<div class="tj-wl-card"><div class="lbl">Total</div><div class="val">${total}</div></div>
			<div class="tj-wl-card"><div class="lbl">Triggered</div><div class="val">${triggered}</div></div>
			<div class="tj-wl-card"><div class="lbl">Near Pivot (±2%)</div><div class="val">${nearPivot}</div></div>
			<div class="tj-wl-card"><div class="lbl">Ready to Trade</div><div class="val">${tradeable}</div></div>
		`);

		const rows = items.map((i) => {
			const cls = (i.status || "active").toLowerCase();
			const pctClass = i.pct_to_pivot >= 0 ? "pos" : "neg";
			const pctTxt = i.pivot_price ? `${i.pct_to_pivot >= 0 ? "+" : ""}${i.pct_to_pivot.toFixed(2)}%` : "—";
			return `
				<tr class="${cls}" data-name="${i.name}">
					<td class="sym"><a href="#" class="tj-chart-hover" data-symbol="${i.symbol}" data-exchange="${i.exchange || 'NSE'}">${i.symbol}</a><div style="font-size:11px;color:#64748b;font-weight:400;">${frappe.utils.escape_html(i.company_name || '')}</div></td>
					<td><span class="badge active">${i.scan_source || 'Manual'}</span></td>
					<td class="num">${i.pivot_price ? '₹' + i.pivot_price.toFixed(2) : '—'}</td>
					<td class="num">${i.stop_price ? '₹' + i.stop_price.toFixed(2) : '—'}</td>
					<td class="num">${i.target_price ? '₹' + i.target_price.toFixed(2) : '—'}</td>
					<td class="num">${i.current_price ? '₹' + i.current_price.toFixed(2) : '—'}</td>
					<td class="num ${pctClass}">${pctTxt}</td>
					<td><span class="badge ${cls}">${i.status}</span></td>
					<td>
						<div class="actions">
							<button class="tj-edit" data-name="${i.name}">Edit</button>
							<a href="/app/watchlist-item/${i.name}" target="_blank">Open</a>
							<button class="danger tj-del" data-name="${i.name}">Remove</button>
						</div>
					</td>
				</tr>
			`;
		}).join("");
		$tbody.html(rows);
		$tbody.find(".tj-del").on("click", (e) => this._remove(e.currentTarget.dataset.name));
		$tbody.find(".tj-edit").on("click", (e) => this._edit(e.currentTarget.dataset.name));
	}

	_remove(name) {
		frappe.confirm(`Remove ${name} from watchlist?`, () => {
			frappe.call({
				method: "trading_journal.trading_journal.utils.watchlist.remove_item",
				args: { name },
				callback: () => this.refresh(),
			});
		});
	}

	_edit(name) {
		const item = (this.items || []).find((i) => i.name === name);
		if (!item) return;
		const d = new frappe.ui.Dialog({
			title: `Edit ${item.symbol}`,
			fields: [
				{fieldtype: "Currency", fieldname: "pivot_price", label: "Pivot / Buy Trigger", default: item.pivot_price || 0},
				{fieldtype: "Currency", fieldname: "stop_price", label: "Stop", default: item.stop_price || 0},
				{fieldtype: "Currency", fieldname: "target_price", label: "Target", default: item.target_price || 0},
				{fieldtype: "Select", fieldname: "status", label: "Status", options: "Active\nTriggered\nDismissed\nTraded", default: item.status},
				{fieldtype: "Small Text", fieldname: "notes", label: "Notes", default: item.notes || ""},
			],
			primary_action_label: "Save",
			primary_action: (vals) => {
				frappe.call({
					method: "trading_journal.trading_journal.utils.watchlist.update_item",
					args: Object.assign({name}, vals),
					callback: () => {
						d.hide();
						this.refresh();
					},
				});
			},
		});
		d.show();
	}

	_open_add_dialog() {
		const d = new frappe.ui.Dialog({
			title: "Add to Watchlist",
			fields: [
				{fieldtype: "Data", fieldname: "symbol", label: "Symbol (NSE)", reqd: 1},
				{fieldtype: "Currency", fieldname: "pivot_price", label: "Pivot / Buy Trigger"},
				{fieldtype: "Currency", fieldname: "stop_price", label: "Stop"},
				{fieldtype: "Currency", fieldname: "target_price", label: "Target"},
				{fieldtype: "Small Text", fieldname: "notes", label: "Notes"},
			],
			primary_action_label: "Add",
			primary_action: (vals) => {
				frappe.call({
					method: "trading_journal.trading_journal.utils.watchlist.add_to_watchlist",
					args: Object.assign({scan_source: "Manual"}, vals),
					callback: (r) => {
						const m = r.message || {};
						if (!m.ok) {
							frappe.msgprint({title: "Error", message: m.error || "Failed", indicator: "red"});
							return;
						}
						d.hide();
						frappe.show_alert({message: m.existed ? "Updated existing item" : "Added", indicator: "green"}, 4);
						this.refresh();
					},
				});
			},
		});
		d.show();
	}
}
