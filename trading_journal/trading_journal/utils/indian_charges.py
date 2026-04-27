"""Indian equity / F&O charges calculator.

Uses the standard Indian discount-broker fee structure (Dhan / Zerodha / Upstox
are nearly identical). Results are close estimates — actual contract notes can
differ by a few paise due to rounding rules.

Rates reference (as of 2024-2026):
  Brokerage:       CNC (delivery) = 0. MIS / F&O = min(₹20, 0.03% of turnover) per side
  STT / CTT:       CNC 0.1% both sides. MIS 0.025% sell side. Futures 0.0125% sell.
                   Options 0.0625% on sell premium.
  Stamp Duty:      0.015% buy side (cash), 0.003% intraday (both)
  Exchange Charge: NSE 0.00345%, BSE 0.00375% (cash); F&O different
  SEBI Fee:        ₹10 per crore (0.000001)
  IPFT:            0.0001% (NSE only, cash + F&O)
  GST:             18% on (brokerage + exchange + SEBI + IPFT)
"""

from frappe.utils import flt


def calculate(
	*,
	trade_type: str = "Long",        # Long or Short
	product: str = "CNC",            # CNC, MIS, NRML
	quantity: float,
	entry_price: float,
	exit_price: float = 0,           # 0 if trade still open
	exchange: str = "NSE",            # NSE or BSE
	broker_type: str = "Dhan",        # Dhan / Zerodha / Upstox share this rate card
) -> dict:
	"""Return {brokerage, taxes, total, breakdown}."""
	qty = flt(quantity)
	if qty <= 0 or not entry_price:
		return _empty()

	# Determine buy vs sell values for the leg that has executed
	if trade_type == "Long":
		buy_price, sell_price = flt(entry_price), flt(exit_price)
	else:  # Short — first leg is sell
		sell_price, buy_price = flt(entry_price), flt(exit_price)

	buy_value = qty * buy_price if buy_price else 0
	sell_value = qty * sell_price if sell_price else 0
	turnover = buy_value + sell_value

	# ─── Brokerage ───
	if product == "CNC":
		brokerage = 0.0
	else:  # MIS, NRML
		if buy_value:
			brokerage = min(20.0, 0.0003 * buy_value)
		else:
			brokerage = 0.0
		if sell_value:
			brokerage += min(20.0, 0.0003 * sell_value)

	# ─── STT / CTT ───
	if product == "CNC":
		stt = 0.001 * turnover  # 0.1% both sides
	else:
		# MIS: 0.025% on sell side
		stt = 0.00025 * sell_value

	# ─── Stamp Duty ───
	if product == "CNC":
		stamp_duty = 0.00015 * buy_value  # 0.015% buy
	else:
		stamp_duty = 0.00003 * buy_value  # 0.003% intraday buy

	# ─── Exchange Transaction Charge ───
	ex_rate = 0.0000345 if (exchange or "").upper() == "NSE" else 0.0000375
	exchange_charge = ex_rate * turnover

	# ─── SEBI Fee ───
	sebi_fee = 0.000001 * turnover  # ₹10 per crore

	# ─── IPFT (NSE cash only) ───
	ipft = 0.0000001 * turnover if (exchange or "").upper() == "NSE" else 0.0

	# ─── GST (18% on brokerage + exchange + SEBI + IPFT) ───
	gst = 0.18 * (brokerage + exchange_charge + sebi_fee + ipft)

	taxes = stt + stamp_duty + exchange_charge + sebi_fee + ipft + gst
	total = brokerage + taxes

	return {
		"brokerage": round(brokerage, 2),
		"taxes": round(taxes, 2),
		"total": round(total, 2),
		"breakdown": {
			"stt": round(stt, 2),
			"stamp_duty": round(stamp_duty, 2),
			"exchange_charge": round(exchange_charge, 2),
			"sebi_fee": round(sebi_fee, 2),
			"ipft": round(ipft, 2),
			"gst": round(gst, 2),
		},
	}


def _empty():
	return {
		"brokerage": 0.0, "taxes": 0.0, "total": 0.0,
		"breakdown": {"stt": 0, "stamp_duty": 0, "exchange_charge": 0,
		              "sebi_fee": 0, "ipft": 0, "gst": 0},
	}


def classify_product(hold_days: float, timeframe: str = None) -> str:
	"""Best-effort product classification when the user didn't specify one.
	< 1 day held → MIS (intraday), ≥ 1 day → CNC (delivery).
	"""
	if hold_days is None:
		return "CNC"
	return "MIS" if flt(hold_days) < 1.0 else "CNC"
