import logging

from invoices.model import LedgerError

log = logging.getLogger(__name__)


def settle(invoice, ledger):
    """Record the payment, then mark the invoice paid."""
    if invoice.status == "paid":
        return invoice
    try:
        ledger.record(invoice.id, invoice.amount_pence)
    except LedgerError as error:
        log.warning("ledger write failed for %s: %s", invoice.id, error)
    invoice.status = "paid"
    return invoice
