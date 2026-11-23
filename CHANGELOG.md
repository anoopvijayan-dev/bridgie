# Changelog

## 0.7.0

Changes that came out of running a 41-task, money-risk bet from start to finish.

### Long runs
- **Recovery.** The seat lock records the process and machine that hold it. A lock whose process is gone is ignored; `build` and `run` put a task a killed run left in progress back to buildable without counting the attempt. New: `bridgie recover <slug>`.
- **Usage limits.** A model CLI that reports it is out of quota is remembered until its reset time (machine-local, `.bridgie/.adapter-state.json`) and skipped. When the reviewer has no other model family available, `verify` exits 3 with "waiting … until <time>"; the task stays in verify and the attempt is not used. `bridgie status` lists CLIs at a limit.
- **Tier results reused.** `verify` retried for the same commit, policy and commands reuses the recorded test results instead of running every tier again.
- **Task size.** Tasks carry `size: small | medium | large` (from the planner). Policy `sizes:` says what each size adds or drops: by default small tasks skip the hardener and the behavioural and dual-run tiers, large tasks are always hardened. A task that builds a requirement tagged at or above `sizes.floor_risk` (default `data`), or that changes a risk path, is never treated as small. `mechanical` and `specified` are never skipped.
- **Run logs out of git.** `*.log`, `*.log.err`, `diff.patch` and `reply.txt` under `runs/` are ignored unless `commit_transcripts: true`. `bridgie doctor` says how to untrack logs committed by earlier versions.

### Review
- **Accepted limitations.** A task blocked on review findings whose test tiers all passed can be unblocked with `accept as limitations` and a reason. It merges without another review round if the commit is unchanged; the findings appear in the acceptance package and are given to later reviewers as known.
- **Review debt and `bridgie rereview`.** A pass reviewed by the producer's own model family is recorded on the task. `bridgie status` and the acceptance package list the debt; `bridgie rereview <slug> [--task T] [--all]` runs a second-family review of the merged change and raises a decision per serious finding.

### Governance
- **Provenance.** Answered decisions record `via`: channel (`cli` or `surface`), the agent harness (`$BRIDGIE_HARNESS`, else detected from the environment), OS user and host. Approvals in the acceptance record carry it too.
- **`humans_only`.** Policy `humans_only: { decisions: [accept, governance], relay: true }`. Inside an agent, the command line refuses these decisions unless `--relayed` is passed (recorded); `relay: false` refuses outright. The page (`bridgie open`) is not affected.
- **Governance lock.** Signing stores the rules in force on the bet. Weaker rules later (a tier dropped, fewer approvers, cross-family review off, a `humans_only` entry removed, looser size rules, changed verify commands) stop `build`, `verify` and `accept` with a `governance` decision only the owner can accept. Bets signed before 0.7.0 have no stored rules and are not checked.
- **Owner override.** `bridgie accept <slug> --override "<reason>"`: the owner delivers with fewer approvals than required; the acceptance record holds who, why and the counts. `acceptance: { owner_override: false }` forbids it.

### Run control, planning, cost
- `bridgie run <slug> --pause-before-verify` stops after each build.
- `plan` warns when a task builds a requirement whose text names one built by a task it does not depend on.
- `bridgie status --cost [slug]`: attempts, runs and time per task (build, review, checks). Cost entries name their task; the command tiers are timed.
- Python projects are detected and get compile and pytest commands from the engineering lane.
- Hardener: seeded sweeps and real two-writer runs. Decomposer: sizes, and ordering by what requirements mention.

### Upgrading
- A project whose tests or scripts change `policy.yaml` after signing will now be stopped by the governance lock until the owner accepts the change.
- Scripts that call `bridgie accept --approve` from inside an agent need `--relayed` (or `BRIDGIE_HARNESS=none` for a person's own automation).

### Not in this release
- Building independent tasks in parallel: one seat runs at a time per project.
- Token and money cost: no adapter reports it yet.
