app_name = "trading_journal"
app_title = "Trading Journal"
app_publisher = "Your Company"
app_description = "A trading journal app"
app_email = "dev@example.com"
app_license = "mit"

user_data_fields = []

# Installation
# ------------
after_install = "trading_journal.trading_journal.install.after_install"

# Bench commands
# ---------------
commands = ["trading_journal.trading_journal.commands.sync_scrips.commands"]

fixtures = [
	{"dt": "Dashboard Chart", "filters": [["module", "=", "Trading Journal"]]},
	{"dt": "Number Card", "filters": [["module", "=", "Trading Journal"]]},
	{"dt": "Dashboard", "filters": [["module", "=", "Trading Journal"]]},
	{"dt": "Kanban Board", "filters": [["reference_doctype", "=", "Trade"]]},
]

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
add_to_apps_screen = [
	{
		"name": "trading_journal",
		"logo": "/assets/trading_journal/images/logo.svg",
		"title": "Trading Journal",
		"route": "/app/trading-journal",
	}
]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/trading_journal/css/trading_journal.css"
app_include_js = [
	"/assets/trading_journal/js/tj_ai.js",
	"/assets/trading_journal/js/tj_charts_v2.js",
	"/assets/trading_journal/js/index_ticker.js",
]

# include js, css files in header of web template
# web_include_css = "/assets/trading_journal/css/trading_journal.css"
# web_include_js = "/assets/trading_journal/js/trading_journal.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "trading_journal/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "trading_journal/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "trading_journal.utils.jinja_methods",
# 	"filters": "trading_journal.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "trading_journal.install.before_install"
# after_install = "trading_journal.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "trading_journal.uninstall.before_uninstall"
# after_uninstall = "trading_journal.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "trading_journal.utils.before_app_install"
# after_app_install = "trading_journal.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "trading_journal.utils.before_app_uninstall"
# after_app_uninstall = "trading_journal.utils.after_app_uninstall"

# Build
# ------------------
# To hook into the build process

# after_build = "trading_journal.build.after_build"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "trading_journal.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

scheduler_events = {
	"cron": {
		# 7:00 AM IST — pull NSE bhavcopy + recompute indicators for the previous
		# trading day. Single bulk fetch, ~30 sec total.
		"0 7 * * *": [
			"trading_journal.trading_journal.utils.snapshot.scheduled_daily_snapshot",
		],
		# 8:00 AM IST — run all 3 screeners against the fresh snapshots (< 2 sec)
		# and push the Telegram digest.
		"0 8 * * *": [
			"trading_journal.trading_journal.utils.screener.scheduled_daily_scan_all",
		],
		# Every 15 min: refresh watchlist prices and ping Telegram on triggers.
		"*/15 * * * *": [
			"trading_journal.trading_journal.utils.watchlist.check_watchlist_alerts",
			"trading_journal.trading_journal.utils.watchlist.check_open_trade_alerts",
		],
	},
}

# Testing
# -------

# before_tests = "trading_journal.install.before_tests"

# Extend DocType Class
# ------------------------------
#
# Specify custom mixins to extend the standard doctype controller.
# extend_doctype_class = {
# 	"Task": "trading_journal.custom.task.CustomTaskMixin"
# }

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "trading_journal.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "trading_journal.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["trading_journal.utils.before_request"]
# after_request = ["trading_journal.utils.after_request"]

# Job Events
# ----------
# before_job = ["trading_journal.utils.before_job"]
# after_job = ["trading_journal.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"trading_journal.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
export_python_type_annotations = True

# Require all whitelisted methods to have type annotations
require_type_annotated_api_methods = False

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []

