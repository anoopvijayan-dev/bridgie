---
name: bridgie
description: Drive the Bridgie company-OS CLI for a person - turn an idea into a bet, grill it, then shape, plan, build, verify and package it for acceptance, always leaving every human decision to the person on the Bridgie decision page. Use when the person says /bridgie, mentions a bet, wants to evaluate or start an idea, or wants a feature built through Bridgie.
---

# Bridgie

Bridgie is a command-line tool (`bridgie`) that runs work through five loops: decide → build → verify → accept → learn. State lives in `.bridgie/` in the project; only the tool writes it. Your job is to drive the tool and help the person think. The person makes every decision.

## The one rule

Never answer a Bridgie decision yourself: grill questions, sign, design approval, risk acknowledgement, unblock, acceptance, confidence proposals. Do not run `bridgie decide`, `bridgie sign`, `bridgie ack`, `bridgie shape --approve`, `bridgie shape --changes` or `bridgie accept --approve|--conditions|--reject` unless the person has just told you their answer in this conversation. Point them to the decision page instead: `bridgie open <slug>`. Never edit `customer.yaml`, `pitch.md` or `numbers.yaml` beside a bet with figures the person did not give you, and never write a buyer's answer or an evidence note yourself.

## Starting

- Check the tool: `bridgie doctor`. If `bridgie` is not on PATH, tell the person to run `~/source/repos/bridgie/bin/install.sh`.
- No `.bridgie/` folder yet: `bridgie init --lane <engineering|product|marketing|sales|platform|security>`. An empty folder is fine for a new company; Build needs a git repository.

## Find: from signals to opportunities

If the person has raw material (support exports, notes, emails, forum threads) in a folder: `bridgie scout --from <folder>`. It writes `.bridgie/scout/<name>/opportunities.md`, ranked by independent sources × severity. Read the list back in short form; the person picks one: `bridgie bet new <slug> --from <name>/O2`.

## Decide: from idea to signed bet

1. `bridgie bet new <slug> --title "..." --risk <money|data|security|infra|ux|none>` (or `--from` an opportunity).
2. `bridgie frame <slug> "<one-line idea>"` drafts Who, Problem in their words, Why now, What they do today, Expected outcome, and raises every assumption as a question. Or help the person write the body by hand in `.bridgie/bets/<slug>/bet.md` (markdown body only, never the YAML frontmatter).
3. `bridgie research <slug>` maps competitors, prices and complaints from the web with a link on every fact (needs an adapter with web access).
4. `bridgie grill <slug> --lenses` stress-tests the why and convenes the three-lens board (offer, moat, product) with a chair; the vote is computed by the runner.
5. `bridgie panel <slug>` first drafts `customer.yaml` and `pitch.md` beside the bet and stops: the person must review them. Run it again to deal the buyers. The result is objections, segments and a price range from simulated buyers: an upper bound, never evidence, and it does not change confidence.
6. Money bets: `bridgie numbers <slug> --template`, the person fills in their own figures, `bridgie numbers <slug>` computes the verdict. Signing is refused without positive unit economics.
7. `bridgie evidence <slug>` turns "don't know" answers and the panel's open points into interview guides and data pulls. When the person has run them and dropped notes into `.bridgie/bets/<slug>/evidence/`, run it again: it synthesises and proposes a confidence tier the person accepts or keeps on the page.
8. Tell the person to answer, accept or keep, and sign on `bridgie open <slug>`. "Don't know" is a valid answer; it becomes an evidence task.

## Build, verify, accept

- `bridgie run <slug>` drives shape → plan → build → verify → accept packaging and stops at each human decision. Run it again after the person decides.
- Single steps when needed: `bridgie shape | plan | build | verify | accept <slug>`.
- A command that ends with "waiting for ..." is not a failure. Say what is waiting and send the person to `bridgie open <slug>`.
- A blocked task needs the person's unblock decision. Summarise its escalation from `bridgie status` and `.bridgie/specs/<slug>/tasks.json`; do not retry it yourself.
- Bridgie never pushes or merges into the base branch. After acceptance, the person merges `bridgie/<slug>` when they choose.

## Learn

After an accept decision or a killed bet: `bridgie learn <slug>`. Read the proposals file aloud in short form and ask which ones to adopt; adopted gotchas go into `.bridgie/learn/gotchas.md`.

## Reporting

After each command, tell the person in two or three sentences what happened, what is waiting for them, and the next command. Quote `bridgie status` when it helps. Do not paste whole run transcripts.

## Gotchas

- Do not edit anything under `.bridgie/` except a bet's markdown body and `.bridgie/learn/gotchas.md`; the runner refuses state changes it did not make and restores them.
- Model routing is per machine in `~/.bridgie/policy.yaml` (`routing.tiers` and `routing.seats`); per project overrides go in `.bridgie/policy.yaml`. `BRIDGIE_ADAPTER=fake` runs the loop without models, for demos.
- On Windows, run Bridgie from Git Bash.
