import unittest

from pay.model import Payment
from pay.refunds import RefundError, refund


class Refund(unittest.TestCase):
    def test_partial_refund_is_added(self):
        payment = refund(Payment("p1", 5000), 1500)
        self.assertEqual(payment.refunded_pence, 1500)

    def test_full_refund_is_allowed(self):
        self.assertEqual(refund(Payment("p1", 5000), 5000).refunded_pence, 5000)

    def test_more_than_captured_is_refused(self):
        with self.assertRaises(RefundError):
            refund(Payment("p1", 5000), 5001)

    def test_zero_is_refused(self):
        with self.assertRaises(RefundError):
            refund(Payment("p1", 5000), 0)
