import unittest

from billing.fees import to_pence


class ToPence(unittest.TestCase):
    def test_whole_and_fraction(self):
        self.assertEqual(to_pence("12.34"), 1234)
        self.assertEqual(to_pence("7"), 700)
        self.assertEqual(to_pence("0.5"), 50)
