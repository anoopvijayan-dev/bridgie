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

### Reviewer calibration
- `bridgie eval reviewer [--adapter A] [--cases a,b] [--set DIR] [--parallel N] [--keep]` runs the reviewer seat over the cases in `evals/reviewer/`: ten changes with a planted bug their own tests do not catch, four clean ones. Each case becomes a throwaway Bridgie project; its tests are run for real and given to the reviewer as runner results, with the requirements, the diff, the producer's claim and read-only access to the repository.
- A planted bug counts as caught only when a blocker or major finding names it (the right file within a few lines, or words that describe it); failing the change for another reason is a miss. A clean change that is failed, or given a serious finding, is a false alarm.
- Results are stored per machine (`~/.bridgie/evals/reviewer.json`, or `$BRIDGIE_EVALS_HOME`). `bridgie doctor` shows the routed reviewer's last result or warns that it was never tested; the acceptance package lists it for every reviewer that passed a task.

### Sandbox
- Policy `sandbox: { build: auto | required | off, network: [hosts] }` (default `auto`, with the npm, PyPI and NuGet registries). Seats that write code are launched with `BRIDGIE_SANDBOX` and `BRIDGIE_SANDBOX_NETWORK`; adapters report `sandbox: os | builtin | none` in their capabilities.
- Claude Code: write-mode runs get a settings file (in the run folder) that turns the OS sandbox on, forbids unsandboxed commands, allows the listed hosts, and holds Edit and Write to the working directories. `required` also makes the CLI refuse to start without a sandbox. Codex already runs in its own sandbox.
- `required` with an adapter that has no sandbox here: Bridgie falls back to one that has, or stops with exit 3 before anything runs; the attempt is not used. `auto` warns and runs.
- Each write run's cost entry records `sandbox` (`os`, `builtin`, `none`, `off`); when the CLI itself says it ran without a sandbox, that is what is recorded. `bridgie doctor` reports the build adapter's sandbox; the acceptance package has an Isolation line; a looser sandbox or a longer host list after signing is governance drift.
- Checked for real on Linux with Claude Code: a write outside the worktree failed (read-only file system) and a host off the list was refused, while a write inside and a listed host worked.

### Mutation tier
- New command tier `mutation`, last in the order and required for money and data bets. With no command of its own it runs Bridgie's built-in check (`bridgie mutate`), so nothing needs configuring.
- The check makes single small edits to lines the task added (comparison, equality and logic operators, booleans, `+ - *`, whole numbers, a removed `not`/`!`), in code files only, never in strings, comments or tests; runs the specified tier's commands (or `mutation.test`) for each; and restores the file. A journal in the git dir lets the next run, and `verify` before it commits, put back a mutant a killed run left behind.
- Passes at `mutation.min_score` (default 0.6) of `mutation.max_mutants` (default 20) noticed. Survivors are listed in the tier's log, which the reviewer reads; the reviewer and implementer seats are told what they mean.
- Tier commands now get `BRIDGIE_TASK` and `BRIDGIE_BASE_SHA` (the commit the task branched from).
- `bridgie mutate --base <commit> --test "<command>" [--max N] [--min S] [--timeout S]` runs it by hand in any git repository.
- Upgrading: money and data bets gain this tier. A task whose tests do not notice 60% of the changes now fails verify until its tests are strengthened, or the bar is lowered in policy.

### Governance
- **Provenance.** Answered decisions record `via`: channel (`cli` or `surface`), the agent harness (`$BRIDGIE_HARNESS`, else detected from the environment), OS user and host. Approvals in the acceptance record carry it too.
- **`humans_only`.** Policy `humans_only: { decisions: [accept, governance], relay: true }`. Inside an agent, the command line refuses these decisions unless `--relayed` is passed (recorded); `relay: false` refuses outright. The page (`bridgie open`) is not affected.
- **Governance lock.** Signing stores the rules in force on the bet. Weaker rules later (a tier dropped, fewer approvers, cross-family review off, a `humans_only` entry removed, looser size rules, changed verify commands) stop `build`, `verify` and `accept` with a `governance` decision only the owner can accept. Bets signed before 0.7.0 have no stored rules and are not checked.
- **Owner override.** `bridgie accept <slug> --override "<reason>"`: the owner delivers with fewer approvals than required; the acceptance record holds who, why and the counts. `acceptance: { owner_override: false }` forbids it.

### Parallel builds
- `bridgie build <slug> --parallel N` and `bridgie run <slug> --parallel N` (default from policy `build: { parallel: 1 }`, 1 to 16) build up to N ready tasks at the same time, each in its own worktree and branch. A ready task is one whose dependencies have all passed, so no task in a batch needs another's code.
- One process holds the seat lock for the batch and writes state only before the seats start and after the last one ends. The batch shares one state snapshot taken before any seat starts; each seat's guard ignores its siblings' run folders and nothing else. If state is edited during a batch, it is restored and every attempt of the batch is discarded: the runner cannot tell which seat did it.
- One task failing does not sink the others: they go on to verify; the command fails only when none finished.
- `verify` first brings the task up to date with what was merged into the feature branch since it was built (a merge in the task worktree, only when code outside `.bridgie/` changed), so tiers and the reviewer see the code as it will be after merging. A conflict is undone, the task goes back to build with the files named, and `verify` exits 2.
- Tasks may carry `touches` (paths or globs the planner expects the task to change). Tasks whose declared paths overlap are not put in the same batch.
- A build whose seat could not run because every fitting model CLI was at its usage limit no longer uses an attempt (exit 3).
- Measured on the 41-task bet this release came from (23.5 h building, 6.8 h reviewing): N=2 gives about 1.3x, N=3 about 1.6x, N=4 and above about 1.65x. A scheduler that also overlapped verification with building would reach about 2.2x; the dependency chain alone is 11.8 h.

### Run control, planning, cost
- `bridgie run <slug> --pause-before-verify` stops after each build.
- `plan` warns when a task builds a requirement whose text names one built by a task it does not depend on.
- `bridgie status --cost [slug]`: attempts, runs and time per task (build, review, checks). Cost entries name their task; the command tiers are timed.
- **Tokens and cost.** Adapters write `usage.json` beside their output when their CLI reports usage, and the runner records it on the run's cost entry: Claude Code (now run with `--output-format json`) gives input, output and cache tokens and a list-price cost; Codex gives a token total. The cost view adds Tokens and Cost columns and the cost per passed task, and says how many model runs reported nothing. Nothing is estimated. The acceptance package and record carry the totals.
- Python projects are detected and get compile and pytest commands from the engineering lane.
- Hardener: seeded sweeps and real two-writer runs. Decomposer: sizes, and ordering by what requirements mention.

### Upgrading
- A project whose tests or scripts change `policy.yaml` after signing will now be stopped by the governance lock until the owner accepts the change.
- Scripts that call `bridgie accept --approve` from inside an agent need `--relayed` (or `BRIDGIE_HARNESS=none` for a person's own automation).

### Not in this release
- Verifying tasks in parallel, and starting the next build while another task is being verified: verification and merging are one task at a time.
- Tokens and cost from Antigravity and Copilot: their CLIs do not report them.
