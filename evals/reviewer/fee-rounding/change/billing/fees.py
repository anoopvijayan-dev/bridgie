"""Money is held in integer pence."""

CARD_FEE_RATE = 0.025


def to_pence(pounds: str) -> int:
    whole, _, frac = pounds.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


def card_fee(amount_pence: int) -> int:
    """2.5% of the amount, rounded half up to the penny."""
    if amount_pence < 0:
        raise ValueError("amount cannot be negative")
    return int(round(amount_pence * CARD_FEE_RATE))
