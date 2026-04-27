frappe.pages["trade-holdings"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Portfolio Holdings",
		single_column: true,
	});
	new TradeHoldings(page);
};

class TradeHoldings {
	constructor(page) {
		this.page = page;
		this.broker = "";
		this.view = "consolidated"; // consolidated | per-broker | positions
		this.page.add_button(__("Sync All Brokers"), () => this._sync_all(), { icon: "refresh", btn_class: "btn-primary" });
		this.page.add_button(__("Refresh"), () => this._refresh(), { icon: "reload" });
		this._inject_styles();
		this._render_shell();
		this._refresh();
	}

	_render_shell() {
		this.page.main.html(`
			<div class="th-root">
				<div class="th-filter-bar">
					<div class="th-filter">
						<label>Broker</label>
						<div class="th-broker-slot"></div>
					</div>
					<div class="th-view-toggle">
						<button class="th-tab active" data-view="consolidated">🔀 Consolidated</button>
						<button class="th-tab" data-view="per-broker">🏦 Per Broker</button>
						<button class="th-tab" data-view="positions">⚡ Positions</button>
					</div>
				</div>

				<div class="th-summary" id="th-summary"></div>
				<div class="th-brokers-meta" id="th-brokers-meta"></div>

				<div class="th-card">
					<div class="th-card-title" id="th-title">Consolidated Holdings</div>
					<div class="th-table-wrap" id="th-body"></div>
				</div>
			</div>
		`);

		this._mount_broker_picker();

		this.page.main.find(".th-tab").on("click", (e) => {
			this.view = $(e.currentTarget).data("view");
			this.page.main.find(".th-tab").removeClass("active");
			$(e.currentTarget).addClass("active");
			this._render();
		});
	}

	_mount_broker_picker() {
		const $slot = this.page.main.find(".th-broker-slot");
		this.broker_field = frappe.ui.form.make_control({
			parent: $slot[0],
			df: {
				fieldtype: "Link", fieldname: "broker", options: "Broker",
				placeholder: __("All Brokers"),
				onchange: () => { this.broker = this.broker_field.get_value() || ""; this._refresh(); },
			},
			render_input: true,
		});
	}

	_refresh() {
		frappe.call({
			method: "trading_journal.trading_journal.page.trade_holdings.trade_holdings.get_portfolio",
			args: { broker: this.broker },
			callback: (r) => {
				this.data = r.message || {};
				this._render();
			},
		});
	}

	_sync_all() {
		frappe.call({
			method: "trading_journal.trading_journal.utils.dhan_client.sync_all_supported",
			freeze: true, freeze_message: "Syncing all brokers…",
			callback: (r) => {
				const m = r.message || {};
				const lines = (m.results || []).map(x =>
					`[${x.source || "?"}] ${x.broker}: ${x.ok
						? `✓ H=${(x.holdings||{}).count||0} P=${(x.positions||{}).count||0}`
						: `✗ ${(x.holdings||{}).error || (x.positions||{}).error || "error"}`}`
				);
				frappe.msgprint({
					title: `Sync complete — ${m.count || 0} broker(s)`,
					message: lines.join("<br>") || "No active Dhan/Zerodha brokers.",
					indicator: "blue",
				});
				this._refresh();
			},
		});
	}

	_render() {
		if (!this.data) return;
		this._render_summary();
		this._render_broker_meta();

		if (this.view === "consolidated") {
			this._render_consolidated();
		} else if (this.view === "per-broker") {
			this._render_per_broker();
		} else {
			this._render_positions();
		}
	}

	_render_summary() {
		const h = this.data.holdings_summary || {};
		const p = this.data.positions_summary || {};
		const t = this.data.trades_summary || {};
		const hColor = h.pnl >= 0 ? "#10b981" : "#f43f5e";
		const pColor = p.total_pnl >= 0 ? "#10b981" : "#f43f5e";
		const tColor = t.realized_pnl >= 0 ? "#10b981" : "#f43f5e";
		$("#th-summary").html(`
			<div class="th-kpi-grid">
				${this._kpi("Holdings Invested", format_currency(h.invested), "")}
				${this._kpi("Holdings Current", format_currency(h.current), "")}
				${this._kpi("Unrealized P&L", format_currency(h.pnl) + ` <span class="th-kpi-sub">(${flt(h.pnl_percent).toFixed(2)}%)</span>`, hColor)}
				${this._kpi("Unique Stocks", h.unique_symbols || 0, "")}
				${this._kpi("Open Positions", p.open || 0, "")}
				${this._kpi("Positions P&L (Realized)", format_currency(p.realized_pnl), p.realized_pnl >= 0 ? "#10b981" : "#f43f5e")}
				${this._kpi("Positions P&L (Unrealized)", format_currency(p.unrealized_pnl), pColor)}
				${this._kpi("Realized P&L (Trade Journal)", format_currency(t.realized_pnl) + ` <span class="th-kpi-sub">(${t.count || 0} trades)</span>`, tColor)}
			</div>
		`);
	}

	_render_broker_meta() {
		const brokers = this.data.brokers || [];
		if (!brokers.length) {
			$("#th-brokers-meta").html(`
				<div class="th-empty">No active brokers found. Go to <a href="/app/broker">Broker list</a> → open any Dhan account → set <b>Client ID</b> + <b>Access Token</b>, then click <b>Sync</b>.</div>
			`);
			return;
		}
		const chips = brokers.map(b => {
			const status = (b.last_sync_status || "");
			const ok = status.startsWith("OK");
			const failed = status && !ok;
			let metaTxt = "";
			if (failed) {
				const err = (b.last_sync_error || status).slice(0, 80);
				const lastOk = b.last_sync_at ? "last OK " + frappe.datetime.prettyDate(b.last_sync_at) : "never synced";
				metaTxt = `· <b>FAILED</b> — ${frappe.utils.escape_html(err)} (${lastOk})`;
			} else if (ok) {
				metaTxt = "· synced " + frappe.datetime.prettyDate(b.last_sync_at);
			} else {
				metaTxt = "· never synced";
			}
			const titleAttr = failed ? `title="${frappe.utils.escape_html(b.last_sync_error || status)}"` : "";
			return `
				<div class="th-chip ${ok ? 'ok' : (failed ? 'err' : '')}" ${titleAttr}>
					<span class="th-chip-dot"></span>
					<span class="th-chip-name">${b.name}</span>
					<span class="th-chip-meta">${b.account_holder ? "· " + b.account_holder + " " : ""}${metaTxt}</span>
				</div>
			`;
		}).join("");
		$("#th-brokers-meta").html(`<div class="th-chips">${chips}</div>`);
	}

	_render_consolidated() {
		$("#th-title").text("Consolidated Holdings (across all brokers)");
		const rows = this.data.consolidated_holdings || [];
		if (!rows.length) {
			$("#th-body").html(`<div class="th-empty">No holdings yet. Configure your Dhan Client ID + Access Token on a Broker and click Sync.</div>`);
			return;
		}
		const header = `
			<div class="th-row th-head">
				<span>Symbol</span><span>Qty</span><span>Avg</span><span>LTP</span>
				<span>Invested</span><span>Current</span><span>P&L</span><span>%</span>
				<span>Brokers</span>
			</div>
		`;
		const body = rows.map(r => {
			const color = r.unrealized_pnl >= 0 ? "#10b981" : "#f43f5e";
			const brokers = r.brokers.map(b => {
				const label = b.holder
					? `${frappe.utils.escape_html(b.broker)} · ${frappe.utils.escape_html(b.holder)}`
					: frappe.utils.escape_html(b.broker);
				return `<span class="th-bchip" title="Qty ${b.qty} @ ${b.avg}">${label}</span>`;
			}).join("");
			return `
				<div class="th-row">
					<span class="th-sym">
						<b>${frappe.utils.escape_html(r.trading_symbol)}</b>
						<small>${r.exchange || ""}</small>
					</span>
					<span>${r.total_qty}</span>
					<span>${format_currency(r.avg_cost_price)}</span>
					<span>${format_currency(r.ltp)}</span>
					<span>${format_currency(r.invested_value)}</span>
					<span>${format_currency(r.current_value)}</span>
					<span style="color:${color};font-weight:800">${format_currency(r.unrealized_pnl)}</span>
					<span style="color:${color};font-weight:700">${flt(r.pnl_percent).toFixed(2)}%</span>
					<span class="th-bchips">${brokers}</span>
				</div>
			`;
		}).join("");
		$("#th-body").html(header + body);
	}

	_render_per_broker() {
		$("#th-title").text("Holdings Per Broker");
		const rows = this.data.holdings || [];
		if (!rows.length) {
			$("#th-body").html(`<div class="th-empty">No holdings yet.</div>`);
			return;
		}
		// Group by broker
		const byBroker = {};
		rows.forEach(h => {
			if (!byBroker[h.broker]) byBroker[h.broker] = [];
			byBroker[h.broker].push(h);
		});
		let html = "";
		Object.keys(byBroker).sort().forEach(b => {
			const items = byBroker[b];
			const invested = items.reduce((s, x) => s + flt(x.invested_value), 0);
			const current = items.reduce((s, x) => s + flt(x.current_value), 0);
			const pnl = current - invested;
			const pct = invested ? (pnl / invested * 100).toFixed(2) : "0.00";
			const color = pnl >= 0 ? "#10b981" : "#f43f5e";
			const holder = items[0] && items[0].account_holder;
			const headerLabel = holder
				? `<b>${frappe.utils.escape_html(b)}</b> · ${frappe.utils.escape_html(holder)}`
				: `<b>${frappe.utils.escape_html(b)}</b>`;
			html += `
				<div class="th-broker-group">
					<div class="th-broker-group-head">
						<div>${headerLabel} · ${items.length} holding${items.length > 1 ? "s" : ""}</div>
						<div>
							Invested ${format_currency(invested)} ·
							Current ${format_currency(current)} ·
							<span style="color:${color};font-weight:700">${format_currency(pnl)} (${pct}%)</span>
						</div>
					</div>
					<div class="th-row th-head">
						<span>Symbol</span><span>Qty</span><span>Avg</span><span>LTP</span>
						<span>Invested</span><span>Current</span><span>P&L</span><span>%</span>
					</div>
					${items.map(h => {
						const c = h.unrealized_pnl >= 0 ? "#10b981" : "#f43f5e";
						return `
							<div class="th-row th-row-8">
								<span class="th-sym"><b>${frappe.utils.escape_html(h.trading_symbol)}</b><small>${h.exchange || ""}</small></span>
								<span>${h.total_qty}</span>
								<span>${format_currency(h.avg_cost_price)}</span>
								<span>${format_currency(h.last_traded_price)}</span>
								<span>${format_currency(h.invested_value)}</span>
								<span>${format_currency(h.current_value)}</span>
								<span style="color:${c};font-weight:800">${format_currency(h.unrealized_pnl)}</span>
								<span style="color:${c};font-weight:700">${flt(h.pnl_percent).toFixed(2)}%</span>
							</div>
						`;
					}).join("")}
				</div>
			`;
		});
		$("#th-body").html(html);
	}

	_render_positions() {
		$("#th-title").text("Positions (Intraday / F&O)");
		const rows = this.data.positions || [];
		if (!rows.length) {
			$("#th-body").html(`<div class="th-empty">No positions. Positions appear once you have open/closed intraday or F&O trades today.</div>`);
			return;
		}
		const header = `
			<div class="th-row th-head th-pos-row">
				<span>Symbol</span><span>Broker</span><span>Product</span><span>Type</span>
				<span>Net Qty</span><span>Buy Avg</span><span>Sell Avg</span><span>LTP</span>
				<span>Realized</span><span>Unrealized</span>
			</div>
		`;
		const body = rows.map(p => {
			const rColor = p.realized_pnl >= 0 ? "#10b981" : "#f43f5e";
			const uColor = p.unrealized_pnl >= 0 ? "#10b981" : "#f43f5e";
			return `
				<div class="th-row th-pos-row">
					<span class="th-sym"><b>${frappe.utils.escape_html(p.trading_symbol)}</b><small>${p.exchange_segment || ""}</small></span>
					<span>${p.broker}</span>
					<span><span class="th-pill">${p.product_type || "—"}</span></span>
					<span><span class="th-pill ${(p.position_type || '').toLowerCase()}">${p.position_type || "—"}</span></span>
					<span>${p.net_qty}</span>
					<span>${format_currency(p.buy_avg)}</span>
					<span>${format_currency(p.sell_avg)}</span>
					<span>${format_currency(p.last_traded_price)}</span>
					<span style="color:${rColor};font-weight:700">${format_currency(p.realized_pnl)}</span>
					<span style="color:${uColor};font-weight:800">${format_currency(p.unrealized_pnl)}</span>
				</div>
			`;
		}).join("");
		$("#th-body").html(header + body);
	}

	_kpi(label, value, color) {
		return `
			<div class="th-kpi">
				<div class="th-kpi-label">${label}</div>
				<div class="th-kpi-value" style="color:${color || 'var(--tj-text)'}">${value}</div>
			</div>
		`;
	}

	_inject_styles() {
		if ($("#th-styles").length) return;
		$("head").append(`<style id="th-styles">
			body [data-page-route="trade-holdings"] .container,
			body [data-page-route="trade-holdings"] .page-body,
			body [data-page-route="trade-holdings"] .layout-main-section { max-width:100% !important; width:100% !important; }
			body [data-page-route="trade-holdings"] .page-body { background:#f6f7fb; }

			.th-root { padding:20px; color:#0f172a; font-feature-settings:"tnum" 1; }

			.th-filter-bar {
				display:flex; flex-wrap:wrap; gap:14px; align-items:flex-end;
				padding:16px 20px; margin-bottom:18px; border-radius:14px;
				background: linear-gradient(135deg, #6366f1, #8b5cf6 50%, #d946ef);
				box-shadow: 0 12px 36px rgba(99,102,241,.18);
				position:relative; overflow:hidden;
			}
			.th-filter-bar::before {
				content:""; position:absolute; inset:0;
				background: radial-gradient(800px 200px at 90% -20%, rgba(255,255,255,.25), transparent 60%);
			}
			.th-filter { display:flex; flex-direction:column; gap:4px; min-width:200px; position:relative; }
			.th-filter label { font-size:10px; color:rgba(255,255,255,.85); text-transform:uppercase; letter-spacing:.6px; font-weight:700; margin:0; }
			.th-broker-slot .form-group { margin:0; }
			.th-broker-slot .control-label { display:none; }
			.th-broker-slot input {
				height:34px; font-size:12px; width:220px;
				border:1px solid rgba(255,255,255,.3) !important;
				background:rgba(255,255,255,.95) !important; color:#0f172a !important;
				border-radius:8px !important; font-weight:600;
			}
			.th-view-toggle { margin-left:auto; display:flex; gap:4px; background:rgba(255,255,255,.15); padding:4px; border-radius:10px; position:relative; }
			.th-tab {
				border:0; background:transparent; padding:8px 16px; color:rgba(255,255,255,.9);
				font-size:12px; font-weight:700; border-radius:8px; cursor:pointer;
				transition:background .15s;
			}
			.th-tab.active { background:#fff; color:#6366f1; }

			.th-kpi-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:12px; margin-bottom:18px; }
			.th-kpi {
				background:#fff; border:1px solid #e6e8f0; border-radius:12px;
				padding:14px 18px; box-shadow:0 1px 3px rgba(15,23,42,.05);
			}
			.th-kpi-label { font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:.5px; font-weight:700; }
			.th-kpi-value { font-size:20px; font-weight:800; margin-top:4px; letter-spacing:-.3px; }
			.th-kpi-sub { font-size:11px; font-weight:600; opacity:.85; }

			.th-brokers-meta { margin-bottom:16px; }
			.th-chips { display:flex; flex-wrap:wrap; gap:8px; }
			.th-chip {
				display:inline-flex; align-items:center; gap:8px;
				background:#fff; border:1px solid #e6e8f0; border-radius:999px;
				padding:6px 14px; font-size:12px; font-weight:600;
			}
			.th-chip .th-chip-dot { width:8px; height:8px; border-radius:50%; background:#94a3b8; }
			.th-chip.ok .th-chip-dot { background:#10b981; }
			.th-chip.err .th-chip-dot { background:#f43f5e; }
			.th-chip-meta { color:#64748b; font-weight:500; }

			.th-card {
				background:#fff; border:1px solid #e6e8f0; border-radius:14px;
				padding:20px; box-shadow:0 1px 3px rgba(15,23,42,.05);
			}
			.th-card-title {
				font-size:13px; font-weight:700; color:#64748b;
				text-transform:uppercase; letter-spacing:.7px; margin-bottom:14px;
				display:flex; align-items:center; gap:8px;
			}
			.th-card-title::before {
				content:""; width:4px; height:14px; border-radius:2px;
				background: linear-gradient(180deg, #6366f1, #8b5cf6);
			}

			.th-row {
				display:grid;
				grid-template-columns: 2fr 0.7fr 1fr 1fr 1.2fr 1.2fr 1.2fr 0.7fr 1.5fr;
				gap:10px; font-size:12.5px; padding:12px 14px; align-items:center;
				border-bottom:1px solid #f0f1f7; transition:background .15s;
			}
			.th-row-8 { grid-template-columns: 2fr 0.7fr 1fr 1fr 1.2fr 1.2fr 1.2fr 0.7fr; }
			.th-pos-row { grid-template-columns: 1.8fr 1fr 0.7fr 0.7fr 0.7fr 1fr 1fr 1fr 1fr 1fr; }
			.th-row:last-child { border-bottom:0; }
			.th-row:hover:not(.th-head) { background:#f8f9fd; }
			.th-head {
				background:#f1f2f8; font-weight:700; color:#64748b;
				text-transform:uppercase; font-size:10.5px; letter-spacing:.5px;
				border-radius:8px; border:0;
			}
			.th-sym b { display:block; font-size:13px; color:#0f172a; }
			.th-sym small { font-size:10px; color:#94a3b8; font-weight:600; text-transform:uppercase; letter-spacing:.4px; }

			.th-bchips { display:flex; gap:4px; flex-wrap:wrap; }
			.th-bchip {
				font-size:10px; padding:2px 8px; border-radius:999px;
				background:#eef2ff; color:#4f46e5; font-weight:700; letter-spacing:.2px;
			}

			.th-pill {
				font-size:10px; padding:2px 8px; border-radius:999px;
				background:#eef1f7; color:#475569; font-weight:700; letter-spacing:.3px;
			}
			.th-pill.long { background:#d1fae5; color:#065f46; }
			.th-pill.short { background:#ffe4e6; color:#9f1239; }
			.th-pill.closed { background:#e2e8f0; color:#475569; }

			.th-broker-group { margin-bottom:22px; }
			.th-broker-group-head {
				display:flex; justify-content:space-between; align-items:center;
				padding:10px 14px; background:linear-gradient(135deg, #eef2ff, #f5f3ff);
				border-radius:10px 10px 0 0; border-bottom:1px solid #e0e7ff;
				font-size:13px;
			}

			.th-empty { color:#64748b; padding:40px 20px; text-align:center; font-size:13px; font-style:italic; background:#fafbfe; border-radius:10px; }
		</style>`);
	}
}

function flt(v) { return parseFloat(v) || 0; }
