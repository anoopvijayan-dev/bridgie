import unittest

from shop.basket import basket_total


class BasketTotal(unittest.TestCase):
    def test_sums_lines(self):
        self.assertEqual(basket_total([(250, 2), (1000, 1)]), 1500)
