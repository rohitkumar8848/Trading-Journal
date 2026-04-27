frappe.ui.form.on("Stock Symbol", {
	refresh(frm) {
		if (frm.is_new() || !frm.doc.symbol || !trading_journal.ai) return;
		frm.add_custom_button(__("Fetch News"), () => trading_journal.ai.show_news(frm.doc.symbol), __("AI"));
		frm.add_custom_button(__("Analyse with AI"), () => trading_journal.ai.show_analysis(frm.doc.symbol), __("AI"));
	},
});
