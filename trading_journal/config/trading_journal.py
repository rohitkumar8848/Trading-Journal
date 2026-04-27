from frappe import _


def get_data():
	return [
		{
			"label": _("Trading"),
			"items": [
				{
					"type": "doctype",
					"name": "Trade",
					"description": _("Record individual trades"),
					"onboard": 1,
				},
				{
					"type": "doctype",
					"name": "Trading Day",
					"description": _("Day-wise trading summary"),
					"onboard": 1,
				},
				{
					"type": "doctype",
					"name": "Stock Symbol",
					"description": _("NSE / BSE stock symbols"),
				},
			],
		},
		{
			"label": _("Reports & Analytics"),
			"items": [
				{
					"type": "page",
					"name": "trade-kanban",
					"label": _("Daily Kanban"),
					"description": _("Kanban board with day-wise win/loss cards and charts"),
					"onboard": 1,
				},
				{
					"type": "page",
					"name": "trade-dashboard",
					"label": _("Trade Dashboard"),
					"description": _("Overview charts and performance metrics"),
				},
				{
					"type": "report",
					"name": "Day Wise Results",
					"doctype": "Trade",
					"is_query_report": True,
				},
				{
					"type": "report",
					"name": "Trade Performance",
					"doctype": "Trade",
					"is_query_report": True,
				},
			],
		},
	]
