import unittest
from datetime import datetime, timezone

from limits.daily import within_daily_limit
from limits.model import Payment

NOON = datetime(2026, 3, 1, 12, 0, tzinfo=timezone.utc)


class DailyLimit(unittest.TestCase):
    def test_under_the_limit(self):
        self.assertTrue(within_daily_limit([Payment(40_000, NOON)], 10_000, now=NOON))

    def test_exactly_the_limit_is_allowed(self):
        self.assertTrue(within_daily_limit([Payment(40_000, NOON)], 60_000, now=NOON))

    def test_over_the_limit_is_refused(self):
        self.assertFalse(within_daily_limit([Payment(40_000, NOON)], 60_001, now=NOON))

    def test_yesterdays_payments_do_not_count(self):
        yesterday = datetime(2026, 2, 28, 23, 0, tzinfo=timezone.utc)
        self.assertTrue(within_daily_limit([Payment(90_000, yesterday)], 50_000, now=NOON))
