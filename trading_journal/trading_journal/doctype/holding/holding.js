frappe.ui.form.on("Holding", {
	refresh(frm) {
		if (frm.is_new() || !frm.doc.trading_symbol || !trading_journal.ai) return;
		frm.add_custom_button(__("Fetch News"), () => trading_journal.ai.show_news(frm.doc.trading_symbol), __("AI"));
		frm.add_custom_button(__("Analyse with AI"), () => trading_journal.ai.show_analysis(frm.doc.trading_symbol), __("AI"));
	},
});
