frappe.ui.form.on("Trade", {
	refresh(frm) {
		frm.set_indicator_formatter("status", (doc) => {
			const map = { Win: "green", Loss: "red", Open: "blue", Breakeven: "orange" };
			return map[doc.status] || "gray";
		});

		if (!frm.is_new()) {
			frm.add_custom_button(__("Dashboard"), () => {
				frappe.set_route("trade-kanban");
			}, __("View"));
			frm.add_custom_button(__("Analytics"), () => {
				frappe.set_route("trade-dashboard");
			}, __("View"));
		}

		frm.add_custom_button(__("Position Sizer"), () => _show_position_sizer(frm), __("Tools"));

		if (!frm.is_new()) {
			frm.add_custom_button(__("Fetch Current Price"), () => _fetch_current_price(frm), __("Tools"));
			frm.add_custom_button(__("Paste Chart Screenshot"), () => _prompt_paste_instructions(), __("Tools"));
			if (frm.doc.symbol && trading_journal.ai) {
				frm.add_custom_button(__("Fetch News"), () => trading_journal.ai.show_news(frm.doc.symbol), __("AI"));
				frm.add_custom_button(__("Analyse with AI"), () => trading_journal.ai.show_analysis(frm.doc.symbol), __("AI"));
			}
		}

		_render_r_multiple_hint(frm);
		_render_post_exit_hint(frm);
		_bind_clipboard_paste(frm);
	},

	exit_price(frm) { frm.trigger("_recalculate"); },
	entry_price(frm) { frm.trigger("_recalculate"); _render_r_multiple_hint(frm); },
	stop_loss(frm) { frm.trigger("_recalculate"); _render_r_multiple_hint(frm); },
	target(frm) { frm.trigger("_recalculate"); },
	quantity(frm) { frm.trigger("_recalculate"); _render_r_multiple_hint(frm); },

	_recalculate(frm) {
		const { entry_price, exit_price, stop_loss, target, quantity, trade_type } = frm.doc;
		if (entry_price && exit_price && quantity) {
			const pnl = trade_type === "Long"
				? (exit_price - entry_price) * quantity
				: (entry_price - exit_price) * quantity;
			frm.set_value("pnl", pnl);
			frm.set_value("pnl_percent", (pnl / (entry_price * quantity)) * 100);

			if (pnl > 0) frm.set_value("status", "Win");
			else if (pnl < 0) frm.set_value("status", "Loss");
			else frm.set_value("status", "Breakeven");

			if (entry_price && stop_loss) {
				const risk = Math.abs(entry_price - stop_loss) * quantity;
				if (risk) frm.set_value("r_multiple", pnl / risk);
			}
		}
		if (entry_price && stop_loss && target) {
			const risk = Math.abs(entry_price - stop_loss);
			const reward = Math.abs(target - entry_price);
			if (risk) frm.set_value("risk_reward", reward / risk);
		}
	},
});

function _render_r_multiple_hint(frm) {
	const $wrap = frm.fields_dict.stop_loss.$wrapper.closest(".form-section").find(".tj-rhint");
	const { entry_price, stop_loss, quantity } = frm.doc;
	if (!entry_price || !stop_loss || !quantity) { $wrap.remove(); return; }
	const risk = Math.abs(entry_price - stop_loss) * quantity;
	const html = `
		<div class="tj-rhint" style="margin:8px 0;padding:10px 14px;background:#fef3c7;border-left:3px solid #f59e0b;border-radius:6px;font-size:12px">
			<b>Initial Risk (1R):</b> ${format_currency(risk)}
			&nbsp;&nbsp;·&nbsp;&nbsp;
			<b>Per share:</b> ${format_currency(Math.abs(entry_price - stop_loss))}
		</div>
	`;
	$wrap.remove();
	frm.fields_dict.stop_loss.$wrapper.closest(".form-section").append(html);
}

function _show_position_sizer(frm) {
	// Pull equity from the trade's broker if available
	const broker = frm.doc.broker;
	const fetchEquity = broker
		? frappe.db.get_value("Broker", broker, ["current_equity", "starting_capital"])
			.then(r => r.message || {})
		: Promise.resolve({});

	fetchEquity.then(brokerDoc => {
		const equity = flt(brokerDoc.current_equity) || flt(brokerDoc.starting_capital) || 0;
		const entry = frm.doc.entry_price || 0;
		const sl = frm.doc.stop_loss || 0;

		const d = new frappe.ui.Dialog({
			title: __("Position Sizer"),
			fields: [
				{ fieldtype: "Currency", fieldname: "equity", label: "Account Equity", default: equity,
				  description: broker ? `Pulled from broker "${broker}". Edit if needed.` : "Enter manually." },
				{ fieldtype: "Percent", fieldname: "risk_pct", label: "Risk %", default: 1 },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Currency", fieldname: "entry", label: "Entry", default: entry, precision: 4 },
				{ fieldtype: "Currency", fieldname: "sl", label: "Stop Loss", default: sl, precision: 4 },
				{ fieldtype: "Section Break" },
				{ fieldtype: "HTML", fieldname: "result" },
			],
			primary_action_label: __("Apply to Trade"),
			primary_action: (values) => {
				const calc = _sizer_calc(values);
				if (calc.qty > 0) {
					frm.set_value("quantity", calc.qty);
					frm.set_value("entry_price", values.entry);
					frm.set_value("stop_loss", values.sl);
				}
				d.hide();
			},
		});

		const update = () => {
			const v = d.get_values(true);
			const calc = _sizer_calc(v);
			d.fields_dict.result.$wrapper.html(`
				<div style="padding:16px;background:#f8f9fd;border-radius:8px;font-size:13px">
					<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
						<div><div style="color:#64748b;font-size:11px;text-transform:uppercase;font-weight:700">Risk Amount</div><div style="font-size:18px;font-weight:800;color:#f43f5e">${format_currency(calc.riskAmt)}</div></div>
						<div><div style="color:#64748b;font-size:11px;text-transform:uppercase;font-weight:700">Per-Share Risk</div><div style="font-size:18px;font-weight:800">${format_currency(calc.perShare)}</div></div>
						<div><div style="color:#64748b;font-size:11px;text-transform:uppercase;font-weight:700">Suggested Qty</div><div style="font-size:26px;font-weight:800;color:#6366f1">${calc.qty}</div></div>
						<div><div style="color:#64748b;font-size:11px;text-transform:uppercase;font-weight:700">Position Size</div><div style="font-size:18px;font-weight:800">${format_currency(calc.posSize)}</div></div>
					</div>
				</div>
			`);
		};
		["equity", "risk_pct", "entry", "sl"].forEach(f => {
			d.fields_dict[f].$input.on("change keyup", update);
		});
		d.show();
		update();
	});
}

function _sizer_calc(v) {
	const equity = parseFloat(v.equity) || 0;
	const riskPct = parseFloat(v.risk_pct) || 0;
	const entry = parseFloat(v.entry) || 0;
	const sl = parseFloat(v.sl) || 0;
	const riskAmt = equity * riskPct / 100;
	const perShare = Math.abs(entry - sl);
	const qty = perShare > 0 ? Math.floor(riskAmt / perShare) : 0;
	const posSize = qty * entry;
	return { riskAmt, perShare, qty, posSize };
}

function flt(v) { return parseFloat(v) || 0; }

function _fetch_current_price(frm) {
	frappe.call({
		method: "trading_journal.trading_journal.utils.market_data.refresh_trade_price",
		args: { trade: frm.doc.name },
		freeze: true, freeze_message: __("Fetching price from Yahoo…"),
		callback: (r) => {
			const m = r.message || {};
			if (m.ok) {
				frappe.show_alert({
					message: `Current: ${format_currency(m.price)}${m.market_state ? ` · ${m.market_state}` : ""}`,
					indicator: "green",
				}, 6);
				frm.reload_doc();
			} else {
				frappe.msgprint({
					title: __("Fetch Failed"),
					indicator: "red",
					message: m.error || __("Unknown error"),
				});
			}
		},
	});
}

function _render_post_exit_hint(frm) {
	const $section = frm.fields_dict.exit_price.$wrapper.closest(".form-section");
	$section.find(".tj-post-exit").remove();
	const { exit_price, current_price, price_fetched_at, trade_type, sell_date, quantity } = frm.doc;
	if (!exit_price || !current_price) return;

	// "Missed move" — how the stock moved in your direction after exit.
	// For a Long: price UP after sell = missed further upside (bad exit).
	// For a Short: price DOWN after buy-to-cover = missed further downside.
	const diff = current_price - exit_price;
	const pct = exit_price ? (diff / exit_price) * 100 : 0;
	const missedUpside = trade_type === "Long" ? diff > 0 : diff < 0;
	const color = missedUpside ? "#f43f5e" : "#10b981";
	const label = missedUpside ? "Left on the table" : "Good exit — price moved against you";
	const arrow = diff > 0 ? "▲" : (diff < 0 ? "▼" : "→");
	const fetchedStr = price_fetched_at ? `<span style="color:#64748b">· fetched ${frappe.datetime.prettyDate(price_fetched_at)}</span>` : "";
	const sinceStr = sell_date ? `<span style="color:#64748b">· since ${sell_date}</span>` : "";

	const qty = parseFloat(quantity) || 0;
	const sign = (v) => (v >= 0 ? "+" : "");
	const totalsRow = qty
		? `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed #cbd5e1">
				<b>Position value now:</b> ${format_currency(current_price * qty)}
				&nbsp;·&nbsp;
				<b>At exit:</b> ${format_currency(exit_price * qty)}
				&nbsp;·&nbsp;
				<b>Total move:</b> <span style="color:${color};font-weight:700">${sign(diff * qty)}${format_currency(diff * qty)}</span>
				<span style="color:#64748b">(${qty} qty)</span>
			</div>`
		: "";

	const html = `
		<div class="tj-post-exit" style="margin:8px 0;padding:12px 14px;background:#f1f5f9;border-left:3px solid ${color};border-radius:6px;font-size:12px">
			<div style="font-weight:700;color:${color};margin-bottom:4px">${arrow} ${label}</div>
			<div>
				<b>Now:</b> ${format_currency(current_price)}
				&nbsp;·&nbsp;
				<b>Exit was:</b> ${format_currency(exit_price)}
				&nbsp;·&nbsp;
				<b>Move/share:</b> ${sign(diff)}${format_currency(diff)} (${pct.toFixed(2)}%)
				${sinceStr}
				${fetchedStr}
			</div>
			${totalsRow}
		</div>
	`;
	$section.append(html);
}

// ───────────── Clipboard paste → chart screenshots ─────────────
// Workflow: user takes a screenshot (Win+Shift+S / Cmd+Shift+4), focuses the
// Trade form, hits Ctrl+V. We pop a tiny picker for Entry vs Exit and upload.

function _bind_clipboard_paste(frm) {
	if (frm.__tj_paste_bound) return;
	frm.__tj_paste_bound = true;

	const handler = (e) => {
		// Only react on the Trade form tab
		if (cur_frm !== frm || frm.is_new()) return;
		const items = (e.clipboardData && e.clipboardData.items) || [];
		for (const it of items) {
			if (it.kind === "file" && it.type && it.type.indexOf("image/") === 0) {
				const blob = it.getAsFile();
				if (blob) {
					e.preventDefault();
					_ask_paste_target(frm, blob);
					return;
				}
			}
		}
	};
	document.addEventListener("paste", handler);
	// Clean up when user leaves the form
	frm.__tj_paste_cleanup = () => document.removeEventListener("paste", handler);
	$(frm.wrapper).one("remove", frm.__tj_paste_cleanup);
}

function _ask_paste_target(frm, blob) {
	// Show a preview + pick target field
	const previewUrl = URL.createObjectURL(blob);
	const d = new frappe.ui.Dialog({
		title: __("Paste Chart Screenshot"),
		fields: [
			{ fieldtype: "HTML", fieldname: "preview" },
			{
				fieldtype: "Select",
				fieldname: "target",
				label: __("Attach as"),
				options: [
					{ label: "Before Buy (Entry Chart)", value: "entry_screenshot" },
					{ label: "After Sell (Exit Chart)", value: "exit_screenshot" },
				],
				default: frm.doc.entry_screenshot ? "exit_screenshot" : "entry_screenshot",
				reqd: 1,
			},
		],
		primary_action_label: __("Upload & Attach"),
		primary_action: (values) => {
			d.hide();
			_upload_blob_to_field(frm, blob, values.target);
			URL.revokeObjectURL(previewUrl);
		},
		secondary_action_label: __("Cancel"),
		secondary_action: () => { URL.revokeObjectURL(previewUrl); },
	});
	d.fields_dict.preview.$wrapper.html(`
		<div style="padding:8px;background:#0f172a;border-radius:8px;text-align:center;margin-bottom:10px">
			<img src="${previewUrl}" style="max-width:100%;max-height:320px;border-radius:4px"/>
		</div>
		<div style="font-size:11px;color:#64748b;margin-bottom:4px">
			${_human_size(blob.size)} · ${blob.type || "image"}
		</div>
	`);
	d.show();
}

function _upload_blob_to_field(frm, blob, fieldname) {
	const ext = (blob.type.split("/")[1] || "png").split(";")[0];
	const filename = `chart-${frm.doc.name}-${fieldname}-${Date.now()}.${ext}`;
	const fd = new FormData();
	fd.append("file", blob, filename);
	fd.append("doctype", "Trade");
	fd.append("docname", frm.doc.name);
	fd.append("fieldname", fieldname);
	fd.append("is_private", "0");
	fd.append("folder", "Home/Attachments");

	frappe.show_alert({ message: __("Uploading…"), indicator: "blue" }, 3);

	fetch("/api/method/upload_file", {
		method: "POST",
		headers: {
			"X-Frappe-CSRF-Token": frappe.csrf_token,
			"X-Frappe-CSRF-Token-Used": "1",
		},
		body: fd,
	})
		.then(r => r.json())
		.then(data => {
			const file_url = (data && data.message && data.message.file_url) || "";
			if (!file_url) throw new Error((data && data._server_messages) || "Upload failed");
			return frm.set_value(fieldname, file_url).then(() => frm.save());
		})
		.then(() => {
			frappe.show_alert({
				message: __("Chart attached to {0}", [fieldname === "entry_screenshot" ? "Entry" : "Exit"]),
				indicator: "green",
			}, 5);
		})
		.catch(err => {
			frappe.msgprint({
				title: __("Upload Failed"),
				indicator: "red",
				message: (err && err.message) || String(err),
			});
		});
}

function _prompt_paste_instructions() {
	frappe.msgprint({
		title: __("How to paste a chart"),
		indicator: "blue",
		message: `
			<ol style="padding-left:18px;line-height:1.8;font-size:13px">
				<li>Take a screenshot —
					<b>Windows:</b> <code>Win+Shift+S</code>
					&nbsp;·&nbsp;
					<b>Mac:</b> <code>Cmd+Shift+4</code>
					(release without saving; it copies to clipboard)
				</li>
				<li>Come back to this Trade form and press <code>Ctrl+V</code> (<code>Cmd+V</code> on Mac).</li>
				<li>A dialog asks whether to attach it as <b>Entry</b> or <b>Exit</b> chart.</li>
				<li>Click <b>Upload & Attach</b> — it saves automatically.</li>
			</ol>
			<p style="color:#64748b;font-size:12px;margin-top:8px">
				Alternative: scroll to the <b>Chart Screenshots</b> section and click
				the attach icon on either field to browse or drag-and-drop a file.
			</p>
		`,
	});
}

function _human_size(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
