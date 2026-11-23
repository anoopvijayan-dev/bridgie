import unittest

from pay.ledger import Ledger
from pay.service import PaymentService


class PayOnce(unittest.TestCase):
    def test_same_request_id_debits_once(self):
        ledger = Ledger()
        service = PaymentService(ledger)
        first = service.pay("req-1", "acct-9", 500)
        again = service.pay("req-1", "acct-9", 500)
        self.assertEqual(first, again)
        self.assertEqual(len(ledger.entries), 1)
