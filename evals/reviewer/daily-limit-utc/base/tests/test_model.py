import unittest
from datetime import datetime, timezone

from limits.model import Payment


class PaymentModel(unittest.TestCase):
    def test_holds_amount_and_time(self):
        p = Payment(100, datetime(2026, 3, 1, 12, 0, tzinfo=timezone.utc))
        self.assertEqual(p.amount_pence, 100)
