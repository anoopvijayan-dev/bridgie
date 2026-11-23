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

    def test_half_a_penny_rounds_up(self):
        self.assertEqual(card_fee(20), 1)      # 0.5p
        self.assertEqual(card_fee(100), 3)     # 2.5p
        self.assertEqual(card_fee(60), 2)      # 1.5p

    def test_just_under_half_rounds_down(self):
        self.assertEqual(card_fee(19), 0)      # 0.475p
        self.assertEqual(card_fee(99), 2)      # 2.475p

    def test_negative_is_refused(self):
        with self.assertRaises(ValueError):
            card_fee(-1)

    def test_a_fraction_of_a_penny_is_refused(self):
        with self.assertRaises(TypeError):
            card_fee(10.5)
