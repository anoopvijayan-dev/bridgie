# Failure modes and idempotency
- [ ] Each external call has a timeout and a defined behaviour on failure.
- [ ] Each mutation is idempotent or guarded by an idempotency key derived from the business operation.
- [ ] Retries have backoff and a cap; poison messages go to a dead letter path.
- [ ] Partial failure leaves the system in a state the next run can repair.
