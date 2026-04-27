// Shared AI helpers — News fetcher + AI Analysis dialog.
// Loaded globally via app_include_js so any form can call:
//   trading_journal.ai.show_news(symbol)
//   trading_journal.ai.show_analysis(symbol)

frappe.provide("trading_journal.ai");

trading_journal.ai.show_news = function (symbol, opts) {
	if (!symbol) {
		frappe.show_alert({ message: "No symbol provided", indicator: "orange" });
		return;
	}
	const force = (opts && opts.force) ? 1 : 0;
	const d = new frappe.ui.Dialog({
		title: __(`News · ${symbol}`),
		size: "large",
		fields: [{ fieldtype: "HTML", fieldname: "body" }],
		secondary_action_label: __("Refresh"),
		secondary_action: () => {
			d.hide();
			trading_journal.ai.show_news(symbol, { force: true });
		},
	});
	d.show();
	d.fields_dict.body.$wrapper.html(`<div style="padding:30px;text-align:center;color:#64748b">Fetching news from Google News…</div>`);

	frappe.call({
		method: "trading_journal.trading_journal.utils.ai_assistant.fetch_news",
		args: { symbol: symbol, force: force },
		callback: (r) => {
			const m = r.message || {};
			if (!m.ok) {
				d.fields_dict.body.$wrapper.html(`<div style="padding:20px;color:#f43f5e">${frappe.utils.escape_html(m.error || "Failed")}</div>`);
				return;
			}
			const items = m.items || [];
			if (!items.length) {
				d.fields_dict.body.$wrapper.html(`<div style="padding:20px;color:#64748b">No news found for ${symbol}.</div>`);
				return;
			}
			const cacheTag = m.from_cache
				? `<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:11px">cached</span>`
				: `<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:4px;font-size:11px">fresh</span>`;
			const html = `
				<div style="margin-bottom:12px;color:#64748b;font-size:12px">
					${items.length} headlines for <b>${m.company_name || symbol}</b> · ${cacheTag}
				</div>
				<div style="display:flex;flex-direction:column;gap:10px">
				${items.map(n => `
					<a href="${frappe.utils.escape_html(n.link)}" target="_blank" rel="noopener"
					   style="display:block;padding:12px 14px;background:#f8fafc;border-left:3px solid #6366f1;border-radius:6px;text-decoration:none;color:inherit">
						<div style="font-weight:600;font-size:13px;color:#0f172a;margin-bottom:4px">${frappe.utils.escape_html(n.title)}</div>
						<div style="font-size:11px;color:#64748b">
							${frappe.utils.escape_html(n.source || "Unknown source")}
							${n.published_at ? ` · ${frappe.datetime.prettyDate(n.published_at)}` : (n.published_raw ? ` · ${frappe.utils.escape_html(n.published_raw)}` : "")}
						</div>
					</a>
				`).join("")}
				</div>
			`;
			d.fields_dict.body.$wrapper.html(html);
		},
	});
};

trading_journal.ai.show_analysis = function (symbol, opts) {
	if (!symbol) {
		frappe.show_alert({ message: "No symbol provided", indicator: "orange" });
		return;
	}
	const force = (opts && opts.force) ? 1 : 0;
	const d = new frappe.ui.Dialog({
		title: __(`AI Analysis · ${symbol}`),
		size: "extra-large",
		fields: [{ fieldtype: "HTML", fieldname: "body" }],
		secondary_action_label: __("Re-analyse (fresh)"),
		secondary_action: () => {
			d.hide();
			trading_journal.ai.show_analysis(symbol, { force: true });
		},
	});
	d.show();
	d.fields_dict.body.$wrapper.html(`
		<div style="padding:40px;text-align:center;color:#64748b">
			<div style="font-size:32px;margin-bottom:10px">🤖</div>
			<div>Gemini is analysing <b>${symbol}</b>…</div>
			<div style="font-size:11px;margin-top:6px">Pulling price · news · your trade history. Usually 4-8 seconds.</div>
		</div>
	`);

	frappe.call({
		method: "trading_journal.trading_journal.utils.ai_assistant.analyse_stock",
		args: { symbol: symbol, force: force },
		callback: (r) => {
			const m = r.message || {};
			if (!m.ok) {
				const errMsg = m.error || "Failed";
				let helpHtml = "";
				if (errMsg.includes("not set") || errMsg.includes("disabled")) {
					helpHtml = `<a href="/app/ai-settings" class="btn btn-primary btn-sm" style="margin-top:10px">Open AI Settings</a>`;
				}
				d.fields_dict.body.$wrapper.html(`
					<div style="padding:20px;background:#fee2e2;border-left:3px solid #f43f5e;border-radius:6px">
						<b style="color:#991b1b">AI Analysis Failed</b>
						<div style="margin-top:6px;color:#7f1d1d">${frappe.utils.escape_html(errMsg)}</div>
						${helpHtml}
					</div>
				`);
				return;
			}

			const ctx = m.context_brief || {};
			const cacheTag = m.from_cache
				? `<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:999px">cached · click "Re-analyse" for fresh</span>`
				: `<span style="background:#dcfce7;color:#166534;padding:3px 10px;border-radius:999px">fresh</span>`;
			const meta = `
				<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;font-size:11px">
					<span style="background:#eef2ff;color:#4338ca;padding:3px 10px;border-radius:999px">${m.model}</span>
					${cacheTag}
					${ctx.current_price ? `<span style="background:#f0fdf4;color:#166534;padding:3px 10px;border-radius:999px">Current: ${format_currency(ctx.current_price)}</span>` : ""}
					${ctx.open_position ? `<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:999px">Open Position</span>` : ""}
					<span style="background:#f1f5f9;color:#0f172a;padding:3px 10px;border-radius:999px">${ctx.closed_trade_count || 0} closed trades</span>
					<span style="background:#f1f5f9;color:#0f172a;padding:3px 10px;border-radius:999px">${ctx.news_count || 0} headlines</span>
				</div>
			`;
			const md = (window.marked && marked.parse) ? marked.parse(m.analysis || "") : (m.analysis || "").replace(/\n/g, "<br/>");
			d.fields_dict.body.$wrapper.html(`
				${meta}
				<div class="tj-ai-output" style="font-size:13px;line-height:1.6;color:#0f172a">${md}</div>
			`);
		},
	});
};

// Inject CSS once for the markdown output
$(function () {
	if (document.getElementById("tj-ai-css")) return;
	$("head").append(`
		<style id="tj-ai-css">
			.tj-ai-output h2 { font-size:16px; font-weight:700; margin:18px 0 8px; color:#1e293b; border-bottom:1px solid #e2e8f0; padding-bottom:4px; }
			.tj-ai-output h3 { font-size:14px; font-weight:700; margin:14px 0 6px; color:#334155; }
			.tj-ai-output p { margin:6px 0; }
			.tj-ai-output ul, .tj-ai-output ol { margin:6px 0 6px 22px; }
			.tj-ai-output li { margin:3px 0; }
			.tj-ai-output strong { color:#0f172a; }
			.tj-ai-output code { background:#f1f5f9; padding:1px 5px; border-radius:3px; font-size:12px; }
		</style>
	`);
});
