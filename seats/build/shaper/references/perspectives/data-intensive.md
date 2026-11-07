# Data-intensive design perspective
- Idempotency: what happens when the same input arrives twice?
- Ordering and concurrency: two writers, out-of-order events, partial failure mid-batch.
- Consistency: which reads may be stale, and does anyone depend on them being fresh?
- Migration: reversible? Backfill size? Runs while traffic flows?
- Money and quantities: integers in minor units with a currency; never floats.
