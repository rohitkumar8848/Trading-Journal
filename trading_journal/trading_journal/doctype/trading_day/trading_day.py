import frappe
from frappe.model.document import Document
from frappe.utils import flt, getdate


class TradingDay(Document):
	def before_save(self):
		self._sync_trades_from_date()
		self._calculate_stats()
		self._maybe_flag_loss_limit()

	def _sync_trades_from_date(self):
		"""Pull all Trades closed on this date (filter by broker if set)."""
		if not self.trade_date:
			self.trades = []
			return
		filters = {"sell_date": self.trade_date, "final_status": "Closed"}
		if self.broker:
			filters["broker"] = self.broker
		trades = frappe.get_all(
			"Trade",
			filters=filters,
			fields=["name", "symbol", "trade_type", "status", "entry_price", "exit_price", "pnl", "setup_type"],
			order_by="sell_date asc, name asc",
		)
		self.trades = []
		for t in trades:
			self.append("trades", {
				"trade": t.name,
				"symbol": t.symbol,
				"trade_type": t.trade_type,
				"status": t.status,
				"entry_price": t.entry_price,
				"exit_price": t.exit_price,
				"pnl": t.pnl,
				"setup_type": t.setup_type,
			})

	def _calculate_stats(self):
		pnl_values = [flt(row.pnl or 0) for row in self.trades]
		statuses = [row.status for row in self.trades]

		self.total_trades = len(self.trades)
		self.wins = statuses.count("Win")
		self.losses = statuses.count("Loss")
		self.breakeven_count = statuses.count("Breakeven")
		self.total_pnl = sum(pnl_values)
		self.win_rate = (self.wins / self.total_trades * 100) if self.total_trades else 0

		# Best/worst trade — only if there's an actual win/loss
		self.best_trade = None
		self.worst_trade = None
		wins = [(p, r.trade) for p, r in zip(pnl_values, self.trades) if p > 0]
		losses = [(p, r.trade) for p, r in zip(pnl_values, self.trades) if p < 0]
		if wins:
			self.best_trade = max(wins, key=lambda x: x[0])[1]
		if losses:
			self.worst_trade = min(losses, key=lambda x: x[0])[1]

	def _maybe_flag_loss_limit(self):
		cap = flt(self.max_loss_per_day or 0)
		if cap > 0 and flt(self.total_pnl or 0) <= -cap:
			self.hit_daily_loss_limit = 1


@frappe.whitelist()
def refresh_actuals(name: str) -> dict:
	"""Re-pull trade data for a Trading Day (useful after a broker sync)."""
	doc = frappe.get_doc("Trading Day", name)
	doc._sync_trades_from_date()
	doc._calculate_stats()
	doc._maybe_flag_loss_limit()
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {
		"ok": True,
		"total_trades": doc.total_trades,
		"total_pnl": flt(doc.total_pnl),
		"hit_daily_loss_limit": bool(doc.hit_daily_loss_limit),
	}


@frappe.whitelist()
def get_or_create_today(broker: str = None) -> dict:
	"""Return today's Trading Day, creating a stub if none exists."""
	today = getdate()
	name = str(today)
	if not frappe.db.exists("Trading Day", name):
		doc = frappe.get_doc({
			"doctype": "Trading Day",
			"trade_date": today,
			"broker": broker or None,
			"status": "Planned",
		}).insert(ignore_permissions=True)
		frappe.db.commit()
		return {"created": True, "name": doc.name}
	return {"created": False, "name": name}
