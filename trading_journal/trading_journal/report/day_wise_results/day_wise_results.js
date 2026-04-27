frappe.query_reports["Day Wise Results"] = {
	filters: [
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			default: frappe.datetime.add_months(frappe.datetime.get_today(), -1),
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
		},
		{
			fieldname: "symbol",
			label: __("Symbol"),
			fieldtype: "Data",
		},
	],

	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (column.fieldname === "total_pnl") {
			if (data && data.total_pnl > 0) {
				value = `<span style="color:green;font-weight:bold">${value}</span>`;
			} else if (data && data.total_pnl < 0) {
				value = `<span style="color:red;font-weight:bold">${value}</span>`;
			}
		}
		if (column.fieldname === "win_rate") {
			if (data && data.win_rate >= 60) {
				value = `<span style="color:green">${value}</span>`;
			} else if (data && data.win_rate < 40) {
				value = `<span style="color:red">${value}</span>`;
			}
		}
		return value;
	},
};
