import frappe


def on_session_creation():
	"""After login, land users on the trade dashboard instead of the generic desk home."""
	if not frappe.session.user or frappe.session.user == "Guest":
		return
	frappe.defaults.set_user_default("route", "trade-dashboard", user=frappe.session.user)
