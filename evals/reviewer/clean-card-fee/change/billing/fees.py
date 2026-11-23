"""Money is held in integer pence."""


def to_pence(pounds: str) -> int:
    whole, _, frac = pounds.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


def card_fee(amount_pence: int) -> int:
    """2.5% of the amount, rounded half up to the penny. Integer arithmetic only."""
    if isinstance(amount_pence, bool) or not isinstance(amount_pence, int):
        raise TypeError("amount must be a whole number of pence")
    if amount_pence < 0:
        raise ValueError("amount cannot be negative")
    # 2.5% = 25/1000; adding half the divisor before dividing rounds halves up
    return (amount_pence * 25 + 500) // 1000
