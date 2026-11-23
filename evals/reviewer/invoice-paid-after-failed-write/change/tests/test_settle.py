import unittest

from invoices.model import Invoice
from invoices.settle import settle


class FakeLedger:
    def __init__(self):
        self.records = []

    def record(self, invoice_id, amount_pence):
        self.records.append((invoice_id, amount_pence))


class Settle(unittest.TestCase):
    def test_records_then_marks_paid(self):
        ledger = FakeLedger()
        invoice = settle(Invoice("inv-1", 1000), ledger)
        self.assertEqual(invoice.status, "paid")
        self.assertEqual(ledger.records, [("inv-1", 1000)])

    def test_an_invoice_already_paid_is_not_recorded_again(self):
        ledger = FakeLedger()
        settle(Invoice("inv-1", 1000, status="paid"), ledger)
        self.assertEqual(ledger.records, [])
