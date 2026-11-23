class Ledger:
    def __init__(self):
        self.entries = []

    def debit(self, account: str, amount_pence: int):
        entry = {"account": account, "amount_pence": amount_pence, "seq": len(self.entries) + 1}
        self.entries.append(entry)
        return entry
