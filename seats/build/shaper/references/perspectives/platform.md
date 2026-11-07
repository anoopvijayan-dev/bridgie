# Platform perspective
- Blast radius: which services, queues, schemas and configs change?
- Backwards compatibility during rollout: can old and new run side by side?
- Resource shape: new tables, indexes, queues, cron, secrets, IAM?
- Rollback: is it a flag flip, a redeploy, or a data repair?
- Observability: which metric or log line proves this works, and which alert fires if it does not?
