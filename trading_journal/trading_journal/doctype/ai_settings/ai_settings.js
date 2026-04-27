frappe.ui.form.on("AI Settings", {
	refresh(frm) {
		frm.add_custom_button(__("List Available Models"), () => {
			frappe.call({
				method: "trading_journal.trading_journal.utils.ai_assistant.list_models",
				freeze: true,
				freeze_message: __("Asking Google what your key can use…"),
				callback: (r) => {
					const m = r.message || {};
					if (!m.ok) {
						frappe.msgprint({
							title: __("Failed to list models"),
							indicator: "red",
							message: `<code>${frappe.utils.escape_html(m.error)}</code>`,
						});
						return;
					}
					const models = m.models || [];
					if (!models.length) {
						frappe.msgprint({ title: __("No models"), message: "No generateContent models available for this key.", indicator: "orange" });
						return;
					}
					const d = new frappe.ui.Dialog({
						title: __(`${models.length} models available`),
						size: "large",
						fields: [{ fieldtype: "HTML", fieldname: "list" }],
					});
					d.show();
					const html = `
						<div style="font-size:12px;color:#64748b;margin-bottom:10px">
							Click any model to set it as your active model.
						</div>
						<div style="display:flex;flex-direction:column;gap:6px;max-height:60vh;overflow:auto">
						${models.map(mm => `
							<div class="tj-model-row" data-name="${frappe.utils.escape_html(mm.name)}"
								 style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer">
								<div style="display:flex;justify-content:space-between;align-items:center">
									<div>
										<div style="font-weight:700;font-size:13px;color:#0f172a"><code>${frappe.utils.escape_html(mm.name)}</code></div>
										<div style="font-size:11px;color:#64748b;margin-top:2px">${frappe.utils.escape_html(mm.display_name)}</div>
									</div>
									<button class="btn btn-xs btn-primary tj-pick-model">Use this</button>
								</div>
								${mm.description ? `<div style="font-size:11px;color:#475569;margin-top:6px">${frappe.utils.escape_html(mm.description)}</div>` : ""}
							</div>
						`).join("")}
						</div>
					`;
					d.fields_dict.list.$wrapper.html(html);
					d.fields_dict.list.$wrapper.find(".tj-model-row, .tj-pick-model").on("click", function (e) {
						e.stopPropagation();
						const $row = $(this).closest(".tj-model-row");
						const name = $row.data("name");
						frm.set_value("model", name).then(() => frm.save()).then(() => {
							frappe.show_alert({ message: `Active model: ${name}`, indicator: "green" }, 5);
							d.hide();
						});
					});
				},
			});
		}, __("Tools"));

		frm.add_custom_button(__("Test AI Connection"), () => {
			frappe.call({
				method: "trading_journal.trading_journal.utils.ai_assistant.test_gemini",
				freeze: true,
				freeze_message: __("Pinging Gemini with a tiny prompt…"),
				callback: (r) => {
					const m = r.message || {};
					if (m.ok) {
						frappe.msgprint({
							title: __("Connection OK"),
							indicator: "green",
							message: `<b>Model:</b> ${m.model}<br/><b>Reply:</b> <code>${frappe.utils.escape_html(m.reply)}</code>`,
						});
					} else {
						frappe.msgprint({
							title: __("Connection Failed"),
							indicator: "red",
							message: `<b>Model:</b> ${m.model || "?"}<br/><b>Error:</b> <code style="white-space:pre-wrap">${frappe.utils.escape_html(m.error)}</code>`,
						});
					}
				},
			});
		}, __("Tools"));

		frm.add_custom_button(__("Clear AI Cache"), () => {
			frappe.call({
				method: "trading_journal.trading_journal.utils.ai_assistant.clear_cache",
				callback: (r) => {
					const m = r.message || {};
					frappe.show_alert({
						message: `Cleared ${m.deleted || 0} cached entries`,
						indicator: "green",
					}, 5);
				},
			});
		}, __("Tools"));
	},
});
