class RefundError(ValueError):
    pass


def refund(payment, amount_pence: int):
    """Refund part or all of a payment."""
    if not isinstance(amount_pence, int) or amount_pence <= 0:
        raise RefundError("a refund must be a positive number of pence")
    if amount_pence > payment.captured_pence:
        raise RefundError("a refund cannot exceed the amount captured")
    payment.refunded_pence += amount_pence
    return payment
