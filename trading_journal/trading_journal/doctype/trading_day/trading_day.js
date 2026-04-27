frappe.ui.form.on("Trading Day", {
	refresh(frm) {
		frm.set_indicator_formatter("status", (doc) => {
			const map = { Planned: "blue", Executed: "green", Skipped: "gray" };
			return map[doc.status] || "gray";
		});

		if (!frm.is_new()) {
			frm.add_custom_button(__("Refresh Actuals"), () => {
				frappe.call({
					method: "trading_journal.trading_journal.doctype.trading_day.trading_day.refresh_actuals",
					args: { name: frm.doc.name },
					freeze: true,
					freeze_message: __("Pulling trades for this date…"),
					callback: (r) => {
						const m = r.message || {};
						if (m.ok) {
							frappe.show_alert({
								message: `Trades: ${m.total_trades} · P&L: ${format_currency(m.total_pnl)}`,
								indicator: m.total_pnl >= 0 ? "green" : "red",
							}, 6);
							frm.reload_doc();
						}
					},
				});
			}, __("Tools"));

			frm.add_custom_button(__("View Trades for Date"), () => {
				if (!frm.doc.trade_date) return;
				const filters = { sell_date: frm.doc.trade_date };
				if (frm.doc.broker) filters.broker = frm.doc.broker;
				frappe.set_route("List", "Trade", filters);
			}, __("View"));
		}

		_render_plan_banner(frm);
	},

	max_loss_per_day(frm) { _render_plan_banner(frm); },
	total_pnl(frm) { _render_plan_banner(frm); },
});

function _render_plan_banner(frm) {
	const $wrap = frm.fields_dict.trade_date.$wrapper.closest(".form-section");
	$wrap.find(".tj-plan-banner").remove();
	const cap = parseFloat(frm.doc.max_loss_per_day || 0);
	const actual = parseFloat(frm.doc.total_pnl || 0);
	const blown = cap > 0 && actual <= -cap;

	if (frm.is_new() || (!cap && !frm.doc.total_trades)) return;

	const color = blown ? "#f43f5e" : (actual >= 0 ? "#10b981" : "#f59e0b");
	const label = blown
		? "⛔ Daily loss limit breached"
		: (actual >= 0 ? "✅ Day in profit" : "⚠ Day negative, within limit");
	const capStr = cap ? ` · cap ${format_currency(cap)}` : "";
	$wrap.append(`
		<div class="tj-plan-banner" style="margin:8px 0;padding:10px 14px;background:#f8fafc;border-left:3px solid ${color};border-radius:6px;font-size:12px">
			<b style="color:${color}">${label}</b>
			&nbsp;·&nbsp; Trades: <b>${frm.doc.total_trades || 0}</b>
			&nbsp;·&nbsp; P&L: <b>${format_currency(actual)}</b>${capStr}
		</div>
	`);
}
