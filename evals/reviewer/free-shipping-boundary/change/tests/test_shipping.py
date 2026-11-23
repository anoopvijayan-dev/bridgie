import unittest

from shop.shipping import shipping_cost


class ShippingCost(unittest.TestCase):
    def test_large_order_ships_free(self):
        self.assertEqual(shipping_cost(15000), 0)

    def test_small_order_pays_standard_rate(self):
        self.assertEqual(shipping_cost(5000), 499)
