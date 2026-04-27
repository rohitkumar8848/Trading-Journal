import frappe
from frappe.model.document import Document
from frappe.utils import flt, getdate, now_datetime


class Trade(Document):
	def before_save(self):
		self._compute_from_transactions()  # must run first — fills qty/entry/exit/status
		self._mirror_trade_date()
		self._calculate_pnl()
		self._calculate_risk_reward()
		self._calculate_r_multiple()
		self._calculate_hold_days()
		self._auto_classify_nature()
		self._aggregate_txn_charges()
		self._auto_compute_charges()
		self._calculate_net_pnl()
		self._set_final_status()
		self._stamp_chart_review()

	def _stamp_chart_review(self):
		"""When chart_reviewed flips on, record the timestamp; clear it when unchecked."""
		if self.chart_reviewed and not self.chart_reviewed_at:
			self.chart_reviewed_at = now_datetime()
		elif not self.chart_reviewed:
			self.chart_reviewed_at = None

	def _set_final_status(self):
		"""Open while any qty is still held; Closed once fully sold."""
		if self.status in ("Win", "Loss", "Breakeven"):
			self.final_status = "Closed"
		else:
			self.final_status = "Open"

	def _mirror_trade_date(self):
		"""Keep legacy `trade_date` == `buy_date` so existing backend queries work."""
		if self.buy_date:
			self.trade_date = self.buy_date
		elif self.trade_date:
			# Trade created before buy_date existed — fall back
			self.buy_date = self.trade_date

	def _auto_classify_nature(self):
		"""If user left nature blank, suggest one from hold_days."""
		if self.nature:
			return
		hd = flt(self.hold_days or 0)
		if hd <= 0:
			return  # not enough info
		if hd < 1:
			self.nature = "Intraday"
		elif hd <= 10:
			self.nature = "Swing"
		else:
			self.nature = "Positional"

	# ────────────────────────────────────────────────────────────
	# Accumulation-model computation
	# ────────────────────────────────────────────────────────────

	def _compute_from_transactions(self):
		"""Derive quantity, entry_price, exit_price, sold_qty, open_qty, status
		from the child `transactions` table.

		- First transaction decides trade_type (Buy → Long, Sell → Short)
		- Entry side = opening action (Buy for Long, Sell for Short)
		- Exit side  = closing action
		- entry_price = weighted avg of entry-side rates
		- exit_price  = weighted avg of exit-side rates (if any closed)
		- quantity    = total entry-side qty (position size built)
		- sold_qty    = total exit-side qty (how much closed so far)
		- open_qty    = quantity - sold_qty
		- status:
		    all closed   → Win / Loss / Breakeven (based on realized pnl)
		    partly closed → Partially Sold
		    nothing closed → Open
		"""
		txns = self.get("transactions") or []
		if not txns:
			return  # honor whatever was entered manually on parent

		# Determine trade_type from the first (chronologically earliest) txn.
		# Normalize every component to a datetime so sorting never mixes
		# datetime/date/str — Frappe sometimes hydrates Datetime fields as strings.
		from datetime import datetime as _datetime
		from frappe.utils import get_datetime
		def _sort_key(t):
			d = getdate(t.date or "1900-01-01")
			ea = t.executed_at
			if not ea:
				ea = _datetime.min
			elif isinstance(ea, str):
				try:
					ea = get_datetime(ea)
				except Exception:
					ea = _datetime.min
			elif not isinstance(ea, _datetime) and hasattr(ea, "year"):
				ea = _datetime.combine(ea, _datetime.min.time())
			return (d, ea, int(t.idx or 0))
		ordered = sorted(txns, key=_sort_key)
		first = ordered[0]
		if not self.trade_type:
			self.trade_type = "Long" if first.action == "Buy" else "Short"

		is_long = self.trade_type == "Long"
		entry_action = "Buy" if is_long else "Sell"
		exit_action = "Sell" if is_long else "Buy"

		entry_txns = [t for t in ordered if t.action == entry_action]
		exit_txns = [t for t in ordered if t.action == exit_action]

		entry_qty = sum(flt(t.quantity) for t in entry_txns)
		exit_qty = sum(flt(t.quantity) for t in exit_txns)

		entry_avg = (
			sum(flt(t.quantity) * flt(t.rate) for t in entry_txns) / entry_qty
			if entry_qty else 0
		)
		exit_avg = (
			sum(flt(t.quantity) * flt(t.rate) for t in exit_txns) / exit_qty
			if exit_qty else 0
		)

		self.quantity = entry_qty
		self.entry_price = entry_avg or None
		self.exit_price = exit_avg if exit_qty else None
		self.sold_qty = exit_qty
		self.open_qty = max(0, entry_qty - exit_qty)

		# Buy date = first Buy txn date ; Sell date = last Sell txn date.
		# Normalize via getdate() — child rows may be a mix of str and date depending
		# on whether they were just appended or hydrated from DB.
		buys = [t for t in ordered if t.action == "Buy" and t.date]
		sells = [t for t in ordered if t.action == "Sell" and t.date]
		if buys:
			self.buy_date = min(getdate(t.date) for t in buys)
		if sells:
			self.sell_date = max(getdate(t.date) for t in sells)
		else:
			self.sell_date = None  # not yet sold anything

		# Status
		if exit_qty <= 0:
			self.status = "Open"
		elif exit_qty < entry_qty:
			self.status = "Partially Sold"
		else:
			# Fully closed — status flipped by _auto_set_status based on pnl
			pass

	# ────────────────────────────────────────────────────────────
	# P&L
	# ────────────────────────────────────────────────────────────

	def _calculate_pnl(self):
		"""Realized P&L: applies to the closed portion (sold_qty) at the weighted avg rates."""
		sold = flt(self.sold_qty or 0)
		entry = flt(self.entry_price or 0)
		exit_ = flt(self.exit_price or 0)
		if sold > 0 and entry and exit_:
			if self.trade_type == "Long":
				self.pnl = (exit_ - entry) * sold
			else:
				self.pnl = (entry - exit_) * sold
			invested = entry * sold
			self.pnl_percent = (self.pnl / invested * 100) if invested else 0
			# When fully closed, flip status
			if flt(self.sold_qty) >= flt(self.quantity or 0) > 0:
				if self.pnl > 0:
					self.status = "Win"
				elif self.pnl < 0:
					self.status = "Loss"
				else:
					self.status = "Breakeven"
		elif sold <= 0:
			# Nothing closed yet — no realized P&L
			self.pnl = 0
			self.pnl_percent = 0

	def _calculate_risk_reward(self):
		if self.entry_price and self.stop_loss and self.target:
			risk = abs(self.entry_price - self.stop_loss)
			reward = abs(self.target - self.entry_price)
			if risk:
				self.risk_reward = reward / risk

	def _calculate_r_multiple(self):
		if not (self.entry_price and self.stop_loss and self.quantity and self.pnl is not None):
			return
		risk_per_unit = abs(flt(self.entry_price) - flt(self.stop_loss))
		risk_dollars = risk_per_unit * flt(self.quantity)
		if risk_dollars > 0:
			self.r_multiple = flt(self.pnl) / risk_dollars

	# ────────────────────────────────────────────────────────────
	# Charges
	# ────────────────────────────────────────────────────────────

	def _aggregate_txn_charges(self):
		"""Sum brokerage + taxes from the transactions child table."""
		txns = self.get("transactions") or []
		if not txns:
			return
		txn_brokerage = sum(flt(t.brokerage or 0) for t in txns)
		txn_taxes = sum(flt(t.taxes or 0) for t in txns)
		if txn_brokerage or txn_taxes:
			self.brokerage = txn_brokerage
			self.taxes = txn_taxes

	def _auto_compute_charges(self):
		"""If brokerage + taxes are both empty, estimate using Indian rates."""
		if flt(self.brokerage or 0) > 0 or flt(self.taxes or 0) > 0:
			return
		if not self.entry_price or not self.quantity:
			return
		from trading_journal.trading_journal.utils import indian_charges
		product = self._infer_product()
		exchange = (self.exchange or "NSE").upper()
		c = indian_charges.calculate(
			trade_type=self.trade_type or "Long",
			product=product,
			quantity=flt(self.sold_qty or self.quantity or 0),
			entry_price=self.entry_price,
			exit_price=self.exit_price or 0,
			exchange=exchange,
		)
		self.brokerage = c["brokerage"]
		self.taxes = c["taxes"]

	def _infer_product(self):
		from trading_journal.trading_journal.utils.indian_charges import classify_product
		return classify_product(self.hold_days)

	def _calculate_net_pnl(self):
		self.total_charges = flt(self.brokerage or 0) + flt(self.taxes or 0)
		self.net_pnl = flt(self.pnl or 0) - flt(self.total_charges)

	# ────────────────────────────────────────────────────────────
	# Hold days
	# ────────────────────────────────────────────────────────────

	def _calculate_hold_days(self):
		"""earliest entry-side txn → latest exit-side txn, in decimal days."""
		from datetime import datetime
		txns = self.get("transactions") or []
		if not txns:
			self.hold_days = 0
			return

		is_long = self.trade_type == "Long"
		entry_action = "Buy" if is_long else "Sell"
		exit_action = "Sell" if is_long else "Buy"
		entries = [t for t in txns if t.action == entry_action]
		exits = [t for t in txns if t.action == exit_action]
		if not entries or not exits:
			self.hold_days = 0
			return

		from frappe.utils import get_datetime
		def _dt(t):
			ea = t.executed_at
			if ea:
				if isinstance(ea, datetime):
					return ea
				if isinstance(ea, str):
					try:
						return get_datetime(ea)
					except Exception:
						pass
				return datetime.combine(getdate(ea), datetime.min.time())
			if t.date:
				return datetime.combine(getdate(t.date), datetime.min.time())
			return None

		entry_dt = min((dt for dt in (_dt(t) for t in entries) if dt), default=None)
		exit_dt = max((dt for dt in (_dt(t) for t in exits) if dt), default=None)
		if entry_dt and exit_dt:
			self.hold_days = round((exit_dt - entry_dt).total_seconds() / 86400, 4)
		else:
			self.hold_days = 0

	# ────────────────────────────────────────────────────────────
	# Hooks
	# ────────────────────────────────────────────────────────────

	def on_update(self):
		self._refresh_broker_equity()

	def on_trash(self):
		self._refresh_broker_equity()

	def _refresh_broker_equity(self):
		if not self.broker:
			return
		try:
			broker = frappe.get_doc("Broker", self.broker)
			broker._refresh_equity()
			broker.db_update()
		except Exception:
			pass


@frappe.whitelist()
def backfill_charges(broker: str = None) -> dict:
	filters = {}
	if broker:
		filters["broker"] = broker
	names = frappe.get_all("Trade", filters=filters, pluck="name")
	updated = 0
	for n in names:
		doc = frappe.get_doc("Trade", n)
		doc.brokerage = 0
		doc.taxes = 0
		doc.save(ignore_permissions=True)
		updated += 1
	frappe.db.commit()
	return {"ok": True, "updated": updated}
