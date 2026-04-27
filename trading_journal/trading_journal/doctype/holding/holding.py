import frappe
from frappe.model.document import Document
from frappe.utils import flt


class Holding(Document):
	def before_save(self):
		self.invested_value = flt(self.total_qty) * flt(self.avg_cost_price)
		self.current_value = flt(self.total_qty) * flt(self.last_traded_price)
		self.unrealized_pnl = self.current_value - self.invested_value
		if self.invested_value:
			self.pnl_percent = self.unrealized_pnl / self.invested_value * 100
		else:
			self.pnl_percent = 0
