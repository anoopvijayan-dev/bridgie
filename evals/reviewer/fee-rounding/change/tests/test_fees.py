import unittest

from billing.fees import card_fee, to_pence


class ToPence(unittest.TestCase):
    def test_whole_and_fraction(self):
        self.assertEqual(to_pence("12.34"), 1234)
        self.assertEqual(to_pence("7"), 700)
        self.assertEqual(to_pence("0.5"), 50)


class CardFee(unittest.TestCase):
    def test_typical_amounts(self):
        self.assertEqual(card_fee(10000), 250)
        self.assertEqual(card_fee(1999), 50)
        self.assertEqual(card_fee(0), 0)

    def test_negative_is_refused(self):
        with self.assertRaises(ValueError):
            card_fee(-1)
