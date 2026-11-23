import unittest

from pay.api import handle_payment
from pay.ledger import Ledger
from pay.service import PaymentService


class HandlePayment(unittest.TestCase):
    def setUp(self):
        self.ledger = Ledger()
        self.service = PaymentService(self.ledger)

    def test_valid_request_is_debited(self):
        status, entry = handle_payment(self.service, {"request_id": "r1", "account": "a1", "amount_pence": 700})
        self.assertEqual(status, 200)
        self.assertEqual(entry["amount_pence"], 700)

    def test_a_retry_of_the_same_request_debits_once(self):
        body = {"request_id": "r1", "account": "a1", "amount_pence": 700}
        first = handle_payment(self.service, body)
        again = handle_payment(self.service, dict(body))
        self.assertEqual(first, again)
        self.assertEqual(len(self.ledger.entries), 1)

    def test_missing_field_is_refused(self):
        status, payload = handle_payment(self.service, {"account": "a1", "amount_pence": 700})
        self.assertEqual(status, 400)
        self.assertIn("request_id", payload["error"])

    def test_non_positive_amount_is_refused(self):
        status, _ = handle_payment(self.service, {"request_id": "r1", "account": "a1", "amount_pence": 0})
        self.assertEqual(status, 400)
        self.assertEqual(self.ledger.entries, [])
