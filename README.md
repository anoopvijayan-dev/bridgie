# Bridgie

A file-based operating system for running a company's work through AI agents:
**decide → build → verify → accept → learn**. One tool, pointed at any folder,
including one with no code in it yet.

Humans own intent (the bet) and acceptance. Agents produce. The harness
verifies. Only the runner writes state; every human choice happens on a
rendered page and is written back to files you can diff.

## Install

Needs **git** and **Node 20+**. Works the same in PowerShell, cmd, Git Bash, macOS and Linux terminals.

```
npx bridgie@latest setup
```

One command, for you and your agents:

1. puts `bridgie` on your PATH (`npm install -g bridgie`; npm writes the right launcher for your shell);
2. installs the `/bridgie` agent skill for every agent it finds on the machine (Claude Code, Codex,
   GitHub Copilot, Antigravity, Gemini CLI, Cursor and others) through the open
   [`skills`](https://skills.sh) installer; pass `--agent claude-code --agent codex` to pick;
3. writes `~/.bridgie/policy.yaml`: which model CLI each seat uses, from the ones it finds.

Open a **new** terminal afterwards. To update the tool and the skill together, run the same command again;
`bridgie doctor` warns when an installed skill is out of date. The skill alone, without the CLI:
`npx skills add anoopvijayan-dev/bridgie` (the skill then runs Bridgie through `npx bridgie`).

**Claude chat and Claude cloud sessions** read skills from your claude.ai account, not your disk: upload
`skills/bridgie/SKILL.md` there once (and again after it changes).

**Working on Bridgie itself:** clone this repo and run `node bin/bridgie.mjs setup` in it; `setup` then links
your clone instead of installing from npm.

## Start

```bash
bridgie new my-idea --lane product     # folder + git + Bridgie state, in one step
cd my-idea
bridgie                                # tells you exactly what to do next, at every stage
```

`bridgie doctor` checks tools and model adapters. `bridgie help` lists every command.

## Finding and testing an idea (the decide loop)

```bash
mkdir ~/ideas && cd ~/ideas && git init
bridgie init --lane product
bridgie scout --from ~/Downloads/broker-emails        # ranks the problems people describe, by independent sources
bridgie bet new packs --from broker-emails/O1 --risk money
bridgie frame packs                                    # drafts who / problem / why now / today / outcome; assumptions → questions
bridgie research packs                                 # competitors, prices, complaints, every fact linked (needs web access)
bridgie grill packs --lenses                           # adversarial grill + a three-lens board (offer, moat, product) and a chair
bridgie panel packs                                    # drafts customer.yaml and pitch.md; you correct them; run again for 20 simulated buyers
bridgie numbers packs --template && $EDITOR .bridgie/bets/packs/numbers.yaml && bridgie numbers packs
bridgie evidence packs                                 # interview guides; drop notes in .bridgie/bets/packs/evidence/ and run again
bridgie open packs                                     # answer, accept the confidence proposal, sign
```

Every verdict is computed by the runner, never written by a model: the board's vote and average, the
panel's buy rate and Van Westendorp price range, the unit-economics checks. Simulated buyers are an
upper bound and never change a bet's confidence; only `bridgie evidence` (real interviews, data, tests)
proposes a tier, and you accept it. A money bet cannot be signed without positive unit economics.

## The loop

```bash
cd ~/some-project                     # a git repo; for a brand-new company, an empty folder works until Build
bridgie init --lane engineering
bridgie bet new net-collect --title "Net collection for failed payments" --risk money
$EDITOR .bridgie/bets/net-collect/bet.md   # who, problem in their words, why now, outcome
bridgie grill net-collect             # questions that need real-world evidence
bridgie open net-collect              # answer, then sign / kill / need more evidence
bridgie run net-collect               # shape → plan → build → verify → package; stops at each decision
bridgie open net-collect              # approve the design, ack risk paths, unblock tasks, accept
bridgie learn net-collect             # proposals for tests, gotchas and policy
```

What each step guarantees:

| Step | What happens | Guards |
|---|---|---|
| `shape` | branch `bridgie/<slug>`, `requirements.md` (EARS) and `design.md` | signed bet, clean tree |
| `plan` | `tasks.json`, every requirement mapped, each task sized `small`, `medium` or `large` | approved design, no cycles; a requirement tagged `risk: money` raises the bet's risk; a warning when a task's requirement names one that a task it does not depend on builds; re-planning supersedes any acceptance package |
| `build` | one task per run in `.bridgie/worktrees/<slug>/<task>` (or several independent ones with `--parallel N`); a hardener pass when the task's size or the bet's risk asks for one | human ack for risky bets; `.bridgie/` edits discarded; only declared inputs reach the model; a task a killed run left half-built is picked up again without using an attempt |
| `verify` | the runner runs every required test tier, then a read-only reviewer reads the results in a detached worktree | changed risk paths raise the bet's risk (logged, never lowered) and need a fresh ack; a required tier with no command is not proven; every evidence row counts and the reviewer's verdict can only tighten the result; different vendor from the producer; 3 attempts then blocked; a retry for the same commit reuses the test results instead of running them again |
| `accept` | one-page acceptance package, bound to the branch commit and a digest of spec, tasks and evidence | every task passed, re-checked at the moment of approval; a stale package is refused and rebuilt by `bridgie accept`; approvers per the current risk (2 for money), each a different person; inside an agent the approval must say it is relayed from a person, and the record says so |

### Long runs

What keeps a bet of dozens of tasks moving, and honest, over days:

- **Interrupted runs.** A run killed mid-task (closed laptop, reclaimed cloud container) leaves a lock and a task marked in progress. The next `bridgie build` or `bridgie run` sees that the process is gone, removes the lock and builds the task again without counting the lost attempt. `bridgie recover <slug>` does the same on its own.
- **Usage limits.** When a model CLI says it is out of quota, Bridgie notes when it resets, uses the next CLI that fits, and — when the reviewer has no other model family to go to — stops with exit 3 and "waiting … until <time>", the task still in verify and its attempt unused. `bridgie status` shows which CLIs are at a limit.
- **Task size.** The planner gives every task a size. A `small` task (one module, no shared state, no money arithmetic) skips the hardener and the whole-system tiers; a `large` one is always hardened. Risk sets the floor: a task that builds a requirement tagged `data` or higher, or changes a risk path, is never treated as small. Tune it under `sizes:` in policy.
- **Findings you choose to live with.** When a task is blocked on review findings and every test tier passed, the unblock decision offers `accept as limitations` with a reason. The task merges without another review round, and the findings are listed in the acceptance package as accepted limitations and given to later reviewers as known.
- **Review debt.** If the reviewer had to fall back to the builder's own model family, the task still passes but is recorded as review debt (`bridgie status`, and in the acceptance package). `bridgie rereview <slug>` has a second family read those tasks later and raises a decision for each serious finding.
- **Building tasks side by side.** `bridgie run <slug> --parallel 3` (or `build: { parallel: 3 }` in policy) builds up to that many independent tasks at the same time, each in its own worktree and branch. Independent means every task it depends on has passed. Verification and merging stay one task at a time: before a task is verified it is brought up to date with what was merged since it was built, so its tests run on the code as it will be. If two tasks changed the same lines, the second goes back to its builder with the conflict named. The planner can give each task `touches` (the files it will change); tasks that declare the same files are not built together. If any seat edits Bridgie state during a batch, the whole batch is discarded, because the runner cannot tell which seat did it. On a real 41-task bet, three at a time would have cut about 30 hours of agent time to about 19; more than three or four added little, because the dependency chain and one-at-a-time verification set the floor. Running several model CLIs at once also uses their quota faster.
- **Reading before verifying.** `bridgie run <slug> --pause-before-verify` stops after each build so you read the change first; run it again to verify that task and build the next.
- **Where the time and money went.** `bridgie status --cost [slug]` lists attempts, runs and time per task, split into build, review and checks, with tokens and cost where the model CLI reports them, and the cost per passed task (everything spent, failed attempts included, divided by the tasks that passed). Claude Code reports tokens and a list-price cost; Codex reports a token total; Antigravity and Copilot report nothing yet, and the view says how many runs are missing. The cost is what the CLI computed from list prices: on a subscription it is not a bill. The acceptance package carries the totals.
- **Run logs.** Test and adapter logs, diffs and raw replies stay on disk but out of git (they were 97% of a real bet's committed run folder). Evidence, claims and cost records are committed. Set `commit_transcripts: true` to commit everything.

### Who decided, and under which rules

- **Provenance.** Every decision records how it arrived: the page or the command line, the agent the command ran inside (Claude Code, Codex, …) if any, the OS user and the machine. The bet's decision log names the agent.
- **Decisions for a person.** `humans_only` in policy (default: acceptance and governance decisions) names decisions an agent's command line may not answer on its own. With `relay: true` (the default) the agent must pass `--relayed`, saying it passes on a person's answer, and the record says so; with `relay: false` it is refused and the person answers in their own terminal or on `bridgie open`. This stops an agent approving its own work by accident and keeps the record truthful. It is not proof of who typed.
- **Governance lock.** Signing a bet stores the rules it is held to: required tiers, approvers, cross-family review, who may decide, task-size rules, the verify commands. If `policy.yaml` later asks for less, `build`, `verify` and `accept` stop with a decision only the bet's owner can answer: accept the change for this bet, or keep the signed rules and put the file back. Stricter rules never stop anything.
- **Owner override.** A solo founder has no second approver. `bridgie accept <slug> --override "<reason>"` lets the bet's owner deliver with fewer approvals than policy asks for; the acceptance record says who, why and how many approved. `acceptance: { owner_override: false }` turns it off.

Verification commands live in `.bridgie/policy.yaml` (`verify.commands.<tier>`; see the comment `bridgie init`
writes). Without them Bridgie uses the lane's commands for the stacks it detects (.NET, Node, Python); a tier the risk requires
but nobody configured is never skipped silently.

Which model CLI runs each seat is set in `~/.bridgie/policy.yaml` (`routing.tiers`, `routing.seats`). When the
routed CLI cannot run a seat at all (not installed, not set up for the folder, signed out, over its limit,
crashed), Bridgie warns and runs the seat on the next CLI that is installed and fits it: the agent you are
running Bridgie from, then Claude Code, Codex, Antigravity, Copilot. A model that ran but answered badly is not
retried elsewhere, and the reviewer still needs a different model family from the builder. Set your own order
with `routing.fallback: [codex, claude-code]`, turn it off with `routing.fallback: []`, or pin one CLI for a
command with `BRIDGIE_ADAPTER=<name>`.

While an agent runs, Bridgie state is read-only (a project-wide seat lock): your decisions are refused with a
message rather than rolled back, and anything the agent adds, changes or deletes under `.bridgie/` is restored.

`bridgie open` prints a personal link with an access token; decisions are recorded under the identity of that
link. `bridgie open --invite alice` prints a second link for a second approver. With `--host` beyond
localhost the traffic is plain HTTP, so share each link only with its person.

**Building in public:** `bridgie open --public --bet <slug> --out site` renders a read-only progress page for
the bets you name and no others: status, open questions, the board's verdict, the dated decision log. It
has no forms, file paths or command hints, so `site/` is safe to publish (for example with GitHub Pages on
every push).

Bridgie never pushes and never merges into your base branch. Merge `bridgie/<slug>` yourself after acceptance.
In an agent harness, say `/bridgie` (the installed skill drives the CLI and leaves decisions to you).

## Layout

| Path | What |
|---|---|
| `bin/bridgie` | the command |
| `bin/bridgie.mjs`, `runner/cmd/` | the CLI: one Node module per command, no bash anywhere |
| `runner/` | dependency-free Node modules (state, context, surface, guard, doctor) |
| `seats/<loop>/<seat>/SKILL.md` | what each agent seat is for, its inputs, what it may write (decide: scout, framer, researcher, three lenses, chair, profiler, buyer, grill, evidence) |
| `runner/panel.mjs`, `runner/numbers.mjs` | the computed parts of the decide loop: persona cards, tallies, price range; unit economics |
| `lanes/<lane>/` | risk paths, attack lists, checklists, verifiers per domain |
| `adapters/` | claude-code, copilot, codex, antigravity, fake: how a seat is launched on a model runtime |
| `skills/bridgie/` | the skill agent harnesses use to drive bridgie |
| `schemas/`, `templates/`, `policy/` | the contracts |
| `ui/templates/` | decision surface pages |

## Status

v0.7.0 (long runs and governance), from running a 41-task money-risk bet end to end: recovery for
interrupted runs, usage-limit waits, task sizes, test results reused per commit, accepted limitations,
review debt and `rereview`, decision provenance, decisions reserved for a person, the governance lock, the
owner override, parallel builds of independent tasks, `run --pause-before-verify`, plan-order warnings,
`status --cost`, Python projects, run logs out of git. tokens and cost per task. Not yet: verifying tasks in parallel (verification and
merging are one at a time). See `CHANGELOG.md`.

v0.4.0 (M3 decide loop): scout, frame, research, lenses, panel, numbers, evidence; swarm seats and web
capability in the runner; confidence decisions. Borrowed with thanks from
[founder-skill](https://github.com/Jakeschincariol/founder-skill) (MIT): the three-lens board, the
runner-dealt buyer panel, Van Westendorp pricing and computed unit economics. v0.3.0 (M2 hardening): enforcement gaps from an external review closed (acceptance binding, evidence
reconciliation, effective risk and mandatory tiers, state guard and seat lock, authenticated decision
server, reviewer works from runner-run test results). v0.2.0 (M1): the whole loop runs end to end on the
fake adapter and is covered by tests for spec requirements R1–R14 and properties P1–P3. Real adapters are verified against stub CLIs with the
flags of Claude Code 2.1, Codex 0.167 and Copilot CLI 1.0; Antigravity follows the v1 notes and its
write mode is unverified (see `adapters/antigravity/gotchas.md`). Next: seeded-bug evals for the reviewer,
sandboxed build seats, mutation testing, marketing and sales lanes (see `docs/agentic-landscape-2026-11.md`).

## Tests

`npm test` runs the unit tests; `tests/run.sh` runs everything (unit, `bats tests/` for the CLI, doctor). CI runs both on Linux, macOS and Windows with Node 20 and 22, and checks that `bridgie` launches from PowerShell and cmd after `setup`. Tests ignore `~/.bridgie`.
