/* Index ticker — thin scrolling strip docked under the desk navbar.
 * Polls /api/method/...get_indices every 30 s. We re-mount on Frappe's
 * `app_ready` event so it survives soft route changes too. */

(function () {
	const POLL_MS = 30000;
	let pollTimer = null;
	let lastFetch = 0;

	function ensureCss() {
		if (document.getElementById("tj-ticker-style")) return;
		const css = `
			.tj-ticker-bar {
				position: relative;
				background: linear-gradient(90deg, #0f172a, #1e293b);
				color: #f8fafc;
				font-size: 12px;
				font-weight: 600;
				letter-spacing: .2px;
				padding: 6px 0;
				overflow: hidden;
				white-space: nowrap;
				border-bottom: 1px solid rgba(255,255,255,.08);
			}
			.tj-ticker-track {
				display: inline-block;
				padding-left: 100%;
				animation: tj-ticker-scroll var(--tj-ticker-dur, 60s) linear infinite;
			}
			.tj-ticker-bar:hover .tj-ticker-track { animation-play-state: paused; }
			@keyframes tj-ticker-scroll {
				0%   { transform: translateX(0); }
				100% { transform: translateX(-100%); }
			}
			.tj-ticker-item { display: inline-block; padding: 0 22px; vertical-align: middle; }
			.tj-ticker-item .lbl { color: #cbd5e1; font-weight: 700; margin-right: 6px; letter-spacing: .3px; }
			.tj-ticker-item .px  { color: #f8fafc; font-weight: 800; margin-right: 6px; }
			.tj-ticker-item .chg.pos { color: #34d399; }
			.tj-ticker-item .chg.neg { color: #fb7185; }
			.tj-ticker-item .chg.flat { color: #cbd5e1; }
			.tj-ticker-bar .err { padding: 0 16px; color: #fb7185; font-weight: 600; }
			.tj-ticker-asof { float: right; padding: 0 14px; font-size: 10px; color: #94a3b8; }
		`;
		const tag = document.createElement("style");
		tag.id = "tj-ticker-style";
		tag.textContent = css;
		document.head.appendChild(tag);
	}

	function ensureBar() {
		let bar = document.getElementById("tj-ticker-bar");
		if (bar) return bar;
		// Mount under the navbar so it sits above the page content.
		const nav = document.querySelector(".navbar.navbar-expand")
			|| document.querySelector(".navbar")
			|| document.querySelector("header");
		if (!nav) return null;
		bar = document.createElement("div");
		bar.id = "tj-ticker-bar";
		bar.className = "tj-ticker-bar";
		bar.innerHTML = `<div class="tj-ticker-track">Loading indices…</div>`;
		nav.parentNode.insertBefore(bar, nav.nextSibling);
		return bar;
	}

	function fmtNum(n, dp) {
		if (n === null || n === undefined || isNaN(n)) return "—";
		return Number(n).toLocaleString("en-IN", {
			minimumFractionDigits: dp, maximumFractionDigits: dp,
		});
	}

	function render(bar, payload) {
		if (!payload || !payload.items || !payload.items.length) {
			bar.innerHTML = `<div class="tj-ticker-track"><span class="err">⚠ ${
				(payload && payload.error) || "Index ticker unavailable"
			}</span></div>`;
			return;
		}
		const items = payload.items.map((it) => {
			const cls = it.change > 0 ? "pos" : (it.change < 0 ? "neg" : "flat");
			const arrow = it.change > 0 ? "▲" : (it.change < 0 ? "▼" : "•");
			const sign = it.change > 0 ? "+" : "";
			return `<span class="tj-ticker-item">
				<span class="lbl">${it.label}</span>
				<span class="px">${fmtNum(it.price, 2)}</span>
				<span class="chg ${cls}">${arrow} ${sign}${fmtNum(it.change, 2)} (${sign}${fmtNum(it.change_pct, 2)}%)</span>
			</span>`;
		}).join("");
		// Repeat the items to give the marquee a continuous feel.
		bar.innerHTML = `<div class="tj-ticker-track">${items}${items}</div>`;
		// Scale animation duration to track width so per-pixel speed stays
		// constant. Read scrollWidth in rAF — measuring synchronously after
		// innerHTML often fires before layout/fonts settle and returns a
		// too-small width, which then collapses to the floor and runs fast.
		requestAnimationFrame(() => {
			const track = bar.querySelector(".tj-ticker-track");
			if (!track) return;
			const w = track.scrollWidth;
			// Target ≈ 20 px/s. Generous floor so a partial measurement still
			// renders slowly. Hard ceiling so adding more symbols can't exceed
			// 25 minutes per loop.
			const dur = Math.max(300, Math.min(1500, Math.round(w / 20)));
			bar.style.setProperty("--tj-ticker-dur", dur + "s");
		});
	}

	function tick() {
		const bar = ensureBar();
		if (!bar) return;
		// Throttle: don't fire more than once per POLL_MS even if multiple
		// app_ready events fire on rapid route changes.
		const now = Date.now();
		if (now - lastFetch < POLL_MS - 1000) return;
		lastFetch = now;
		frappe.call({
			method: "trading_journal.trading_journal.utils.index_ticker.get_indices",
			callback: (r) => render(bar, r.message || {}),
			error: () => render(bar, { ok: false, error: "Fetch failed" }),
		});
	}

	function start() {
		ensureCss();
		ensureBar();
		tick();
		if (pollTimer) clearInterval(pollTimer);
		pollTimer = setInterval(tick, POLL_MS);
	}

	if (window.frappe && frappe.ready) {
		frappe.ready(start);
	} else {
		document.addEventListener("DOMContentLoaded", start);
	}
})();
