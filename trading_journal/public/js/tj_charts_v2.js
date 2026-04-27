// Hover-preview popup for stock charts. Used by the screener pages.
// Renders a candlestick chart from Yahoo OHLC data we fetch ourselves
// (so coverage matches the screener universe exactly — no "symbol not
// available" errors from third-party widgets).
//
// Usage: any element with class `tj-chart-hover` and `data-symbol="RELIANCE"`
// (optionally `data-exchange="NSE"`) shows the chart on hover.
(function () {
	"use strict";
	if (window.TJChartPopup) return;

	const HIDE_DELAY_MS = 220;
	const SHOW_DELAY_MS = 200;
	const POPUP_W = 620;
	const POPUP_H = 380;
	const LWC_URL = "https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js";

	let $popup = null;
	let chart = null;
	let candleSeries = null;
	let volumeSeries = null;
	let hideTimer = null;
	let showTimer = null;
	let currentKey = null;
	let lwcLoading = null;
	let stylesInjected = false;
	let dataCache = {}; // key -> {candles, ts}
	const DATA_CACHE_TTL_MS = 25 * 60 * 1000;

	function inject_styles() {
		if (stylesInjected || document.getElementById("tj-chart-popup-css")) return;
		const css = `
		.tj-chart-popup {
			position: fixed; z-index: 99999; width: ${POPUP_W}px; height: ${POPUP_H}px;
			background: #fff; border: 1px solid #cbd5e1; border-radius: 10px;
			box-shadow: 0 18px 40px rgba(15,23,42,0.25);
			overflow: hidden; display: none;
		}
		.tj-chart-popup.show { display: flex; flex-direction: column; }
		.tj-chart-popup .tj-cp-head {
			padding: 8px 12px; background: #1e293b; color: #fff;
			font-size: 12px; font-weight: 700; display: flex; justify-content: space-between;
			align-items: center; gap: 12px; flex-shrink: 0;
		}
		.tj-chart-popup .tj-cp-head .tj-cp-title { display: flex; align-items: baseline; gap: 8px; }
		.tj-chart-popup .tj-cp-head .tj-cp-sym { font-size: 13px; }
		.tj-chart-popup .tj-cp-head .tj-cp-px { font-size: 12px; color: #94a3b8; font-weight: 600; }
		.tj-chart-popup .tj-cp-head .tj-cp-px.up { color: #34d399; }
		.tj-chart-popup .tj-cp-head .tj-cp-px.down { color: #fb7185; }
		.tj-chart-popup .tj-cp-head a {
			color: #fff; text-decoration: none; font-size: 11px; opacity: 0.85;
		}
		.tj-chart-popup .tj-cp-head a:hover { opacity: 1; text-decoration: underline; }
		.tj-chart-popup .tj-cp-body { flex: 1; position: relative; min-height: 0; }
		.tj-chart-popup .tj-cp-chart { width: 100%; height: 100%; }
		.tj-chart-popup .tj-cp-status {
			position: absolute; inset: 0; display: flex; align-items: center;
			justify-content: center; color: #94a3b8; font-size: 13px;
			background: #fff; pointer-events: none;
		}
		.tj-chart-popup .tj-cp-status.err { color: #b91c1c; }
		.tj-chart-popup .tj-cp-status.hidden { display: none; }
		.tj-chart-hover { cursor: pointer; }
		`;
		const style = document.createElement("style");
		style.id = "tj-chart-popup-css";
		style.textContent = css;
		document.head.appendChild(style);
		stylesInjected = true;
	}

	function load_lwc() {
		if (window.LightweightCharts) return Promise.resolve();
		if (lwcLoading) return lwcLoading;
		lwcLoading = new Promise((resolve, reject) => {
			const s = document.createElement("script");
			s.src = LWC_URL;
			s.async = true;
			s.onload = () => resolve();
			s.onerror = () => reject(new Error("Could not load Lightweight Charts library"));
			document.head.appendChild(s);
		});
		return lwcLoading;
	}

	function ensure_popup() {
		if ($popup) return $popup;
		inject_styles();
		const $el = $(`
			<div class="tj-chart-popup" role="dialog">
				<div class="tj-cp-head">
					<span class="tj-cp-title">
						<span class="tj-cp-sym">—</span>
						<span class="tj-cp-px"></span>
					</span>
					<a class="tj-cp-open" target="_blank">Open in TradingView ↗</a>
				</div>
				<div class="tj-cp-body">
					<div class="tj-cp-chart"></div>
					<div class="tj-cp-status">Loading chart…</div>
				</div>
			</div>
		`).appendTo("body");
		$popup = $el;
		$el.on("mouseenter", () => clearTimeout(hideTimer));
		$el.on("mouseleave", () => schedule_hide());
		return $el;
	}

	function position_popup(el) {
		const $el = ensure_popup();
		const r = el.getBoundingClientRect();
		const vw = window.innerWidth, vh = window.innerHeight;
		// Default: open to the LEFT of the link (avoids covering the row data)
		let left = r.left - POPUP_W - 14;
		let top = r.top + r.height / 2 - POPUP_H / 2;
		if (left < 8) left = r.right + 14;
		if (left + POPUP_W > vw - 8) left = vw - POPUP_W - 8;
		if (top < 8) top = 8;
		if (top + POPUP_H > vh - 8) top = vh - POPUP_H - 8;
		$el.css({ left: left + "px", top: top + "px" });
	}

	function set_status(text, isError) {
		const $el = ensure_popup();
		const $s = $el.find(".tj-cp-status");
		if (!text) {
			$s.addClass("hidden");
			return;
		}
		$s.removeClass("hidden").toggleClass("err", !!isError).text(text);
	}

	function destroy_chart() {
		if (chart) {
			try { chart.remove(); } catch (e) {}
		}
		chart = null;
		candleSeries = null;
		volumeSeries = null;
	}

	function build_chart(candles) {
		const $el = ensure_popup();
		const $container = $el.find(".tj-cp-chart");
		destroy_chart();
		const w = $container.width();
		const h = $container.height();
		chart = window.LightweightCharts.createChart($container[0], {
			width: w, height: h,
			layout: { background: { color: "#ffffff" }, textColor: "#475569", fontSize: 11 },
			grid: {
				vertLines: { color: "#f1f5f9" },
				horzLines: { color: "#f1f5f9" },
			},
			rightPriceScale: { borderColor: "#e2e8f0", scaleMargins: { top: 0.05, bottom: 0.25 } },
			timeScale: { borderColor: "#e2e8f0", timeVisible: false, rightOffset: 4 },
			crosshair: { mode: 1 },
			handleScroll: false,
			handleScale: false,
		});
		candleSeries = chart.addCandlestickSeries({
			upColor: "#10b981", downColor: "#f43f5e",
			borderUpColor: "#10b981", borderDownColor: "#f43f5e",
			wickUpColor: "#10b981", wickDownColor: "#f43f5e",
		});
		candleSeries.setData(candles.map((c) => ({
			time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
		})));
		// Volume histogram on its own pane (bottom 20%)
		volumeSeries = chart.addHistogramSeries({
			priceFormat: { type: "volume" },
			priceScaleId: "vol",
			color: "#cbd5e1",
		});
		chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
		volumeSeries.setData(candles.map((c) => ({
			time: c.time,
			value: c.volume || 0,
			color: c.close >= c.open ? "rgba(16,185,129,0.4)" : "rgba(244,63,94,0.4)",
		})));
		chart.timeScale().fitContent();
	}

	function update_header(symbol, exchange, candles) {
		const $el = ensure_popup();
		$el.find(".tj-cp-sym").text(symbol);
		const tvSymbol = `${exchange}:${symbol}`;
		$el.find(".tj-cp-open").attr(
			"href",
			`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`
		);
		const $px = $el.find(".tj-cp-px");
		$px.removeClass("up down").text("");
		if (candles && candles.length >= 2) {
			const last = candles[candles.length - 1];
			const prev = candles[candles.length - 2];
			const diff = last.close - prev.close;
			const pct = prev.close ? (diff / prev.close) * 100 : 0;
			$px.text(`₹${last.close.toFixed(2)}  ${diff >= 0 ? "+" : ""}${diff.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`);
			$px.addClass(diff >= 0 ? "up" : "down");
		}
	}

	function fetch_data(symbol, exchange) {
		const key = `${exchange}:${symbol}`;
		const c = dataCache[key];
		if (c && Date.now() - c.ts < DATA_CACHE_TTL_MS) {
			return Promise.resolve(c.candles);
		}
		return new Promise((resolve, reject) => {
			frappe.call({
				method: "trading_journal.trading_journal.utils.screener.get_chart_data",
				args: { symbol, exchange, days: 180 },
				callback: (r) => {
					const m = r.message || {};
					if (!m.ok) {
						reject(new Error(m.error || "No data"));
						return;
					}
					const candles = (m.candles || []).filter((x) => x && x.time);
					if (!candles.length) {
						reject(new Error("No candles returned"));
						return;
					}
					dataCache[key] = { candles, ts: Date.now() };
					resolve(candles);
				},
				error: (err) => {
					reject(new Error("Network error"));
				},
			});
		});
	}

	async function show_popup(el) {
		clearTimeout(hideTimer);
		const symbol = (el.getAttribute("data-symbol") || "").toUpperCase();
		const exchange = (el.getAttribute("data-exchange") || "NSE").toUpperCase();
		if (!symbol) return;
		const $el = ensure_popup();
		position_popup(el);
		const key = `${exchange}:${symbol}`;
		// If same symbol just keep showing it
		if (currentKey === key && $el.hasClass("show")) {
			return;
		}
		currentKey = key;
		// Update title immediately so the user sees feedback
		update_header(symbol, exchange, null);
		set_status("Loading chart…", false);
		$el.addClass("show");
		try {
			// Load library + data in parallel
			const [, candles] = await Promise.all([load_lwc(), fetch_data(symbol, exchange)]);
			// User may have moved off — only render if this symbol is still current
			if (currentKey !== key) return;
			set_status("", false);
			build_chart(candles);
			update_header(symbol, exchange, candles);
		} catch (e) {
			if (currentKey !== key) return;
			set_status(`Could not load chart: ${e.message || e}`, true);
		}
	}

	function schedule_hide() {
		clearTimeout(hideTimer);
		hideTimer = setTimeout(() => {
			if ($popup) $popup.removeClass("show");
		}, HIDE_DELAY_MS);
	}

	$(document).on("mouseover", ".tj-chart-hover", function (e) {
		clearTimeout(hideTimer);
		const el = e.currentTarget;
		clearTimeout(showTimer);
		showTimer = setTimeout(() => show_popup(el), SHOW_DELAY_MS);
	});
	$(document).on("mouseout", ".tj-chart-hover", function () {
		clearTimeout(showTimer);
		schedule_hide();
	});
	$(window).on("scroll", () => {
		if ($popup) $popup.removeClass("show");
		currentKey = null;
	});

	window.TJChartPopup = { ensure_popup };
})();
