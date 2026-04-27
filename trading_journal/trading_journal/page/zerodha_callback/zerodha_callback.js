frappe.pages["zerodha-callback"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Zerodha Login",
		single_column: true,
	});
	new ZerodhaCallback(page);
};

class ZerodhaCallback {
	constructor(page) {
		this.page = page;
		this._inject_styles();
		this._render_shell();
		this._handle_callback();
	}

	_render_shell() {
		this.page.main.html(`
			<div class="zc-root">
				<div class="zc-card">
					<div class="zc-icon" id="zc-icon">🔐</div>
					<h2 id="zc-title">Processing Zerodha login…</h2>
					<p id="zc-msg">Exchanging request token for access token.</p>
					<div id="zc-actions" class="zc-actions" style="display:none"></div>
				</div>
			</div>
		`);
	}

	_handle_callback() {
		const params = new URLSearchParams(window.location.search);
		const request_token = params.get("request_token");
		const status = params.get("status");
		const broker = localStorage.getItem("zerodha_login_broker");

		if (status !== "success" || !request_token) {
			return this._fail("Login cancelled or failed",
				`Kite returned status=${status || "unknown"}. Try again from the broker form.`);
		}
		if (!broker) {
			return this._fail("Missing broker context",
				"Click 'Login to Zerodha' from the broker form again — the broker name wasn't remembered.");
		}

		frappe.call({
			method: "trading_journal.trading_journal.utils.zerodha_client.exchange_token",
			args: { broker: broker, request_token: request_token },
			callback: (r) => {
				const m = r.message || {};
				if (m.ok) {
					localStorage.removeItem("zerodha_login_broker");
					this._succeed(broker, m.message || "Logged in successfully");
				} else {
					this._fail("Token exchange failed", m.error || "Unknown error");
				}
			},
			error: () => this._fail("Server error", "Could not reach the server."),
		});
	}

	_succeed(broker, msg) {
		$("#zc-icon").text("✅");
		$("#zc-title").text("Logged in to Zerodha");
		$("#zc-msg").text(msg);
		$("#zc-actions").show().html(`
			<a href="/app/broker/${encodeURIComponent(broker)}" class="btn btn-primary">Open Broker</a>
			<button class="btn btn-default" id="zc-sync">Sync Now</button>
			<a href="/app/trade-holdings" class="btn btn-default">View Holdings</a>
		`);
		$("#zc-sync").on("click", () => {
			frappe.call({
				method: "trading_journal.trading_journal.utils.zerodha_client.sync_broker",
				args: { broker: broker },
				freeze: true, freeze_message: "Syncing from Zerodha…",
				callback: (r) => {
					const m = r.message || {};
					const h = m.holdings || {}, p = m.positions || {};
					frappe.msgprint({
						title: m.ok ? "Synced" : "Sync finished with errors",
						indicator: m.ok ? "green" : "orange",
						message: `Holdings: ${h.count || 0}${h.error ? ' · err: ' + h.error : ''}<br>Positions: ${p.count || 0}${p.error ? ' · err: ' + p.error : ''}`,
					});
				},
			});
		});
	}

	_fail(title, msg) {
		$("#zc-icon").text("⚠️");
		$("#zc-title").text(title);
		$("#zc-msg").text(msg);
		$("#zc-actions").show().html(`
			<a href="/app/broker" class="btn btn-primary">Back to Broker list</a>
		`);
	}

	_inject_styles() {
		if ($("#zc-styles").length) return;
		$("head").append(`<style id="zc-styles">
			body [data-page-route="zerodha-callback"] .page-body { background:#f6f7fb; }
			.zc-root { display:flex; justify-content:center; padding:60px 20px; }
			.zc-card {
				background:#fff; border:1px solid #e6e8f0; border-radius:16px;
				padding:40px 48px; max-width:480px; width:100%; text-align:center;
				box-shadow: 0 4px 24px rgba(15,23,42,.07);
			}
			.zc-icon { font-size:56px; margin-bottom:12px; }
			.zc-card h2 { font-weight:800; letter-spacing:-.4px; margin:4px 0 8px; }
			.zc-card p { color:#64748b; }
			.zc-actions { display:flex; gap:8px; justify-content:center; margin-top:20px; flex-wrap:wrap; }
		</style>`);
	}
}
