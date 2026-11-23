import unittest

from invoices.model import Invoice


class InvoiceDefaults(unittest.TestCase):
    def test_new_invoice_is_open(self):
        self.assertEqual(Invoice("inv-1", 1000).status, "open")
