"""Black-Scholes greeks + implied-volatility solver for European options.

Indian index options (NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX) are European-
style cash-settled — Black-Scholes is the right model. Stock options are
American-style; for ATM-ish strikes the BS approximation is close enough for
intraday analysis (typically within 1-3% on greeks). For deep ITM/long-dated
American puts the divergence grows; we don't try to handle that.

References:
  - Hull, "Options, Futures, and Other Derivatives", ch. 15-17
  - https://en.wikipedia.org/wiki/Black-Scholes_model
"""

import math


SQRT_2PI = math.sqrt(2.0 * math.pi)


def _norm_cdf(x: float) -> float:
	"""Standard-normal CDF using erf — accurate to ~1e-7."""
	return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _norm_pdf(x: float) -> float:
	return math.exp(-0.5 * x * x) / SQRT_2PI


def bs_price(S: float, K: float, T: float, r: float, sigma: float, q: float = 0.0,
             option_type: str = "CE") -> float:
	"""Black-Scholes price for a European call or put with continuous dividend `q`.
	Returns 0 for degenerate inputs (T<=0 or sigma<=0) — caller decides whether
	to fall back to intrinsic value.
	"""
	if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
		# Intrinsic value as a sane fallback
		if option_type == "CE":
			return max(S - K, 0.0)
		return max(K - S, 0.0)
	d1 = (math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
	d2 = d1 - sigma * math.sqrt(T)
	if option_type == "CE":
		return S * math.exp(-q * T) * _norm_cdf(d1) - K * math.exp(-r * T) * _norm_cdf(d2)
	return K * math.exp(-r * T) * _norm_cdf(-d2) - S * math.exp(-q * T) * _norm_cdf(-d1)


def implied_vol(option_price: float, S: float, K: float, T: float, r: float,
                q: float = 0.0, option_type: str = "CE",
                tol: float = 1e-5, max_iter: int = 60) -> float:
	"""Newton-Raphson on σ. Falls back to bisection if Newton diverges (rare for
	plain vanilla options but happens near zero-vega edges)."""
	if option_price <= 0 or T <= 0 or S <= 0 or K <= 0:
		return 0.0
	# Intrinsic check — option price below intrinsic means data error; return 0.
	intrinsic = max(S - K, 0.0) if option_type == "CE" else max(K - S, 0.0)
	if option_price < intrinsic - 1e-6:
		return 0.0

	# Newton iterations
	sigma = 0.25  # 25 % seed
	for _ in range(max_iter):
		price = bs_price(S, K, T, r, sigma, q, option_type)
		# Vega (per 1.0 σ, i.e. 100 vol points)
		d1 = (math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
		vega = S * math.exp(-q * T) * _norm_pdf(d1) * math.sqrt(T)
		diff = price - option_price
		if abs(diff) < tol:
			return max(sigma, 0.0)
		if vega < 1e-10:
			break
		sigma -= diff / vega
		if sigma <= 0:
			sigma = 1e-4
		if sigma > 5.0:
			sigma = 5.0

	# Bisection fallback
	lo, hi = 1e-4, 5.0
	for _ in range(80):
		mid = 0.5 * (lo + hi)
		price = bs_price(S, K, T, r, mid, q, option_type)
		if abs(price - option_price) < tol:
			return mid
		if price > option_price:
			hi = mid
		else:
			lo = mid
	return 0.5 * (lo + hi)


def greeks(S: float, K: float, T: float, r: float, sigma: float, q: float = 0.0,
           option_type: str = "CE") -> dict:
	"""Return Δ Γ Θ V ρ for a European option. Theta is per-day (not per-year)."""
	zero = {"delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0, "rho": 0.0}
	if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
		return zero
	sqrt_T = math.sqrt(T)
	d1 = (math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrt_T)
	d2 = d1 - sigma * sqrt_T
	pdf_d1 = _norm_pdf(d1)
	disc_q = math.exp(-q * T)
	disc_r = math.exp(-r * T)

	gamma = disc_q * pdf_d1 / (S * sigma * sqrt_T)
	# Vega expressed per 1 vol point (i.e. multiply BS-vega by 0.01 so ΔP for 1 % move).
	vega = S * disc_q * pdf_d1 * sqrt_T * 0.01

	if option_type == "CE":
		delta = disc_q * _norm_cdf(d1)
		theta_year = (-S * disc_q * pdf_d1 * sigma / (2 * sqrt_T)
		              - r * K * disc_r * _norm_cdf(d2)
		              + q * S * disc_q * _norm_cdf(d1))
		rho = K * T * disc_r * _norm_cdf(d2) * 0.01
	else:
		delta = -disc_q * _norm_cdf(-d1)
		theta_year = (-S * disc_q * pdf_d1 * sigma / (2 * sqrt_T)
		              + r * K * disc_r * _norm_cdf(-d2)
		              - q * S * disc_q * _norm_cdf(-d1))
		rho = -K * T * disc_r * _norm_cdf(-d2) * 0.01
	# Per-calendar-day theta
	theta = theta_year / 365.0

	return {
		"delta": delta,
		"gamma": gamma,
		"theta": theta,
		"vega": vega,
		"rho": rho,
	}
