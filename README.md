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
git clone https://github.com/anoopvijayan-dev/bridge.git ~/bridgie
node ~/bridgie/bin/bridgie.mjs setup
```

(On Windows PowerShell use `$HOME\bridgie` for `~/bridgie`.) `setup` links the `bridgie` command with npm, so
npm writes the right launcher for your shell; installs the agent skill (`skills/bridgie/`, the one copy) for
every agent home it finds (`~/.claude`, `~/.agents`, `~/.copilot`, `~/.gemini/antigravity`); and
writes `~/.bridgie/policy.yaml` (which model runtime each seat uses on this machine). Open a **new** terminal
afterwards. To update later: `git pull` in the clone; re-run `setup` only if it says so.

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
| `plan` | `tasks.json`, every requirement mapped | approved design, no cycles; a requirement tagged `risk: money` raises the bet's risk; re-planning supersedes any acceptance package |
| `build` | one task per run in `.bridgie/worktrees/<slug>/<task>` | human ack for risky bets; `.bridgie/` edits discarded; only declared inputs reach the model |
| `verify` | the runner runs every required test tier, then a read-only reviewer reads the results in a detached worktree | changed risk paths raise the bet's risk (logged, never lowered) and need a fresh ack; a required tier with no command is not proven; every evidence row counts and the reviewer's verdict can only tighten the result; different vendor from the producer; 3 attempts then blocked |
| `accept` | one-page acceptance package, bound to the branch commit and a digest of spec, tasks and evidence | every task passed, re-checked at the moment of approval; a stale package is refused and rebuilt by `bridgie accept`; approvers per the current risk (2 for money), each a different person |

Verification commands live in `.bridgie/policy.yaml` (`verify.commands.<tier>`; see the comment `bridgie init`
writes). Without them Bridgie uses the lane's commands for the stacks it detects; a tier the risk requires
but nobody configured is never skipped silently.

While an agent runs, Bridgie state is read-only (a project-wide seat lock): your decisions are refused with a
message rather than rolled back, and anything the agent adds, changes or deletes under `.bridgie/` is restored.

`bridgie open` prints a personal link with an access token; decisions are recorded under the identity of that
link. `bridgie open --invite alice` prints a second link for a second approver. With `--host` beyond
localhost the traffic is plain HTTP, so share each link only with its person.

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
| `docs/superpowers/` | design spec and build plans |

## Status

v0.4.0 (M3 decide loop): scout, frame, research, lenses, panel, numbers, evidence; swarm seats and web
capability in the runner; confidence decisions. Borrowed with thanks from
[founder-skill](https://github.com/Jakeschincariol/founder-skill) (MIT): the three-lens board, the
runner-dealt buyer panel, Van Westendorp pricing and computed unit economics. v0.3.0 (M2 hardening): enforcement gaps from an external review closed (acceptance binding, evidence
reconciliation, effective risk and mandatory tiers, state guard and seat lock, authenticated decision
server, reviewer works from runner-run test results). v0.2.0 (M1): the whole loop runs end to end on the
fake adapter and is covered by tests for spec requirements R1–R14 and properties P1–P3. Real adapters are verified against stub CLIs with the
flags of Claude Code 2.1, Codex 0.167 and Copilot CLI 1.0; Antigravity follows the v1 notes and its
write mode is unverified (see `adapters/antigravity/gotchas.md`). Next: a first real run of the decide loop on live
models, recovery for interrupted runs, seeded-bug evals for the reviewer, marketing and sales lanes.

## Tests

`npm test` runs the unit tests; `tests/run.sh` runs everything (unit, `bats tests/` for the CLI, doctor). CI runs both on Linux, macOS and Windows with Node 20 and 22, and checks that `bridgie` launches from PowerShell and cmd after `setup`. Tests ignore `~/.bridgie`.
