frappe.ui.form.on("Position", {
	refresh(frm) {
		if (frm.is_new() || !frm.doc.broker || !frm.doc.trading_symbol) return;

		const netQty = frm.doc.net_qty || 0;
		const buyQty = frm.doc.buy_qty || 0;
		const sellQty = frm.doc.sell_qty || 0;
		// Nothing to convert if the row has no real activity yet.
		if (buyQty <= 0 && sellQty <= 0) return;

		// Holding only makes sense for a still-open long position.
		if (netQty > 0) {
			frm.add_custom_button(__("Convert to Holding"), () => {
				frappe.confirm(
					__(
						"Create a Holding AND a Trade record from this position? " +
						"The next broker holdings + trades sync will dedupe — no duplicates."
					),
					() => {
						frappe.call({
							method: "trading_journal.trading_journal.doctype.position.position.convert_to_holding",
							args: { position: frm.doc.name },
							freeze: true,
							freeze_message: __("Creating Holding + Trade…"),
							callback: (r) => {
								const m = r.message || {};
								if (!m.ok) {
									frappe.msgprint({
										title: __("Could not convert"),
										message: m.error || __("Unknown error"),
										indicator: "orange",
									});
									return;
								}
								const tradeMsg = m.trade_created
									? __("Trade {0} created", [m.trade_name])
									: m.trade_name
										? __("Trade {0} (already existed)", [m.trade_name])
										: "";
								frappe.show_alert({
									message: __("Holding {0} · {1}", [m.name, tradeMsg]),
									indicator: "green",
									duration: 6,
								});
								if (m.trade_name) {
									frappe.set_route("Form", "Trade", m.trade_name);
								} else {
									frappe.set_route("Form", "Holding", m.name);
								}
							},
						});
					}
				);
			});
		}

		// Trade-only — works for open AND closed intraday/MIS/F&O positions.
		frm.add_custom_button(__("Convert to Trade"), () => {
			frappe.call({
				method: "trading_journal.trading_journal.doctype.position.position.convert_to_trade",
				args: { position: frm.doc.name },
				freeze: true,
				freeze_message: __("Creating Trade…"),
				callback: (r) => {
					const m = r.message || {};
					if (!m.ok || !m.trade_name) {
						frappe.msgprint({
							title: __("Could not create Trade"),
							message: m.error || __("Unknown error"),
							indicator: "orange",
						});
						return;
					}
					frappe.show_alert({
						message: m.trade_created
							? __("Trade {0} created", [m.trade_name])
							: __("Trade {0} (already existed)", [m.trade_name]),
						indicator: "green",
						duration: 6,
					});
					frappe.set_route("Form", "Trade", m.trade_name);
				},
			});
		});
	},
});
