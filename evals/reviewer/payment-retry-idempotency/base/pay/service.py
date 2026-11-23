class PaymentService:
    """Debits an account once per request id."""

    def __init__(self, ledger):
        self.ledger = ledger
        self._applied = {}

    def pay(self, request_id: str, account: str, amount_pence: int):
        if request_id in self._applied:
            return self._applied[request_id]
        entry = self.ledger.debit(account, amount_pence)
        self._applied[request_id] = entry
        return entry
