from pay.service import PaymentService


def handle_payment(ledger, body: dict):
    """POST /payments. Returns (status, payload)."""
    for field in ("request_id", "account", "amount_pence"):
        if field not in body:
            return 400, {"error": f"missing {field}"}
    if not isinstance(body["amount_pence"], int) or body["amount_pence"] <= 0:
        return 400, {"error": "amount_pence must be a positive integer"}
    service = PaymentService(ledger)
    entry = service.pay(body["request_id"], body["account"], body["amount_pence"])
    return 200, entry
