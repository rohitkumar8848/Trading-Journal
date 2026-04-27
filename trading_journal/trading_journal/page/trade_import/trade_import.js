frappe.pages["trade-import"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Import Trades (CSV)",
		single_column: true,
	});
	new TradeImport(page);
};

class TradeImport {
	constructor(page) {
		this.page = page;
		this._inject_styles();
		this._render();
	}

	_render() {
		this.page.main.html(`
			<div class="ti-root">
				<div class="ti-hero">
					<h2>Import Trades from Broker CSV</h2>
					<p>Drop your tradebook CSV below. Supports Zerodha, Upstox, and a generic format.</p>
				</div>

				<div class="ti-drop" id="ti-drop">
					<div class="ti-drop-icon">📥</div>
					<div class="ti-drop-text">Drop CSV file here or <label class="ti-pick">browse<input type="file" accept=".csv" /></label></div>
					<div class="ti-drop-hint">Nothing leaves your browser until you click Import.</div>
				</div>

				<div class="ti-supported">
					<div class="ti-supported-card">
						<div class="ti-supported-label">Zerodha</div>
						<code>symbol, trade_date, trade_type, quantity, price</code>
					</div>
					<div class="ti-supported-card">
						<div class="ti-supported-label">Upstox</div>
						<code>Scrip, Trade Date, Transaction Type, Quantity, Price</code>
					</div>
					<div class="ti-supported-card">
						<div class="ti-supported-label">Generic</div>
						<code>symbol, date, type, qty, price</code>
					</div>
				</div>

				<div class="ti-preview" style="display:none">
					<div class="ti-preview-head">
						<div>
							<span class="ti-preview-broker"></span>
							<span class="ti-preview-count"></span>
						</div>
						<div class="ti-preview-actions">
							<div class="ti-broker-picker">
								<label>Assign to Broker:</label>
								<div class="ti-broker-slot"></div>
							</div>
							<label style="font-size:12px"><input type="checkbox" class="ti-skip-existing" checked /> Skip duplicates</label>
							<button class="btn btn-default ti-cancel">Cancel</button>
							<button class="btn btn-primary ti-confirm">Import</button>
						</div>
					</div>
					<div class="ti-preview-table"></div>
				</div>

				<div class="ti-result" style="display:none"></div>
			</div>
		`);

		const $drop = this.page.main.find("#ti-drop");
		const $file = this.page.main.find(".ti-pick input");

		$drop.on("dragover", (e) => { e.preventDefault(); $drop.addClass("ti-drag"); });
		$drop.on("dragleave drop", () => $drop.removeClass("ti-drag"));
		$drop.on("drop", (e) => {
			e.preventDefault();
			const file = e.originalEvent.dataTransfer.files[0];
			if (file) this._read_file(file);
		});
		$file.on("change", (e) => {
			if (e.target.files[0]) this._read_file(e.target.files[0]);
		});

		this.page.main.find(".ti-cancel").on("click", () => this._reset());
		this.page.main.find(".ti-confirm").on("click", () => this._import());
	}

	_reset() {
		this.page.main.find(".ti-preview").hide();
		this.page.main.find(".ti-result").hide();
		this.page.main.find(".ti-pick input").val("");
		this._file_content = null;
	}

	_read_file(file) {
		const reader = new FileReader();
		reader.onload = (e) => {
			this._file_content = e.target.result;
			this._preview();
		};
		reader.readAsText(file);
	}

	_preview() {
		frappe.call({
			method: "trading_journal.trading_journal.utils.broker_import.preview",
			args: { file_content: this._file_content },
			callback: (r) => {
				const data = r.message || {};
				const s = data.summary || {};
				this.page.main.find(".ti-preview-broker").text(`Detected: ${data.broker}`);
				this.page.main.find(".ti-preview-count").text(
					`  ·  ${data.row_count || 0} raw rows  ·  ${data.leg_count || 0} valid legs  ·  ${s.symbols || 0} symbols  ·  Buy ${s.buys || 0} / Sell ${s.sells || 0}`
				);
				this._mount_broker_picker();

				const bySymbol = data.by_symbol || [];
				if (!bySymbol.length) {
					this.page.main.find(".ti-preview-table").html(`<div class="ti-empty">No legs could be parsed. Check the file format.</div>`);
				} else {
					const rows = bySymbol.slice(0, 100).map(s => {
						const net = s.buy_qty - s.sell_qty;
						const netCls = net > 0 ? "color:#10b981" : (net < 0 ? "color:#f43f5e" : "color:#64748b");
						const netLabel = net === 0 ? "closed" : (net > 0 ? `+${net} long` : `${net} (sells > buys)`);
						return `
							<tr>
								<td><b>${s.symbol}</b> <span style="color:#64748b;font-size:11px">${s.exchange}</span></td>
								<td>${s.first_date}${s.first_date !== s.last_date ? ` → ${s.last_date}` : ""}</td>
								<td style="color:#10b981">${s.buys} (${s.buy_qty})</td>
								<td style="color:#f43f5e">${s.sells} (${s.sell_qty})</td>
								<td style="${netCls}">${netLabel}</td>
							</tr>
						`;
					}).join("");
					this.page.main.find(".ti-preview-table").html(`
						<table class="ti-table">
							<thead><tr><th>Symbol</th><th>Date(s)</th><th>Buys (qty)</th><th>Sells (qty)</th><th>Net Position</th></tr></thead>
							<tbody>${rows}</tbody>
						</table>
						${bySymbol.length > 100 ? `<div class="ti-empty">… and ${bySymbol.length - 100} more symbols</div>` : ""}
						<div style="margin-top:10px;padding:10px 14px;background:#eef2ff;border-left:3px solid #6366f1;border-radius:6px;font-size:12px;color:#3730a3">
							<b>Note:</b> Each symbol becomes one Trade per open position (accumulation model).
							Buys extend the Long; Sells close it. A Sell with no prior Buy will close an existing
							Holding if one matches — otherwise it's reported as an "orphan sell" and skipped (no phantom Short).
						</div>
					`);
				}
				this.page.main.find(".ti-preview").show();
			},
		});
	}

	_mount_broker_picker() {
		const $slot = this.page.main.find(".ti-broker-slot");
		$slot.empty();
		this._broker_field = frappe.ui.form.make_control({
			parent: $slot[0],
			df: {
				fieldtype: "Link", fieldname: "broker", options: "Broker", reqd: 1,
				placeholder: __("Select broker account"),
			},
			render_input: true,
		});
	}

	_import() {
		const broker = this._broker_field ? this._broker_field.get_value() : "";
		frappe.call({
			method: "trading_journal.trading_journal.utils.broker_import.do_import",
			args: { file_content: this._file_content, broker: broker },
			freeze: true,
			freeze_message: "Importing trades…",
			callback: (r) => {
				const d = r.message || {};
				this.page.main.find(".ti-preview").hide();
				if (!d.ok) {
					this.page.main.find(".ti-result").html(`
						<div class="ti-success" style="border-left:4px solid #f43f5e">
							<div style="font-size:40px">⚠</div>
							<h3>Import Failed</h3>
							<p>${frappe.utils.escape_html(d.error || "Unknown error")}</p>
						</div>
					`).show();
					return;
				}
				const created = d.created || 0;
				const appended = d.appended || 0;
				const closed = d.closed || 0;
				const dup = d.skipped_dup || 0;
				const noSym = d.skipped_no_symbol || 0;
				const noTid = d.skipped_no_trade_id || 0;
				const orphan = d.unmatched_sells || 0;

				this.page.main.find(".ti-result").html(`
					<div class="ti-success">
						<div style="font-size:40px">✅</div>
						<h3>Import complete</h3>
						<p>Source: <b>${d.source}</b>  ·  Broker: <b>${d.broker || "—"}</b>  ·  ${d.row_count} CSV rows  ·  ${d.leg_count} valid legs</p>

						<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px;text-align:left;max-width:560px;margin-left:auto;margin-right:auto">
							<div style="padding:10px;background:#ecfdf5;border-radius:6px"><div style="font-size:11px;color:#065f46;font-weight:700;text-transform:uppercase">New Trades</div><div style="font-size:22px;font-weight:800;color:#10b981">${created}</div></div>
							<div style="padding:10px;background:#eff6ff;border-radius:6px"><div style="font-size:11px;color:#1e40af;font-weight:700;text-transform:uppercase">Appended</div><div style="font-size:22px;font-weight:800;color:#3b82f6">${appended}</div></div>
							<div style="padding:10px;background:#f0fdf4;border-radius:6px"><div style="font-size:11px;color:#166534;font-weight:700;text-transform:uppercase">Closed</div><div style="font-size:22px;font-weight:800;color:#16a34a">${closed}</div></div>
						</div>

						${(dup + noSym + noTid + orphan) ? `
							<div style="margin-top:14px;padding:10px 14px;background:#fff7ed;border-left:3px solid #f59e0b;border-radius:6px;font-size:12px;text-align:left;max-width:560px;margin-left:auto;margin-right:auto">
								<b>Skipped:</b>
								duplicates=${dup} ·
								empty-symbol=${noSym} ·
								no-trade-id=${noTid} ·
								orphan-sells=${orphan}
								${orphan ? `<div style="margin-top:6px;color:#92400e">Orphan sells = sells with no open Trade and no matching Holding. They were ignored to avoid creating phantom Short trades.</div>` : ""}
							</div>
						` : ""}

						<div style="margin-top:18px">
							<a href="/app/trade-dashboard" class="btn btn-primary">View Dashboard</a>
							<a href="/app/trade?broker=${encodeURIComponent(d.broker || "")}" class="btn btn-default">Open Trade List</a>
						</div>
					</div>
				`).show();
			},
		});
	}

	_inject_styles() {
		if ($("#ti-styles").length) return;
		$("head").append(`<style id="ti-styles">
			body [data-page-route="trade-import"] .container,
			body [data-page-route="trade-import"] .page-body,
			body [data-page-route="trade-import"] .layout-main-section { max-width:100% !important; width:100% !important; }
			body [data-page-route="trade-import"] .page-body { background:#f6f7fb; }

			.ti-root { padding:20px; max-width:1100px; margin:0 auto; color:#0f172a; }
			.ti-hero { text-align:center; padding:20px 0 26px; }
			.ti-hero h2 { font-weight:800; letter-spacing:-.5px; margin:0 0 6px; }
			.ti-hero p { color:#64748b; margin:0; }

			.ti-drop {
				border:2px dashed #cbd5e1; border-radius:16px;
				padding:44px 24px; text-align:center; background:#fff;
				transition:border-color .15s, background .15s;
			}
			.ti-drop.ti-drag { border-color:#6366f1; background:#eef2ff; }
			.ti-drop-icon { font-size:48px; margin-bottom:8px; }
			.ti-drop-text { font-size:15px; font-weight:600; }
			.ti-drop-hint { color:#64748b; font-size:12px; margin-top:6px; }
			.ti-pick { color:#6366f1; cursor:pointer; font-weight:700; }
			.ti-pick input { display:none; }

			.ti-supported { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; margin-top:20px; }
			.ti-supported-card { background:#fff; border:1px solid #e6e8f0; border-radius:10px; padding:12px 14px; }
			.ti-supported-label { font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:.5px; font-weight:700; margin-bottom:4px; }
			.ti-supported-card code { font-size:11px; color:#334155; background:transparent; padding:0; }

			.ti-preview { margin-top:24px; background:#fff; border:1px solid #e6e8f0; border-radius:12px; padding:18px 20px; box-shadow:0 1px 3px rgba(15,23,42,.06); }
			.ti-preview-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; gap:10px; flex-wrap:wrap; }
			.ti-preview-actions { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
			.ti-broker-picker { display:flex; gap:6px; align-items:center; }
			.ti-broker-picker label { font-size:11px; margin:0; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.4px; }
			.ti-broker-slot .form-group { margin:0; }
			.ti-broker-slot .control-label { display:none; }
			.ti-broker-slot input { height:30px; font-size:12px; width:170px; }
			.ti-preview-broker { font-weight:700; font-size:14px; color:#6366f1; text-transform:uppercase; letter-spacing:.5px; }
			.ti-preview-count { font-size:12px; color:#64748b; }
			.ti-table { width:100%; border-collapse:separate; border-spacing:0; font-size:12px; }
			.ti-table thead th { background:#f1f2f8; padding:10px; text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.4px; color:#64748b; font-weight:700; }
			.ti-table tbody td { padding:9px 10px; border-bottom:1px solid #f0f1f7; }
			.ti-empty { color:#64748b; padding:16px; text-align:center; font-style:italic; }

			.ti-result { margin-top:24px; }
			.ti-success { background:#fff; border:1px solid #e6e8f0; border-radius:14px; padding:32px; text-align:center; box-shadow:0 4px 16px rgba(15,23,42,.06); }
			.ti-success h3 { font-weight:800; margin:8px 0 6px; }
			.ti-success p { color:#64748b; margin:0; }
			.ti-errors { margin-top:16px; text-align:left; background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:12px 14px; font-size:12px; color:#991b1b; }
			.ti-errors ul { margin:6px 0 0 18px; }
		</style>`);
	}
}
