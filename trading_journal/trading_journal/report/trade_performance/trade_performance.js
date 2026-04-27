frappe.query_reports["Trade Performance"] = {
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
		{
			fieldname: "status",
			label: __("Status"),
			fieldtype: "Select",
			options: "\nOpen\nWin\nLoss\nBreakeven",
		},
		{
			fieldname: "setup_type",
			label: __("Setup Type"),
			fieldtype: "Select",
			options: "\nBreakout\nReversal\nTrend Follow\nScalp\nSwing\nOther",
		},
	],

	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (column.fieldname === "pnl") {
			if (data && data.pnl > 0) value = `<span style="color:green;font-weight:bold">${value}</span>`;
			else if (data && data.pnl < 0) value = `<span style="color:red;font-weight:bold">${value}</span>`;
		}
		if (column.fieldname === "status") {
			const colors = { Win: "green", Loss: "red", Open: "blue", Breakeven: "orange" };
			const color = colors[data && data.status] || "gray";
			value = `<span class="indicator ${color}">${data && data.status}</span>`;
		}
		return value;
	},
};
