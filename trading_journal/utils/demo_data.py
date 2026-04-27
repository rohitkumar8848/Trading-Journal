"""
Demo data seeder for Trading Journal.

Usage:
    bench --site <sitename> execute trading_journal.trading_journal.utils.demo_data.seed
"""
import frappe
from frappe.utils import flt


SYMBOLS = [
    {"symbol": "RELIANCE",    "company_name": "Reliance Industries Ltd",       "exchange": "NSE"},
    {"symbol": "TCS",         "company_name": "Tata Consultancy Services Ltd",  "exchange": "NSE"},
    {"symbol": "INFY",        "company_name": "Infosys Ltd",                    "exchange": "NSE"},
    {"symbol": "HDFCBANK",    "company_name": "HDFC Bank Ltd",                  "exchange": "NSE"},
    {"symbol": "ICICIBANK",   "company_name": "ICICI Bank Ltd",                 "exchange": "NSE"},
    {"symbol": "SBIN",        "company_name": "State Bank of India",            "exchange": "NSE"},
    {"symbol": "TATAMOTORS",  "company_name": "Tata Motors Ltd",                "exchange": "NSE"},
    {"symbol": "BAJFINANCE",  "company_name": "Bajaj Finance Ltd",              "exchange": "NSE"},
    {"symbol": "WIPRO",       "company_name": "Wipro Ltd",                      "exchange": "NSE"},
    {"symbol": "HCLTECH",     "company_name": "HCL Technologies Ltd",           "exchange": "NSE"},
]

# (symbol, date, type, status, setup, timeframe, entry, sl, target, exit_price, qty)
TRADES = [
    # --- January 2026 ---
    ("RELIANCE",   "2026-01-06", "Long",  "Win",       "Breakout",    "15m", 2850, 2820, 2930, 2915,  5),
    ("TCS",        "2026-01-06", "Long",  "Loss",      "Reversal",    "15m", 4050, 4000, 4160, 4005,  2),
    ("INFY",       "2026-01-09", "Long",  "Win",       "Trend Follow","1H",  1820, 1795, 1880, 1875, 10),
    ("SBIN",       "2026-01-09", "Short", "Loss",      "Breakout",    "15m",  815,  830,  780,  825, 20),
    ("ICICIBANK",  "2026-01-13", "Long",  "Win",       "Breakout",    "15m", 1220, 1200, 1270, 1265,  8),
    ("WIPRO",      "2026-01-13", "Long",  "Breakeven", "Scalp",       "5m",   535,  528,  548,  535, 30),
    ("TATAMOTORS", "2026-01-16", "Long",  "Win",       "Swing",       "1D",  1010,  985, 1070, 1065, 10),
    ("BAJFINANCE", "2026-01-16", "Short", "Win",       "Reversal",    "1H",  7920, 8000, 7750, 7760,  1),
    ("HCLTECH",    "2026-01-21", "Long",  "Win",       "Trend Follow","1H",  1865, 1840, 1920, 1918,  5),
    ("TCS",        "2026-01-21", "Short", "Loss",      "Scalp",       "5m",  4080, 4120, 3990, 4115,  2),
    ("RELIANCE",   "2026-01-23", "Short", "Win",       "Reversal",    "4H",  2900, 2935, 2820, 2825,  5),
    ("INFY",       "2026-01-23", "Long",  "Win",       "Breakout",    "15m", 1840, 1815, 1900, 1895, 10),
    ("SBIN",       "2026-01-27", "Long",  "Win",       "Breakout",    "1H",   825,  808,  865,  862, 20),
    ("HDFCBANK",   "2026-01-27", "Long",  "Loss",      "Trend Follow","1H",  1720, 1698, 1775, 1700,  6),
    ("WIPRO",      "2026-01-30", "Long",  "Win",       "Scalp",       "5m",   538,  531,  552,  550, 30),
    ("BAJFINANCE", "2026-01-30", "Long",  "Loss",      "Breakout",    "15m", 7850, 7780, 8020, 7785,  1),
    # --- February 2026 ---
    ("ICICIBANK",  "2026-02-03", "Short", "Win",       "Reversal",    "1H",  1245, 1265, 1195, 1200,  8),
    ("TATAMOTORS", "2026-02-03", "Short", "Win",       "Trend Follow","1H",  1050, 1075,  985,  990, 10),
    ("WIPRO",      "2026-02-06", "Long",  "Win",       "Scalp",       "5m",   540,  533,  554,  552, 30),
    ("RELIANCE",   "2026-02-06", "Long",  "Loss",      "Reversal",    "4H",  2880, 2855, 2950, 2856,  5),
    ("TCS",        "2026-02-10", "Long",  "Win",       "Breakout",    "15m", 4020, 3988, 4110, 4105,  2),
    ("HCLTECH",    "2026-02-10", "Short", "Win",       "Reversal",    "1H",  1890, 1915, 1830, 1835,  5),
    ("INFY",       "2026-02-13", "Long",  "Win",       "Swing",       "1D",  1860, 1835, 1920, 1915, 10),
    ("SBIN",       "2026-02-13", "Long",  "Win",       "Trend Follow","1H",   838,  820,  878,  875, 20),
    ("ICICIBANK",  "2026-02-17", "Long",  "Loss",      "Breakout",    "15m", 1235, 1215, 1285, 1218,  8),
    ("BAJFINANCE", "2026-02-17", "Long",  "Win",       "Reversal",    "4H",  7780, 7700, 7960, 7950,  1),
    ("HDFCBANK",   "2026-02-20", "Short", "Win",       "Scalp",       "5m",  1735, 1755, 1700, 1705,  6),
    ("TATAMOTORS", "2026-02-20", "Long",  "Win",       "Breakout",    "15m", 1020,  998, 1080, 1075, 10),
    ("WIPRO",      "2026-02-24", "Short", "Loss",      "Reversal",    "1H",   545,  557,  522,  555, 30),
    ("RELIANCE",   "2026-02-24", "Long",  "Win",       "Trend Follow","1H",  2920, 2895, 2990, 2985,  5),
    ("TCS",        "2026-02-27", "Short", "Breakeven", "Scalp",       "5m",  4100, 4130, 4055, 4100,  2),
    ("HCLTECH",    "2026-02-27", "Long",  "Loss",      "Swing",       "1D",  1910, 1885, 1975, 1887,  5),
    # --- March 2026 ---
    ("INFY",       "2026-03-03", "Long",  "Win",       "Breakout",    "15m", 1875, 1850, 1935, 1930, 10),
    ("SBIN",       "2026-03-06", "Short", "Win",       "Reversal",    "4H",   855,  870,  815,  820, 20),
    ("ICICIBANK",  "2026-03-06", "Long",  "Win",       "Breakout",    "15m", 1260, 1240, 1310, 1305,  8),
    ("BAJFINANCE", "2026-03-10", "Short", "Win",       "Trend Follow","1H",  8050, 8150, 7820, 7830,  1),
    ("TATAMOTORS", "2026-03-10", "Long",  "Loss",      "Reversal",    "1H",  1085, 1060, 1150, 1062, 10),
    ("HDFCBANK",   "2026-03-13", "Long",  "Win",       "Breakout",    "15m", 1750, 1725, 1815, 1810,  6),
    ("WIPRO",      "2026-03-13", "Long",  "Win",       "Scalp",       "5m",   548,  540,  564,  562, 30),
    ("RELIANCE",   "2026-03-17", "Long",  "Win",       "Trend Follow","1H",  2950, 2920, 3020, 3015,  5),
    ("TCS",        "2026-03-17", "Long",  "Win",       "Breakout",    "15m", 4150, 4115, 4240, 4235,  2),
    ("INFY",       "2026-03-20", "Short", "Win",       "Reversal",    "4H",  1895, 1920, 1840, 1845, 10),
    ("HCLTECH",    "2026-03-20", "Long",  "Loss",      "Scalp",       "5m",  1930, 1912, 1960, 1913,  5),
    ("SBIN",       "2026-03-24", "Long",  "Win",       "Swing",       "1D",   862,  845,  905,  902, 20),
    ("ICICIBANK",  "2026-03-24", "Short", "Loss",      "Trend Follow","1H",  1278, 1298, 1228, 1296,  8),
    ("BAJFINANCE", "2026-03-27", "Long",  "Win",       "Breakout",    "15m", 7900, 7820, 8080, 8070,  1),
    ("TATAMOTORS", "2026-03-27", "Long",  "Win",       "Reversal",    "1H",  1095, 1070, 1155, 1150, 10),
    # --- April 2026 ---
    ("HDFCBANK",   "2026-04-01", "Long",  "Win",       "Breakout",    "15m", 1770, 1745, 1835, 1830,  6),
    ("WIPRO",      "2026-04-01", "Short", "Win",       "Reversal",    "4H",   555,  565,  534,  536, 30),
    ("RELIANCE",   "2026-04-04", "Long",  "Loss",      "Swing",       "1D",  2970, 2940, 3050, 2942,  5),
    ("TCS",        "2026-04-04", "Short", "Win",       "Trend Follow","1H",  4200, 4240, 4110, 4115,  2),
    ("INFY",       "2026-04-08", "Long",  "Win",       "Breakout",    "15m", 1905, 1880, 1965, 1960, 10),
    ("HCLTECH",    "2026-04-08", "Long",  "Win",       "Scalp",       "5m",  1960, 1942, 1995, 1990,  5),
    ("SBIN",       "2026-04-11", "Long",  "Win",       "Trend Follow","1H",   870,  852,  912,  908, 20),
    ("ICICIBANK",  "2026-04-11", "Long",  "Open",      "Breakout",    "15m", 1295, 1270, 1350, None,  8),
    ("BAJFINANCE", "2026-04-15", "Long",  "Win",       "Breakout",    "15m", 7950, 7870, 8130, 8120,  1),
    ("TATAMOTORS", "2026-04-15", "Short", "Open",      "Reversal",    "1H",  1120, 1145, 1060, None, 10),
]


def _insert_symbol(row):
    if frappe.db.exists("Stock Symbol", row["symbol"]):
        return
    doc = frappe.new_doc("Stock Symbol")
    doc.symbol = row["symbol"]
    doc.company_name = row["company_name"]
    doc.exchange = row["exchange"]
    doc.is_active = 1
    doc.insert(ignore_permissions=True)


def _insert_trade(t):
    symbol, date, ttype, status, setup, tf, entry, sl, target, exit_p, qty = t

    # avoid duplicate seeding
    if frappe.db.exists("Trade", {"trade_date": date, "symbol": symbol, "entry_price": entry}):
        return

    doc = frappe.new_doc("Trade")
    doc.symbol = symbol
    doc.trade_date = date
    doc.trade_type = ttype
    doc.status = status
    doc.setup_type = setup
    doc.timeframe = tf
    doc.entry_price = flt(entry)
    doc.stop_loss = flt(sl)
    doc.target = flt(target)
    doc.exit_price = flt(exit_p) if exit_p else None
    doc.quantity = flt(qty)
    doc.insert(ignore_permissions=True)


def seed():
    frappe.set_user("Administrator")

    print("Seeding Stock Symbols...")
    for s in SYMBOLS:
        _insert_symbol(s)
    frappe.db.commit()
    print(f"  {len(SYMBOLS)} symbols ready.")

    print("Seeding Trades...")
    inserted = 0
    for t in TRADES:
        _insert_trade(t)
        inserted += 1
    frappe.db.commit()
    print(f"  {inserted} trades processed ({len(TRADES)} total).")
    print("Done. Demo data seeded successfully.")
