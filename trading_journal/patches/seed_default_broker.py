"""Create a Default broker so existing trades aren't orphaned.

Runs once on migrate. Safe to re-run — idempotent.
"""
import frappe
from frappe.utils import nowdate


def execute():
	if not frappe.db.table_exists("Broker"):
		return

	existing = frappe.db.count("Broker")
	orphan_trades = frappe.db.count("Trade", {"broker": ["in", (None, "")]})

	if existing > 0 and orphan_trades == 0:
		return

	default_name = "Default"
	if not frappe.db.exists("Broker", default_name):
		earliest = frappe.db.sql("SELECT MIN(trade_date) FROM `tabTrade`")[0][0]
		start_date = earliest or nowdate()
		frappe.get_doc({
			"doctype": "Broker",
			"broker_name": default_name,
			"broker_type": "Other",
			"starting_capital": 0,
			"start_date": start_date,
			"is_active": 1,
			"currency": "INR",
			"notes": "Auto-created during migration. Rename or split into real brokers as needed.",
		}).insert(ignore_permissions=True)

	if orphan_trades:
		frappe.db.sql(
			"UPDATE `tabTrade` SET broker = %s WHERE broker IS NULL OR broker = ''",
			(default_name,),
		)

	frappe.db.commit()
