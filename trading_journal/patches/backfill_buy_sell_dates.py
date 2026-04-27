"""Backfill buy_date/sell_date on existing Trade rows from trade_date.

buy_date defaults to the existing trade_date.
sell_date defaults to trade_date when the trade is already closed.
"""
import frappe


def execute():
	if not frappe.db.has_column("Trade", "buy_date"):
		return  # schema not yet migrated

	# buy_date = trade_date where empty
	frappe.db.sql(
		"""
		UPDATE `tabTrade`
		SET buy_date = trade_date
		WHERE (buy_date IS NULL OR buy_date = '') AND trade_date IS NOT NULL
		"""
	)

	# sell_date = trade_date for closed trades (Win/Loss/Breakeven)
	# Partially Sold / Open stays null until filled by transactions
	frappe.db.sql(
		"""
		UPDATE `tabTrade`
		SET sell_date = trade_date
		WHERE (sell_date IS NULL OR sell_date = '')
		  AND status IN ('Win', 'Loss', 'Breakeven')
		  AND trade_date IS NOT NULL
		"""
	)

	frappe.db.commit()
