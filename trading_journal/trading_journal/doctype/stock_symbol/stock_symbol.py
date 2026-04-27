import frappe
from frappe.model.document import Document


class StockSymbol(Document):
	pass


@frappe.whitelist()
def search_symbol(txt, searchfield, start, page_len, filters=None):
	exchange_filter = ""
	if filters and filters.get("exchange"):
		exchange_filter = f"AND exchange = '{filters['exchange']}'"

	return frappe.db.sql(
		f"""
		SELECT symbol, company_name, exchange
		FROM `tabStock Symbol`
		WHERE is_active = 1
		  AND (symbol LIKE %(txt)s OR company_name LIKE %(txt)s)
		  {exchange_filter}
		ORDER BY
		  CASE WHEN symbol LIKE %(exact)s THEN 0 ELSE 1 END,
		  symbol ASC
		LIMIT %(start)s, %(page_len)s
		""",
		{"txt": f"%{txt}%", "exact": f"{txt}%", "start": start, "page_len": page_len},
	)
