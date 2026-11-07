# Bridgie

A file-based operating system for running a company's work through AI agents:
**decide → build → verify → accept → learn**. One tool, pointed at any folder,
including one with no code in it yet.

Humans own intent (the bet) and acceptance. Agents produce. The harness
verifies. Only the runner writes state; every human choice happens on a
rendered page and is written back to files you can diff.

## Install

```bash
git clone <this repo> ~/source/repos/bridgie
export PATH="$HOME/source/repos/bridgie/bin:$PATH"   # add to ~/.bashrc
bridgie doctor
```

Requires bash, git and Node ≥ 20. Tests need `npm i -g bats`.
On Windows, run everything from Git Bash.

## Quick start (M0: the Decide loop)

```bash
cd ~/some-project            # or an empty folder for a new company
bridgie init --lane engineering
bridgie bet new net-collect --title "Net collection for failed payments" --risk money
$EDITOR .bridgie/bets/net-collect/bet.md      # who, problem in their words, why now, outcome
bridgie grill net-collect    # the grill seat raises questions
bridgie open net-collect     # answer them in the browser, then sign, kill or ask for more evidence
bridgie status
```

Model routing lives in `policy/default.yaml`; override per project in
`.bridgie/policy.yaml`. Set `BRIDGIE_ADAPTER=fake` to run the loop without a
model (real adapters arrive in M1).

## Layout

| Path | What |
|---|---|
| `bin/bridgie` | the command |
| `runner/` | bash commands and dependency-free Node modules (state, context, surface, doctor) |
| `seats/<loop>/<seat>/SKILL.md` | what each agent seat is for, its inputs, what it may write |
| `lanes/<lane>/` | risk paths, attack lists, checklists, verifiers per domain |
| `adapters/` | how a seat is launched on a model runtime |
| `schemas/`, `templates/`, `policy/` | the contracts |
| `ui/templates/` | decision surface pages |
| `docs/superpowers/` | design spec and build plans |

## Status

M0 (this release): Decide loop end to end with the fake adapter, decision
surface, doctor. M1: shape/plan/build/verify/accept with real adapters and a
parity run on a real repository. See
`docs/superpowers/specs/2026-11-07-bridgie-company-os-design.md`.

## Tests

`tests/run.sh` (shellcheck if installed, `node --test runner/*.test.mjs`, `bats tests/`, `bridgie doctor`).
