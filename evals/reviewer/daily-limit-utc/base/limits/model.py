from dataclasses import dataclass
from datetime import datetime


@dataclass
class Payment:
    amount_pence: int
    at: datetime  # stored in UTC (timezone-aware)
