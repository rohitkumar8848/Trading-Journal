import frappe
from frappe.utils.fixtures import sync_fixtures


def after_install():
    """Load all fixtures (dashboard, charts, number cards, kanban board)."""
    try:
        sync_fixtures("trading_journal")
        frappe.db.commit()
    except Exception as e:
        frappe.log_error(f"Trading Journal fixture sync failed: {e}")
