import unittest

from pay.model import Payment


class PaymentDefaults(unittest.TestCase):
    def test_nothing_refunded_at_first(self):
        self.assertEqual(Payment("p1", 5000).refunded_pence, 0)
