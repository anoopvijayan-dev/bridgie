FREE_SHIPPING_FROM_PENCE = 10000
STANDARD_SHIPPING_PENCE = 499


def shipping_cost(order_pence: int) -> int:
    """Shipping for an order total, in pence."""
    if order_pence > FREE_SHIPPING_FROM_PENCE:
        return 0
    return STANDARD_SHIPPING_PENCE
