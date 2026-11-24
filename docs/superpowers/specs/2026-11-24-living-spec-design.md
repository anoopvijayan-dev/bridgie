# Living spec and drift check — design

Date: 2026-11-24. Plan item 7 in `docs/agentic-landscape-2026-11.md` ("Delta specs merged at accept, plus a
drift check"). Step 1 is this design; step 2 (OpenSpec import and export) is at the end.

## Problem

Each bet writes `requirements.md` and `design.md` in `.bridgie/specs/<slug>/` on its own branch. Nothing holds
the requirements of the bets already delivered, so the shaper of a new bet does not see them, a bet can change
or break an earlier requirement without saying so, and the specs go stale (the criticism the research cites for
spec-first tools).

## Decisions taken

| Question | Decision |
|---|---|
| How a bet states its changes | `Changes:` lines and a `## Removed` section inside the bet's own `requirements.md` |
| When the living spec is updated | at `bridgie accept`, before the package is built, so approvers sign the spec change |
| Drift check | an AI seat at accept |
| What a drift finding does | the owner decides each one: amend the design, or "still holds" with a reason |
| Projects with delivered bets | `bridgie spec --seed`, run by hand; `doctor` suggests it |
| OpenSpec | step 2: import and export, not live two-way sync |

## 1. The living spec

One file, `.bridgie/spec/requirements.md`, committed with the rest of `.bridgie/`.

```markdown
# Living spec

Every requirement accepted so far. Written by Bridgie at accept; do not edit by hand (bridgie spec).

## card-fees.R3 · event · risk: money
WHEN a customer pays by card
THE SYSTEM SHALL add a fee of 2% of the amount, rounded half-up to the cent.
Source: card-fees, accepted 2026-11-20
Changed by: fee-cap, accepted 2026-12-02

## card-fees.P1 · property
For any card payment, the fee SHALL be at most 2% of the amount plus one cent.
Validates: card-fees.R3
Source: card-fees, accepted 2026-11-20
```

- A living ID is `<slug>.R<n>` or `<slug>.P<n>`: the bet that first added it and its number there. It never
  changes when a later bet rewrites the text.
- Body lines are the requirement's text as accepted; `Source:`, `Changed by:` (and, from step 2, `Name:`) lines are
  written by the runner and are not part of the text a later bet changes.
  A `Validates:` line inside a property is rewritten to living IDs.
- Sections are kept in the order they were first accepted. A removed requirement is deleted from the file; its
  removal is recorded in the bet that removed it and in the acceptance package.

## 2. The delta, inside the bet's requirements.md

The bet keeps local IDs (R1, R2, P1) so tasks, plans, evidence and the reviewer are unchanged.

```markdown
## R2 · event · risk: money
Changes: card-fees.R3
WHEN a customer pays by card
THE SYSTEM SHALL add a fee of 2% of the amount, capped at 5.00, rounded half-up to the cent.

## Removed
- card-fees.R5: the flat fee is replaced by R2.
```

- A requirement with no `Changes:` line is added. With `Changes: <id>` it replaces that living requirement's text
  (the living ID stays).
- `## Removed` lists living IDs, each with a reason. It is optional.
- Checks, run by `shape` on the shaper's output and again at accept (new module `runner/spec.mjs`):
  every ID named in `Changes:` or `## Removed` exists in the living spec; no living ID is changed or removed twice,
  or both changed and removed; a reason follows every removal. A failed check rejects the shaper output with the
  reason, as malformed output is rejected today.
- `requirementIds`, `requirementSections` and the plan checks ignore the `Changes:` line and the `## Removed`
  section (it has no `R<n>` heading, so tasks cannot cite it).
- Shaper: new seat input `living_spec` (the file as it is on the bet branch, or "none yet"). `SKILL.md` and the
  requirements template say: read it first; when a requirement alters an existing one, write `Changes:`; when it
  ends one, list it under `## Removed`; do not restate unchanged requirements.

## 3. Merge at accept

`bridgie accept <slug>` (packaging, on `bridgie/<slug>`), after the drift check is clear:

1. Read the living spec as it was where the bet branched: `git show <branch point>:.bridgie/spec/requirements.md`,
   the branch point being `git merge-base bridgie/<slug> <base>` (absent means empty). The working-tree copy is
   not used, because after a first packaging it already holds this bet's changes; so repackaging, after a
   rejection or a stale package, never applies the delta twice. The drift check reads the same version.
2. Apply the delta: changed sections get the new text and a `Changed by:` line; removed sections are deleted;
   added requirements are appended as `<slug>.R<n>` with `Source:`. Local references inside the bet's text
   (`Validates: R1`, "as in R2") are rewritten to living IDs.
3. Write `.bridgie/spec/requirements.md` on the bet branch.
4. `packageDigest` adds the living spec file, so a later edit makes the package stale like any other spec change.
5. The package gets a **Spec changes** section: added, changed (old text, then new) and removed requirements.
6. If the base branch's current living spec differs from the bet's copy in a requirement this bet changes or
   removes, `accept` warns: "card-fees.R3 changed on main since this bet branched; merging bridgie/<slug> will
   need that section reconciled". No block: the owner merges the branch and git shows the conflict.

The updated file is on the bet branch and in the packaged commit, so it is part of what approvers sign, and it
reaches the base branch when the owner merges the branch (Bridgie never merges).

## 4. The AI drift check

New seat `accept/spec-checker` (loop accept, tier judgment, read-only, needs the repository).

- **When:** in `bridgie accept <slug>` before packaging, when the living spec has at least one requirement this
  bet does not add. Policy `living_spec: { drift_check: true }` (default true).
- **Inputs:** the living spec as it was before this bet, the bet's `requirements.md` (with its `Changes:` and
  `## Removed`), the diff of the whole bet against its base (code only, `.bridgie/` left out), read-only
  repository, gotchas.
- **Task:** for each earlier requirement, judge whether this bet's code change breaks it or makes its text untrue,
  where the bet did not declare that change. Point at code. Do not report requirements the bet declared, style,
  or things the reviewer already judged per task.
- **Output:** `seat-output.json` with `findings: [{ requirement, severity: blocker|major|minor, claim, file, line }]`
  (new schema `spec-check.json`). An unknown living ID in a finding is dropped with a warning.
- **Routing:** like the reviewer: another model family than the bet's builders when one is available. A model at
  its usage limit makes `accept` exit 3 with "waiting … until <time>", as `verify` does.
- **Reuse:** the result is stored with the feature commit and a digest of the living spec; `accept` reruns the
  check only when either changed.
- **Each blocker or major finding** becomes a decision `spec_drift`:
  context "card-fees.R3 may no longer hold: <claim> (<file>:<line>)", options
  - `amend the design`: the effect is the same as `bridgie shape <slug> --amend "<finding>"`. The design is
    re-opened; the shaper adds `Changes:` or restates the requirement; if that needs new work the existing
    `plan --replan` path adds tasks. This also covers "the code is wrong": the amendment states the old
    requirement must keep holding, and a task fixes it.
  - `still holds`: needs a reason (free text required).
  Minor findings go into the package without a decision.
- `accept` does not package while a `spec_drift` decision is pending. The package lists every finding and its
  answer under **Spec drift**.
- **Governance:** `drift_check` joins the signed rules; turning it off after signing is governance drift.

## 5. Commands

- `bridgie spec` — path of the living spec, number of requirements, how many bets it came from.
- `bridgie spec --seed` — builds it from every delivered bet, oldest acceptance first, applying each bet's
  `Changes:` and `## Removed` lines (a bet whose requirements have none adds them all). Refuses if the file
  exists. Writes and commits on the current branch.
- `bridgie doctor` — inside a project with delivered bets and no living spec: "no living spec; bridgie spec --seed".
- `help`, README (the loop table: `shape` and `accept` rows) and CHANGELOG are updated.

## 6. Code layout

- `runner/spec.mjs` (new, no dependencies): `parseLiving`, `parseDelta`, `checkDelta`, `applyDelta`,
  `renderLiving`, `seed`. Pure functions on text, plus thin file helpers.
- `runner/cmd/spec.mjs` (new): the `spec` command.
- `runner/cmd/shape.mjs`, `runner/flow.mjs` (`writeSpecFiles` calls `checkDelta`), `runner/cmd/accept.mjs`
  (drift check, merge, package sections), `runner/context.mjs` (`living_spec` input), `runner/state.mjs`
  (governance rule), `runner/doctor.mjs`, `policy/default.yaml`, `schemas/policy.json`,
  `schemas/spec-check.json`, `seats/accept/spec-checker/SKILL.md`, `seats/build/shaper/SKILL.md`,
  `templates/requirements.md`, `adapters/fake/fixtures` (spec-checker replies).

## 7. Tests

- Unit (`runner/spec.test.mjs`): parse and render round-trip; add, change, remove; local-to-living reference
  rewrite; every `checkDelta` refusal; applying twice is the same as once; seeding order.
- CLI (bats, fake adapter, `tests/26-living-spec.bats`): shape rejects a `Changes:` to an unknown ID; accept
  writes the merged living spec on the bet branch and the package lists the changes; the package goes stale if the
  living spec is edited; a drift finding blocks packaging until answered; `amend the design` re-opens the design;
  `still holds` without a reason is refused; the check is reused for the same commit; usage limit exits 3;
  `drift_check: false` after signing raises governance; `spec --seed` builds from two delivered bets and refuses a
  second time; the base-branch warning.

## Not in step 1

- One file per area. One file is enough until a project's spec is long; areas can come with OpenSpec export.
- Showing the living spec to the reviewer during `verify`.
- Editing the living spec by hand outside a bet.

## Step 2: OpenSpec import and export

Built after step 1, as its own change. One direction at a time; no live two-way sync, because two edited copies
of one spec drift apart.

### OpenSpec's format (checked 2026-11-24)

From the OpenSpec repository's README, `docs/concepts.md` and `docs/writing-specs.md` (MIT licence; the repo marks
these docs pages "legacy", and the current docs at openspec.dev were not read):

- Living specs: `openspec/specs/<domain>/spec.md`, one per domain. A spec has an H1 title, `## Purpose`,
  `## Requirements`; each requirement is `### Requirement: <name>` with a SHALL/MUST sentence, then
  `#### Scenario: <name>` blocks of `- GIVEN / - WHEN / - THEN / - AND` bullets (sometimes bold).
- Changes: `openspec/changes/<name>/` with `proposal.md`, `design.md`, `tasks.md`, optional `.openspec.yaml`, and
  delta specs `specs/<domain>/spec.md` with `## ADDED Requirements`, `## MODIFIED Requirements` (full new text),
  `## REMOVED Requirements` (with a line on why). Archive applies them and moves the change to
  `changes/archive/<date>-<name>/`.
- Not confirmed: how archive matches requirements (by the `### Requirement:` name is implied, not stated), and
  whether a RENAMED section exists. Both are checked against the current docs before step 2 is built.

### Import: `bridgie spec --seed --from <openspec dir>`

- Each `openspec/specs/<domain>/spec.md` requirement becomes a living requirement `<domain>.R<n>`, in file order,
  with `Name: <requirement name>`, the SHALL sentence and scenarios kept as written, `risk: none`, and
  `Source: openspec <domain>, imported <date>`. The domain's `## Purpose` is kept as a note at the top of its
  requirements.
- Form is `ubiquitous`; risk is `none`, because OpenSpec does not record either. The command says so and
  lists the imported IDs so the owner can raise risks by hand before the next bet.
- Open changes under `openspec/changes/` (not archived) are listed and not imported: they have not been accepted.
- Same refusal as `--seed`: not when a living spec exists.

### Export: `bridgie spec --export <dir>` (default `openspec`)

- Writes `<dir>/specs/<area>/spec.md` per area, where the area is the OpenSpec domain for imported requirements
  and the bet slug for the rest. Each requirement becomes `### Requirement: <Name, or the living ID>` with its
  text, its scenarios if it has any, and a last line `Bridgie: <living ID>, risk: <risk>`, so a later import
  keeps the IDs.
- Refuses when `<dir>/specs` exists, unless `--force`. Writes no `changes/`: Bridgie's bets are the changes.

### Tests (step 2)

Import from a fixture `openspec/` folder of two domains; export then import gives the same living spec; open
changes are listed and skipped; both refusals.
