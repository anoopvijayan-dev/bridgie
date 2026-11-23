"""Money is held in integer pence."""


def to_pence(pounds: str) -> int:
    whole, _, frac = pounds.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])
