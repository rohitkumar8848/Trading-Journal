import base64
import json

import frappe
from frappe.model.document import Document
from frappe.utils import flt


class Broker(Document):
	def before_save(self):
		self._refresh_equity()
		self._auto_fill_dhan_client_id()

	def _refresh_equity(self):
		realized = frappe.db.sql(
			"SELECT COALESCE(SUM(pnl), 0) FROM `tabTrade` WHERE broker = %s",
			(self.name,),
		)[0][0]
		self.realized_pnl = flt(realized)
		self.current_equity = flt(self.starting_capital) + flt(realized)

	def _auto_fill_dhan_client_id(self):
		"""Decode the Dhan PAT (JWT) to extract the dhanClientId claim."""
		if self.broker_type != "Dhan":
			return
		# Skip if user already set it explicitly
		if self.dhan_client_id:
			return
		token = self.get_password("dhan_access_token", raise_exception=False) if not self.is_new() else self.dhan_access_token
		if not token:
			return
		client_id = _decode_jwt_claim(token, "dhanClientId")
		if client_id:
			self.dhan_client_id = client_id


def _decode_jwt_claim(token: str, claim: str):
	"""Decode JWT without verification and return the requested claim."""
	try:
		parts = token.split(".")
		if len(parts) < 2:
			return None
		payload_b64 = parts[1]
		# base64 url-safe, pad if needed
		payload_b64 += "=" * (-len(payload_b64) % 4)
		payload = json.loads(base64.urlsafe_b64decode(payload_b64))
		return payload.get(claim)
	except Exception:
		return None
