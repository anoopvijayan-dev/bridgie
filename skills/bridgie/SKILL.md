---
name: bridgie
description: Drive the Bridgie company-OS CLI for a person - turn an idea into a bet, grill it, then shape, plan, build, verify and package it for acceptance, always leaving every human decision to the person on the Bridgie decision page. Use when the person says /bridgie, mentions a bet, wants to evaluate or start an idea, or wants a feature built through Bridgie.
---

# Bridgie

Bridgie is a command-line tool (`bridgie`) that runs work through five loops: decide → build → verify → accept → learn. State lives in `.bridgie/` in the project; only the tool writes it. Your job is to drive the tool and help the person think. The person makes every decision.

## The one rule

Never answer a Bridgie decision yourself: grill questions, sign, design approval, risk acknowledgement, unblock, acceptance. Do not run `bridgie decide`, `bridgie sign`, `bridgie ack`, `bridgie shape --approve`, `bridgie shape --changes` or `bridgie accept --approve|--conditions|--reject` unless the person has just told you their answer in this conversation. Point them to the decision page instead: `bridgie open <slug>`.

## Starting

- Check the tool: `bridgie doctor`. If `bridgie` is not on PATH, tell the person to run `~/source/repos/bridgie/bin/install.sh`.
- No `.bridgie/` folder yet: `bridgie init --lane <engineering|product|marketing|sales|platform|security>`. An empty folder is fine for a new company; Build needs a git repository.

## Decide: from idea to signed bet

1. `bridgie bet new <slug> --title "..." --risk <money|data|security|infra|ux|none>`.
2. Help the person fill the bet body in `.bridgie/bets/<slug>/bet.md`: Who, Problem in their words, Why now, What they do today, Expected outcome. Use their words; mark anything you inferred as an assumption. Edit only the markdown body, never the YAML frontmatter.
3. `bridgie grill <slug>` raises the questions that need real-world evidence.
4. Tell the person to answer and sign on `bridgie open <slug>`. "Don't know" is a valid answer; it becomes an evidence task.

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
