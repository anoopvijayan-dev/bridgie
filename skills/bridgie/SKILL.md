---
name: bridgie
description: Drive the Bridgie company-OS CLI for a person - scout signals, turn an idea into a bet, grill it, then shape, plan, build, verify and package it for acceptance, and learn from it, always leaving every human decision to the person. Works from Claude chat on their computer, from a local agent terminal (Claude Code, Codex, Copilot, Antigravity) and from a Claude cloud session. Use when the person says /bridgie, mentions a bet, wants to evaluate or start an idea, or wants a feature built through Bridgie.
---

# Bridgie

Bridgie is a command-line tool that runs work through five loops: decide, build, verify, accept, learn. State lives in `.bridgie/` inside each project and only the tool writes it. Your job is to drive the tool and help the person think. The person makes every decision.

## 1. Find out where you are, then set `B`

Every command below is written `B <command>`. Work out once which case you are in, and use that form of `B` for the rest of the session.

Bridgie is the npm package `bridgie` (Node 20+). Wherever there is a shell with node, `bridgie` works if it is installed, and `npx -y bridgie` works if it is not.

**A. Claude chat with the person's computer** (you have a `device_bash` tool).
- Request folder access to each project folder (or its parent, to create one) with `device_request_folder_access`; it appears under `$HOME/mnt/`.
- No state carries between calls, so `cd` in the same call: `cd $HOME/mnt/<project> && BRIDGIE_ADAPTER=claude-code npx -y bridgie <command>`.
- Only the `claude-code` adapter works in that shell, so set `BRIDGIE_ADAPTER=claude-code` on seat-running commands (the person's own `~/.bridgie/policy.yaml` does not apply there).
- Deleting is off by default, and git needs it for lock files and checkouts: before `init` in a new repo, or any `shape`, `build`, `run` or `verify`, call `device_request_delete_permission` once for the project folder with a one-line reason.
- Calls are capped near 180s: pass `timeout_ms: 180000` on seat commands; if one still times out, start it with `nohup ... > .bridgie-chat.log 2>&1 &` and poll the log and `B status`.

**B. A terminal on the person's computer** (Claude Code, Codex, Copilot CLI, Antigravity, or any other agent).
- `B` is `bridgie`, run from the project folder. Routing comes from `~/.bridgie/policy.yaml`, so do not set `BRIDGIE_ADAPTER` unless asked.
- If `bridgie version` fails, use `npx -y bridgie` for now and suggest the person installs it once with `npx bridgie@latest setup` (puts `bridgie` on PATH, installs this skill for their agents, writes the routing policy), then opens a new terminal.

**C. A Claude cloud session** (`CLAUDE_CODE_REMOTE` is set; no `device_bash`).
- The container cannot reach the person's computer; Bridgie runs here. `B` is `BRIDGIE_ADAPTER=claude-code npx -y bridgie`, run from the project.
- The project is the repository this session was started on (your working directory). For a brand-new company, ask the person which GitHub repository to use; a folder that is not pushed anywhere is lost when the container is reclaimed.
- Long seat runs: start them with the Bash tool's `run_in_background`, writing to `.bridgie-chat.log`, and check `B status` when they finish.
- The container is reclaimed after inactivity, so after each step that changed `.bridgie/`, commit it on the session's development branch and push that branch. Ask the person before pushing any other branch, including `bridgie/<slug>`.
- `research` needs web access; if the environment's network policy blocks a site, say so rather than guessing facts.

Then run `B doctor` to check the setup. A `[warn]` for an adapter that is not installed is normal; a `[fail]` is not.

## 2. Decisions: the one rule

Never answer a Bridgie decision yourself: grill questions, sign, design approval, risk acknowledgement, unblock, acceptance, confidence proposals, living-spec findings (spec drift).

- In case B the person can use the decision page: `B open <slug>`.
- In cases A and C the page is served inside a shell their browser cannot reach, so take decisions in chat: read the pending questions and options from the bet's files and `B status`, show them to the person (for several choices use AskUserQuestion or a short rendered page, not raw markdown), and only after they answer in this conversation run `B decide <slug> <id> <answer> [--text "..."]`, `B sign`, `B ack`, `B shape --approve|--changes|--amend` or `B accept --approve|--conditions|--reject`, exactly as they said.
- Acceptance and governance decisions are reserved for a person. From inside an agent, `B accept` and `B decide` refuse them unless you add `--relayed`. Add it only when the person gave that exact answer in this conversation; the record then says the answer came through you. If the tool says relaying is off, the person must answer in their own terminal or on `B open <slug>`: tell them, and do not look for another way.
- Never weaken `.bridgie/policy.yaml` (fewer tiers or approvers, cross-family review off, different verify commands) to get a task through. Bridgie stops the bet and asks the owner when the policy is weaker than the one the bet was signed under; that decision is theirs too.
- `B accept <slug> --override "<reason>"` (deliver with fewer approvals than policy asks for) is the owner's call alone: offer it only when they say there is no second approver, and use their reason.

Never put figures the person did not give you into `customer.yaml`, `pitch.md` or `numbers.yaml`, and never write a buyer's answer or an evidence note yourself.

## 3. Starting a project

- New: `B new <folder> --lane <engineering|product|marketing|sales|platform|security>` (makes the folder, the git repo and the state).
- Existing folder: `B init --lane <lane>`. An empty folder is fine for a new company; Build needs git.
- Plain `B` (or `B next`) says what to do next at any stage.

## 4. Find

If the person has raw signals (emails, support exports, notes, forum threads) in a folder: `B scout --from <folder>` writes `.bridgie/scout/<name>/opportunities.md`, ranked by independent sources times severity. Summarise the list; the person picks one, then `B bet new <slug> --from <name>/O<n>`.

## 5. Decide loop

1. `B bet new <slug> --title "..." --risk <money|data|security|infra|ux|none>`. Ask the person for the risk and the appetite; don't pick them. Before signing they can be corrected with `B bet set <slug> --risk R --owner NAME --time 6w --tokens-usd N --reason "..." --relayed` (only on the person's word).
2. `B frame <slug> "<one-line idea>"` drafts Who, Problem, Why now, What they do today, Expected outcome, and raises every assumption as a question. Or help the person write the markdown body of `.bridgie/bets/<slug>/bet.md` by hand (never the YAML frontmatter).
3. `B research <slug>`: competitors, prices and complaints, with a link on every fact.
4. `B grill <slug> --lenses`: adversarial grill plus the offer, moat and product board with a chair. The runner computes the vote.
5. `B panel <slug>`: the first run drafts `customer.yaml` and `pitch.md` for the person to correct, and stops. Run it again for simulated buyers. The result is an upper bound, never evidence, and does not change confidence.
6. Money bets: `B numbers <slug> --template`, the person fills in their own figures, then `B numbers <slug>`. Signing is refused without positive unit economics.
7. `B evidence <slug>` turns "don't know" answers and the panel's open points into interview guides and data pulls. Once the person has dropped notes into `.bridgie/bets/<slug>/evidence/`, run it again: it proposes a confidence tier for them to accept or keep.
8. Take their answers, confidence choice and sign or kill through section 2. "Don't know" is a valid answer; it becomes an evidence task.

## 6. Build, verify, accept, learn

- `B run <slug>` drives shape, plan, build, verify and accept packaging, and stops at each decision. Run it again after the person decides. Single steps: `B shape | plan | build | verify | accept <slug>`.
- A command ending "waiting for ..." is not a failure: say what is waiting and ask the person for that decision.
- "waiting: ... at its usage limit until <time>" (exit 3) means a model CLI is out of quota and nothing was changed: tell the person the time and run the same command again after it. Do not switch the reviewer to the builder's model family to get past it unless the person asks; if they do, the task is recorded as review debt and `B rereview <slug>` clears it later.
- If a run was killed (the session or container stopped), just run `B run <slug>` again: Bridgie recovers the half-built task without using an attempt. `B recover <slug>` does only the recovery.
- `B run <slug> --parallel 3` builds up to three independent tasks at once (verification stays one at a time). Offer it for bets with many tasks; say that it uses model quota faster, and that more than three or four rarely helps. If a task "conflicts with what was merged", that is normal: it goes back to build and the next `B run` rebuilds it on top.
- `B run <slug> --pause-before-verify` stops after each build so the person can read the change before it is verified. Offer it when they want to check the work themselves.
- When a task is blocked on review findings and every test tier passed, the unblock decision has an `accept as limitations` option (with a reason). Explain the findings; the person chooses between another attempt and accepting them.
- `B plan` may print ordering warnings (a task's requirement names one built later). Show them to the person before building; `B plan <slug> --replan` fixes the plan.
- `B eval reviewer` tests the configured reviewer on changes with planted bugs and reports how many it caught. Suggest it once per machine or after changing the reviewer; it makes about fourteen model calls. Report the result as it is, including misses.
- `B status --cost <slug>` shows time and attempts per task: use it when the person asks why something is slow.
- A blocked task needs their unblock decision. Summarise the escalation from `B status` and `.bridgie/specs/<slug>/tasks.json`; do not retry it yourself.
- Bridgie never pushes or merges. After acceptance the person merges `bridgie/<slug>` when they choose.
- After an accept decision or a killed bet: `B learn <slug>`. Summarise the proposals and ask which to adopt; adopted gotchas go into `.bridgie/learn/gotchas.md`.

## Reporting

After each command, say in two or three sentences what happened, what is waiting for the person and the next step. Quote `B status` when it helps. Do not paste whole transcripts.

## Gotchas

- Only edit a bet's markdown body and `.bridgie/learn/gotchas.md`; the runner refuses state changes it did not make and restores them.
- Model routing is per machine in `~/.bridgie/policy.yaml` (`routing.tiers`, `routing.seats`), per project in `.bridgie/policy.yaml`. `BRIDGIE_ADAPTER=fake` runs the loop without models, for dry runs and demos.
- This skill ships inside the `bridgie` package (`skills/bridgie/SKILL.md`). `npx bridgie@latest setup` installs or updates it for every agent on the machine, and `B doctor` warns when an installed copy is out of date. Claude chat and cloud sessions use the copy the person uploaded to claude.ai; it needs re-uploading after it changes.
