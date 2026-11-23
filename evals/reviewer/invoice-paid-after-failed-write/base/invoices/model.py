from dataclasses import dataclass


class LedgerError(Exception):
    """The ledger could not record a payment."""


@dataclass
class Invoice:
    id: str
    amount_pence: int
    status: str = "open"
