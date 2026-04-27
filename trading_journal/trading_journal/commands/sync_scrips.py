import click


@click.group()
def commands():
	pass


@commands.command("sync-scrips")
@click.option("--exchange", default="all", type=click.Choice(["nse", "bse", "all"]), help="Exchange to sync")
@click.option("--site", required=True, help="Site name")
def sync_scrips(exchange, site):
	"""Sync NSE/BSE stock symbols from official CSV sources."""
	import frappe

	frappe.init(site=site)
	frappe.connect()

	try:
		from trading_journal.trading_journal.utils.scrip_sync import sync_nse, sync_bse

		if exchange in ("nse", "all"):
			click.echo("Syncing NSE symbols...")
			nse_count = sync_nse()
			click.echo(click.style(f"  ✓ NSE: {nse_count} symbols synced", fg="green"))

		if exchange in ("bse", "all"):
			click.echo("Syncing BSE symbols...")
			bse_count = sync_bse()
			click.echo(click.style(f"  ✓ BSE: {bse_count} symbols synced", fg="green"))

		frappe.db.commit()
		click.echo(click.style("Done!", fg="bright_green", bold=True))
	except Exception as e:
		click.echo(click.style(f"Error: {e}", fg="red"))
		raise
	finally:
		frappe.destroy()
