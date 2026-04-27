frappe.ui.form.on("Broker", {
	refresh(frm) {
		if (frm.is_new()) return;

		// ── Dhan ──
		if (frm.doc.broker_type === "Dhan") {
			frm.add_custom_button(__("Test Connection"), () => {
				frappe.call({
					method: "trading_journal.trading_journal.utils.dhan_client.test_connection",
					args: { broker: frm.doc.name },
					freeze: true, freeze_message: "Pinging Dhan…",
					callback: (r) => {
						const m = r.message || {};
						if (m.ok) frappe.show_alert({ message: m.message, indicator: "green" }, 5);
						else frappe.msgprint({ title: "Connection Failed", message: m.error, indicator: "red" });
						frm.reload_doc();
					},
				});
			}, __("Dhan"));

			frm.add_custom_button(__("Sync Holdings + Positions"), () => {
				frappe.call({
					method: "trading_journal.trading_journal.utils.dhan_client.sync_broker",
					args: { broker: frm.doc.name },
					freeze: true, freeze_message: "Syncing from Dhan…",
					callback: (r) => {
						const m = r.message || {};
						const h = m.holdings || {}, p = m.positions || {};
						if (m.ok) {
							frappe.show_alert({
								message: `Holdings: ${h.count || 0} · Positions: ${p.count || 0}`,
								indicator: "green",
							}, 6);
						} else {
							frappe.msgprint({
								title: "Sync Issue",
								message: `Holdings: ${h.error || "OK"}<br>Positions: ${p.error || "OK"}`,
								indicator: "orange",
							});
						}
						frm.reload_doc();
					},
				});
			}, __("Dhan"));

			frm.add_custom_button(__("Sync All Trades"), () => {
				_run_sync_trades(frm, "dhan_client", null, null);
			}, __("Dhan"));

			frm.add_custom_button(__("View Holdings"), () => {
				frappe.set_route("List", "Holding", { broker: frm.doc.name });
			}, __("Dhan"));

			frm.add_custom_button(__("View Positions"), () => {
				frappe.set_route("List", "Position", { broker: frm.doc.name });
			}, __("Dhan"));

		}

		// ── Zerodha (Kite Connect) ──
		if (frm.doc.broker_type === "Zerodha") {
			// Token-expiry banner
			if (frm.doc.kite_token_expires_at) {
				const expires = frappe.datetime.str_to_obj(frm.doc.kite_token_expires_at);
				const now = new Date();
				if (expires < now) {
					frm.dashboard.add_comment(
						__("⚠ Kite access token expired. Click 'Login to Zerodha' to re-authenticate."),
						"red", true
					);
				} else {
					const hoursLeft = Math.round((expires - now) / 3600000);
					if (hoursLeft < 6) {
						frm.dashboard.add_comment(
							__(`Token expires in ~${hoursLeft}h (Zerodha resets at 6 AM IST).`),
							"orange", true
						);
					}
				}
			}

			frm.add_custom_button(__("Login to Zerodha"), () => {
				if (!frm.doc.kite_api_key) {
					return frappe.msgprint({
						title: "Missing API Key",
						message: "Set Kite API Key + API Secret on this broker first.",
						indicator: "orange",
					});
				}
				frappe.call({
					method: "trading_journal.trading_journal.utils.zerodha_client.get_login_url",
					args: { broker: frm.doc.name },
					callback: (r) => {
						const m = r.message || {};
						if (m.url) {
							// Remember which broker initiated the login (needed in the callback)
							localStorage.setItem("zerodha_login_broker", frm.doc.name);
							window.location.href = m.url;
						}
					},
				});
			}, __("Zerodha"));

			frm.add_custom_button(__("Test Connection"), () => {
				frappe.call({
					method: "trading_journal.trading_journal.utils.zerodha_client.test_connection",
					args: { broker: frm.doc.name },
					freeze: true, freeze_message: "Pinging Kite…",
					callback: (r) => {
						const m = r.message || {};
						if (m.ok) frappe.show_alert({ message: m.message, indicator: "green" }, 5);
						else frappe.msgprint({ title: "Connection Failed", message: m.error, indicator: "red" });
						frm.reload_doc();
					},
				});
			}, __("Zerodha"));

			frm.add_custom_button(__("Sync Holdings + Positions"), () => {
				frappe.call({
					method: "trading_journal.trading_journal.utils.zerodha_client.sync_broker",
					args: { broker: frm.doc.name },
					freeze: true, freeze_message: "Syncing from Zerodha…",
					callback: (r) => {
						const m = r.message || {};
						const h = m.holdings || {}, p = m.positions || {};
						if (m.ok) {
							frappe.show_alert({
								message: `Holdings: ${h.count || 0} · Positions: ${p.count || 0}`,
								indicator: "green",
							}, 6);
						} else {
							frappe.msgprint({
								title: "Sync Issue",
								message: `Holdings: ${h.error || "OK"}<br>Positions: ${p.error || "OK"}`,
								indicator: "orange",
							});
						}
						frm.reload_doc();
					},
				});
			}, __("Zerodha"));

			frm.add_custom_button(__("Sync All Trades"), () => {
				_run_sync_trades(frm, "zerodha_client", null, null);
			}, __("Zerodha"));

			frm.add_custom_button(__("View Holdings"), () => {
				frappe.set_route("List", "Holding", { broker: frm.doc.name });
			}, __("Zerodha"));

			frm.add_custom_button(__("View Positions"), () => {
				frappe.set_route("List", "Position", { broker: frm.doc.name });
			}, __("Zerodha"));

		}
	},
});

function _run_sync_trades(frm, client_module, from_date, to_date) {
	frappe.call({
		method: `trading_journal.trading_journal.utils.${client_module}.sync_trades_api`,
		args: { broker: frm.doc.name, from_date: from_date, to_date: to_date },
		freeze: true, freeze_message: __("Fetching all trades from broker…"),
		callback: (r) => {
			const m = r.message || {};
			if (m.ok) {
				const dbg = m.debug || {};
				const fetchHtml = Object.keys(dbg).length ? `
					<div style="padding:8px 10px;background:#eef2ff;border-radius:6px;font-size:11px;margin:10px 0">
						<b>Fetch (from broker):</b>
						raw=${dbg.raw_rows || 0} ·
						kept=${dbg.kept || 0} ·
						no-date=${dbg.dropped_no_date || 0} ·
						out-of-range=${dbg.dropped_out_of_range || 0} ·
						bad-action=${dbg.dropped_bad_action || 0} ·
						no-trade-id=${dbg.dropped_no_trade_id || 0}
						${dbg.sample_keys && dbg.sample_keys.length ? `
							<div style="margin-top:6px"><b>Raw keys from Dhan:</b><br>
								<code style="font-size:10px;color:#4338ca">${dbg.sample_keys.join(", ")}</code>
							</div>` : ""}
					</div>` : "";
				const skipDup = m.skipped_dup || 0;
				const skipNoSym = m.skipped_no_symbol || 0;
				const skipNoTid = m.skipped_no_trade_id || 0;
				const unmatchedSells = m.unmatched_sells || 0;
				const anySkip = skipDup + skipNoSym + skipNoTid + unmatchedSells;
				const skipHtml = anySkip ? `
					<div style="padding:8px 10px;background:#fff7ed;border-radius:6px;font-size:11px;margin:10px 0">
						<b>Skipped:</b>
						duplicates=${skipDup} ·
						empty-symbol=${skipNoSym} ·
						no-trade-id=${skipNoTid} ·
						orphan-sells=${unmatchedSells}
						${unmatchedSells ? `<div style="margin-top:4px;color:#92400e">Sells with no open trade and no holding were ignored (can't determine entry price).</div>` : ""}
					</div>` : "";
				frappe.msgprint({
					title: __("Trades Synced"),
					indicator: "green",
					message: `
						<p>Fetched <b>${m.fetched || 0}</b> leg(s) from broker.</p>
						<ul>
							<li>New Trade records: <b>${m.created || 0}</b></li>
							<li>Appended to open trades: <b>${m.appended || 0}</b></li>
							<li>Trades closed: <b>${m.closed || 0}</b></li>
						</ul>
						${fetchHtml}
						${skipHtml}
						${m.note ? `<p style="padding:8px 10px;background:#fef3c7;border-radius:6px;font-size:12px;color:#92400e;margin:10px 0">${m.note}</p>` : ""}
						<p style="margin-top:10px">
							<a href="/app/trade?broker=${encodeURIComponent(frm.doc.name)}" class="btn btn-primary btn-sm">View Trades</a>
						</p>
					`,
				});
			} else {
				frappe.msgprint({
					title: __("Sync Failed"),
					indicator: "red",
					message: m.error || "Unknown error",
				});
			}
			frm.reload_doc();
		},
	});
}
