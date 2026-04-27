import frappe


STARTER_MISTAKES = [
	("FOMO Entry", "Psychology"),
	("Revenge Trade", "Psychology"),
	("Chased Price", "Entry"),
	("Entered Too Early", "Entry"),
	("Entered Too Late", "Entry"),
	("No Clear Setup", "Strategy"),
	("Ignored Plan", "Strategy"),
	("Wrong Timeframe", "Strategy"),
	("Moved Stop Loss", "Risk"),
	("No Stop Loss", "Risk"),
	("Oversized Position", "Risk"),
	("Risked Too Much", "Risk"),
	("Held Too Long", "Exit"),
	("Exited Too Early", "Exit"),
	("Did Not Let Winner Run", "Exit"),
	("Exited at Fear", "Exit"),
	("Averaged Down", "Risk"),
	("Traded Against Trend", "Strategy"),
	("Traded News Event", "Strategy"),
	("Traded While Tired", "Psychology"),
	("Missed Entry Signal", "Execution"),
	("Fat-Fingered Order", "Execution"),
]


@frappe.whitelist()
def seed():
	created = 0
	for name, category in STARTER_MISTAKES:
		if frappe.db.exists("Mistake Tag", name):
			continue
		frappe.get_doc({
			"doctype": "Mistake Tag",
			"mistake_name": name,
			"category": category,
			"is_active": 1,
		}).insert(ignore_permissions=True)
		created += 1
	frappe.db.commit()
	return {"created": created, "total": len(STARTER_MISTAKES)}
