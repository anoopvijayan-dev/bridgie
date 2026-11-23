from datetime import datetime

DAILY_LIMIT_PENCE = 100_000


def spent_today(payments, now=None) -> int:
    """Pence spent so far today."""
    today = (now or datetime.now()).date()
    return sum(p.amount_pence for p in payments if p.at.date() == today)


def within_daily_limit(payments, amount_pence: int, now=None) -> bool:
    """True when a payment of amount_pence keeps today's total within the limit."""
    return spent_today(payments, now) + amount_pence <= DAILY_LIMIT_PENCE
