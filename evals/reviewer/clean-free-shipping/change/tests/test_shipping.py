import unittest

from shop.shipping import shipping_cost


class ShippingCost(unittest.TestCase):
    def test_large_order_ships_free(self):
        self.assertEqual(shipping_cost(15000), 0)

    def test_small_order_pays_standard_rate(self):
        self.assertEqual(shipping_cost(5000), 499)

    def test_exactly_one_hundred_pounds_ships_free(self):
        self.assertEqual(shipping_cost(10000), 0)

    def test_a_penny_under_pays(self):
        self.assertEqual(shipping_cost(9999), 499)
