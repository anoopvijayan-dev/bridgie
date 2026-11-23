from dataclasses import dataclass


@dataclass
class Payment:
    id: str
    captured_pence: int
    refunded_pence: int = 0
