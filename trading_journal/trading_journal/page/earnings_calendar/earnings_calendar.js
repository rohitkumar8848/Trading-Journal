frappe.pages["earnings-calendar"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Earnings Calendar — Holdings & Watchlist",
		single_column: true,
	});
	new EarningsCalendarPage(page);
};

class EarningsCalendarPage {
	constructor(page) {
		this.page = page;
		this._inject_styles();
		this._render_skeleton();
		this._bind();
		this.refresh();
	}

	_inject_styles() {
		if (document.getElementById("tj-ec-css")) return;
		const css = `
		.tj-ec-wrap { padding: 14px; }
		.tj-ec-hero {
			background: linear-gradient(135deg, #f59e0b, #ef4444);
			border-radius: 12px; padding: 16px 20px; color: #fff;
			display: flex; justify-content: space-between; align-items: center;
			gap: 14px; flex-wrap: wrap; margin-bottom: 16px;
		}
		.tj-ec-hero h2 { margin: 0; font-size: 19px; font-weight: 800; }
		.tj-ec-hero .sub { font-size: 12px; opacity: 0.85; margin-top: 3px; }
		.tj-ec-btn {
			background: #fff; color: #7c2d12; font-weight: 700;
			padding: 8px 14px; border-radius: 8px; border: 0; cursor: pointer;
			font-size: 12px;
		}
		.tj-ec-bucket { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 14px; overflow: hidden; }
		.tj-ec-bucket .head { padding: 10px 16px; background: #f1f5f9; font-weight: 700; font-size: 12px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; display: flex; justify-content: space-between; }
		.tj-ec-row { display: grid; grid-template-columns: 100px 1fr 280px 120px; gap: 12px; padding: 10px 16px; border-bottom: 1px solid #f1f5f9; align-items: center; font-size: 13px; }
		.tj-ec-row:last-child { border-bottom: 0; }
		.tj-ec-row .date { font-weight: 700; color: #0f172a; }
		.tj-ec-row .date .days { font-size: 11px; color: #94a3b8; font-weight: 500; }
		.tj-ec-row .name .sym { font-weight: 700; color: #0f172a; }
		.tj-ec-row .name .co { font-size: 11px; color: #64748b; }
		.tj-ec-row .tags { display: flex; gap: 4px; flex-wrap: wrap; }
		.tj-ec-row .tag { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
		.tj-ec-row .tag.holding { background: #d1fae5; color: #065f46; }
		.tj-ec-row .tag.trade { background: #fef3c7; color: #92400e; }
		.tj-ec-row .tag.watch { background: #dbeafe; color: #1e40af; }
		.tj-ec-row .tag.est { background: #f1f5f9; color: #64748b; }
		.tj-ec-row .actions a { color: #6366f1; text-decoration: none; font-weight: 600; font-size: 11px; margin-right: 6px; }
		.tj-ec-empty { padding: 30px; text-align: center; color: #94a3b8; }
		`;
		const s = document.createElement("style");
		s.id = "tj-ec-css";
		s.textContent = css;
		document.head.appendChild(s);
	}

	_render_skeleton() {
		$(this.page.body).empty().append(`
			<div class="tj-ec-wrap">
				<div class="tj-ec-hero">
					<div>
						<h2>Earnings Calendar</h2>
						<div class="sub">Upcoming results for your holdings, open trades, and active watchlist. Source: Yahoo Finance.</div>
					</div>
					<div>
						<button class="tj-ec-btn" id="tj-ec-refresh">↻ Force Refresh</button>
					</div>
				</div>
				<div id="tj-ec-body"><div class="tj-ec-empty">Loading…</div></div>
			</div>
		`);
	}

	_bind() {
		$(this.page.body).find("#tj-ec-refresh").on("click", () => this.refresh(true));
	}

	refresh(force) {
		const $btn = $(this.page.body).find("#tj-ec-refresh");
		if (force) $btn.prop("disabled", true).text("Refreshing…");
		frappe.call({
			method: "trading_journal.trading_journal.utils.earnings.get_earnings_calendar",
			args: { days_ahead: 60, force: force ? 1 : 0 },
			callback: (r) => {
				$btn.prop("disabled", false).text("↻ Force Refresh");
				const m = r.message || {};
				this._render(m);
			},
			error: () => $btn.prop("disabled", false).text("↻ Force Refresh"),
		});
	}

	_render(m) {
		const $body = $(this.page.body).find("#tj-ec-body").empty();
		const upcoming = m.upcoming || [];
		if (!upcoming.length) {
			$body.html(`<div class="tj-ec-empty">No upcoming earnings within 60 days for your ${m.total_symbols_checked || 0} tracked symbols.</div>`);
			return;
		}
		const order = ["This Week (≤ 7d)", "Next Week (8-14d)", "This Month (15-30d)", "Later (>30d)"];
		const buckets = m.buckets || {};
		const today = new Date();
		order.forEach((b) => {
			const items = buckets[b];
			if (!items || !items.length) return;
			const rows = items.map((r) => {
				const dt = new Date(r.earnings_date);
				const days = Math.round((dt - today) / 86400000);
				const tags = [];
				if (r.in_holdings) tags.push(`<span class="tag holding">Holding</span>`);
				if (r.open_trade) tags.push(`<span class="tag trade">Open Trade</span>`);
				if (r.on_watchlist) tags.push(`<span class="tag watch">Watchlist</span>`);
				if (r.is_estimated) tags.push(`<span class="tag est">Estimated</span>`);
				return `
					<div class="tj-ec-row">
						<div class="date">${frappe.datetime.str_to_user(r.earnings_date)}<div class="days">${days <= 0 ? "today" : "in " + days + "d"}</div></div>
						<div class="name">
							<div class="sym"><a href="#" class="tj-chart-hover" data-symbol="${r.symbol}" data-exchange="NSE">${r.symbol}</a></div>
							<div class="co">${frappe.utils.escape_html(r.company_name || "")}</div>
						</div>
						<div class="tags">${tags.join("")}</div>
						<div class="actions">
							<a href="/app/stock-symbol/${r.symbol}" target="_blank">Open ↗</a>
							<a href="https://www.tradingview.com/chart/?symbol=NSE:${r.symbol}" target="_blank">Chart ↗</a>
						</div>
					</div>
				`;
			}).join("");
			$body.append(`
				<div class="tj-ec-bucket">
					<div class="head"><span>${b}</span><span>${items.length} symbol${items.length === 1 ? "" : "s"}</span></div>
					${rows}
				</div>
			`);
		});
	}
}
