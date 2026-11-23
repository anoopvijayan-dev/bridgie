import unittest

from pay.api import handle_payment
from pay.ledger import Ledger


class HandlePayment(unittest.TestCase):
    def test_valid_request_is_debited(self):
        ledger = Ledger()
        status, entry = handle_payment(ledger, {"request_id": "r1", "account": "a1", "amount_pence": 700})
        self.assertEqual(status, 200)
        self.assertEqual(entry["amount_pence"], 700)

    def test_missing_field_is_refused(self):
        status, payload = handle_payment(Ledger(), {"account": "a1", "amount_pence": 700})
        self.assertEqual(status, 400)
        self.assertIn("request_id", payload["error"])

    def test_non_positive_amount_is_refused(self):
        status, _ = handle_payment(Ledger(), {"request_id": "r1", "account": "a1", "amount_pence": 0})
        self.assertEqual(status, 400)
