# Living spec and drift check — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project-wide living spec that each bet updates at accept through a declared delta, with an AI check
that older requirements still hold, decided by the owner (design: `docs/superpowers/specs/2026-11-24-living-spec-design.md`, step 1).

**Architecture:** A new dependency-free module `runner/spec.mjs` holds the text logic (parse, check, apply,
render, seed) and file helpers. `shape` snapshots the living spec beside the bet (`living-base.md`) and checks the
shaper's delta against it. `accept` runs a new read-only seat `verify/spec-checker` (loop verify, so it is routed
like the reviewer), turns serious findings into `spec_drift` decisions, waits for them, then writes the merged
living spec and adds runner-built sections to the acceptance body. A new `bridgie spec` command shows and seeds it.

**Tech stack:** Node 20+ ESM, no dependencies; `node --test` for units; bats for the CLI with the fake adapter.

**Deviations from the design, decided here:**
- The seat lives at `seats/verify/spec-checker` (design said accept/): the verify loop gets the reviewer's routing
  and the fake adapter's verifier vendor, which cross-family review needs.
- The base is a snapshot file, `.bridgie/specs/<slug>/living-base.md`, written at first shape, not
  `git show <branch point>`: tests run with `BRIDGIE_NO_COMMIT=1`, and a file works with or without commits.
- Meta lines read `Source: <slug> (<date>)` and `Changed by: <slug> (<date>)`; the date is the day the package
  was built (approval comes later, and the file is in the approved commit).
- The drift-check result is reused when a digest of (base living spec, bet requirements, bet diff) is unchanged,
  instead of the feature commit, which state commits move.

---

## File map

| File | Change |
|---|---|
| `runner/spec.mjs` | new: parseLiving, renderLiving, parseDelta, checkDelta, applyDelta, seed, changesMarkdown, file helpers |
| `runner/spec.test.mjs` | new: unit tests |
| `runner/flow.mjs` | writeSpecFiles checks the delta; requirementSections/planWarnings ignore `Changes:` and qualified IDs; packageDigest adds the living spec; spec_drift effect; answer() re-opens the design |
| `runner/context.mjs` | inputs `living_spec`, `living_base`, `bet_diff`, `drift_answers` |
| `runner/cli/git.mjs` | `betDiff`, `detachedWorktree` |
| `runner/cmd/shape.mjs` | snapshot before the shaper runs |
| `runner/cmd/accept.mjs` | drift check, wait, merge, base-branch warning, runner sections in the body |
| `runner/cmd/spec.mjs` | new: `bridgie spec [--seed]` |
| `runner/cmd/help.mjs`, `runner/doctor.mjs`, `runner/surface.mjs` | command line, seed hint, decision label |
| `runner/state.mjs` | governance rule `drift_check` |
| `schemas/decisions.json`, `schemas/seat.json`, `schemas/policy.json`, `schemas/spec-check.json` (new) | `spec_drift`, output `spec-check.json`, `living_spec` policy |
| `policy/default.yaml` | `living_spec: { drift_check: true }` |
| `seats/verify/spec-checker/SKILL.md` (new), `seats/build/shaper/SKILL.md`, `templates/requirements.md` | contracts |
| `adapters/fake/fixtures/spec-checker.json` (new) | no findings |
| `tests/26-living-spec.bats` (new) | CLI tests |
| `README.md`, `CHANGELOG.md`, `docs/agentic-landscape-2026-11.md`, design doc | docs |

---

### Task 1: `runner/spec.mjs` — text logic, test first

**Files:** create `runner/spec.mjs`, `runner/spec.test.mjs`.

- [ ] **Step 1: write the failing tests** (`runner/spec.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sp from './spec.mjs';

const LIVING = `# Living spec\n\nintro\n\n## card-fees.R1 · event · risk: money\nWHEN a customer pays by card\nTHE SYSTEM SHALL add a 2% fee.\nSource: card-fees (2026-11-20)\n\n## card-fees.R2 · ubiquitous · risk: none\nTHE SYSTEM SHALL show the fee.\nSource: card-fees (2026-11-20)\n\n## card-fees.P1 · property\nFor any payment the fee SHALL be at most 2%.\nValidates: card-fees.R1\nSource: card-fees (2026-11-20)\n`;
const BET = `# Requirements — Fee cap\n\n## R1 · event · risk: money\nChanges: card-fees.R1\nWHEN a customer pays by card\nTHE SYSTEM SHALL add a 2% fee, capped at 5.00.\n\n## R2 · event · risk: none\nWHEN the cap applies THE SYSTEM SHALL say so, as R1 and card-fees.R2 describe.\n\n## P1 · property\nFor any payment the fee SHALL be at most 5.00.\nValidates: R1\n\n## Removed\n- card-fees.R2: the receipt line replaces it.\n`;

test('parseLiving reads ids, headings, text and the runner lines; render round-trips', () => {
  const l = sp.parseLiving(LIVING);
  assert.deepEqual(l.map(r => r.id), ['card-fees.R1', 'card-fees.R2', 'card-fees.P1']);
  assert.equal(l[0].head, ' · event · risk: money');
  assert.deepEqual(l[0].text, ['WHEN a customer pays by card', 'THE SYSTEM SHALL add a 2% fee.']);
  assert.deepEqual(l[0].meta, ['Source: card-fees (2026-11-20)']);
  assert.deepEqual(sp.parseLiving(sp.renderLiving(l)), l);
  assert.deepEqual(sp.parseLiving(''), []);
});

test('parseDelta: Changes lines, Removed section, new requirements', () => {
  const d = sp.parseDelta(BET);
  assert.deepEqual(d.reqs.map(r => [r.local, r.changes]), [['R1', 'card-fees.R1'], ['R2', null], ['P1', null]]);
  assert.deepEqual(d.reqs[0].text, ['WHEN a customer pays by card', 'THE SYSTEM SHALL add a 2% fee, capped at 5.00.']);
  assert.deepEqual(d.removed, [{ id: 'card-fees.R2', reason: 'the receipt line replaces it.' }]);
  assert.deepEqual(d.errors, []);
});

test('checkDelta refuses unknown ids, double claims, missing reasons and malformed lines', () => {
  const l = sp.parseLiving(LIVING);
  assert.deepEqual(sp.checkDelta(sp.parseDelta(BET), l), []);
  const bad = sp.parseDelta(`## R1 · event · risk: none\nChanges: card-fees.R9\nx\n\n## R2 · event · risk: none\nChanges: card-fees.R1\ny\n\n## R3 · event · risk: none\nChanges: card-fees.R1\nz\n\n## Removed\n- card-fees.R1: gone\n- card-fees.P1:\nnot a bullet\n`);
  const errs = sp.checkDelta(bad, l).join('\n');
  assert.match(errs, /R1: "Changes: card-fees\.R9" names no requirement in the living spec/);
  assert.match(errs, /card-fees\.R1 is changed by R2 and changed by R3/);
  assert.match(errs, /card-fees\.R1 is changed by R2 and removed/);
  assert.match(errs, /card-fees\.P1 needs a reason/);
  assert.match(errs, /"not a bullet" is not "- <living id>: <reason>"/);
});

test('applyDelta: changes keep the id, removals go, new ones get <slug>.<id>, local references become living ids', () => {
  const res = sp.applyDelta(sp.parseLiving(LIVING), sp.parseDelta(BET), 'fee-cap', '2026-12-02');
  assert.deepEqual(res.reqs.map(r => r.id), ['card-fees.R1', 'card-fees.P1', 'fee-cap.R2', 'fee-cap.P1']);
  const r1 = res.reqs[0];
  assert.equal(r1.text[1], 'THE SYSTEM SHALL add a 2% fee, capped at 5.00.');
  assert.deepEqual(r1.meta, ['Source: card-fees (2026-11-20)', 'Changed by: fee-cap (2026-12-02)']);
  assert.equal(res.reqs[2].text[0], 'WHEN the cap applies THE SYSTEM SHALL say so, as card-fees.R1 and card-fees.R2 describe.');
  assert.equal(res.reqs[3].text[1], 'Validates: card-fees.R1');
  assert.deepEqual(res.reqs[3].meta, ['Source: fee-cap (2026-12-02)']);
  assert.deepEqual(res.added.map(r => r.id), ['fee-cap.R2', 'fee-cap.P1']);
  assert.deepEqual(res.changed.map(c => [c.id, c.local]), [['card-fees.R1', 'R1']]);
  assert.deepEqual(res.removed.map(x => x.id), ['card-fees.R2']);
  assert.match(sp.changesMarkdown(res), /Removed[\s\S]*card-fees\.R2: the receipt line replaces it\./);
});

test('applying to the same base twice gives the same file', () => {
  const base = sp.parseLiving(LIVING), d = sp.parseDelta(BET);
  assert.equal(sp.renderLiving(sp.applyDelta(base, d, 'fee-cap', '2026-12-02').reqs), sp.renderLiving(sp.applyDelta(base, d, 'fee-cap', '2026-12-02').reqs));
});

test('seed applies delivered bets oldest first; a bet whose delta does not fit is added whole, with a warning', () => {
  const first = `## R1 · event · risk: money\nWHEN a customer pays by card\nTHE SYSTEM SHALL add a 2% fee.\n\n## R2 · ubiquitous · risk: none\nTHE SYSTEM SHALL show the fee.\n`;
  const s = sp.seed([{ slug: 'card-fees', date: '2026-11-20', text: first }, { slug: 'fee-cap', date: '2026-12-02', text: BET }]);
  assert.deepEqual(s.reqs.map(r => r.id), ['card-fees.R1', 'fee-cap.R2', 'fee-cap.P1']);
  assert.deepEqual(s.warnings, []);
  const odd = sp.seed([{ slug: 'fee-cap', date: '2026-12-02', text: BET }]);
  assert.deepEqual(odd.reqs.map(r => r.id), ['fee-cap.R1', 'fee-cap.R2', 'fee-cap.P1']);
  assert.match(odd.warnings[0], /^fee-cap: /);
});
```

- [ ] **Step 2: run, expect failure** — `node --test runner/spec.test.mjs` → fails: cannot find module `./spec.mjs`.

- [ ] **Step 3: implement `runner/spec.mjs`**

```js
// The living spec: one project-wide file holding every requirement accepted so far.
// A bet states its changes in its own requirements.md: a requirement with "Changes: <living id>"
// replaces that one, "## Removed" lists living ids it ends, every other requirement is new.
// At accept the runner applies that delta to the living spec as it was when the bet was first shaped
// (living-base.md beside the bet's spec), so applying it again never doubles anything.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

export const livingPath = root => join(root, '.bridgie', 'spec', 'requirements.md');
export const basePath = (root, slug) => join(root, '.bridgie', 'specs', slug, 'living-base.md');
export const LIVING_ID = /^[a-z0-9][a-z0-9-]*\.[RP][0-9]+$/;
const META = /^(Source|Changed by|Name):/;
const HEADER = '# Living spec\n\nEvery requirement accepted so far, one section each. Bridgie writes this file when it packages a bet for acceptance (bridgie accept); change it through a bet, not by hand.\n';

const trimBlank = lines => { const a = [...lines]; while (a.length && !a[0].trim()) a.shift(); while (a.length && !a[a.length - 1].trim()) a.pop(); return a; };
const sections = text => String(text || '').replace(/\r\n/g, '\n').split(/^(?=## )/m).filter(s => s.startsWith('## '));

// parseLiving: [{ id, head, text, meta }] in file order. head follows the id on the heading
// (" · event · risk: money"); text is the requirement; meta the runner's Source/Changed by/Name lines.
export function parseLiving(text) {
  const out = [];
  for (const s of sections(text)) {
    const [first, ...rest] = s.split('\n');
    const m = first.match(/^## (\S+)(.*)$/);
    if (!m || !LIVING_ID.test(m[1])) continue;
    out.push({ id: m[1], head: m[2].trimEnd(), text: trimBlank(rest.filter(l => !META.test(l))), meta: rest.filter(l => META.test(l)) });
  }
  return out;
}

export function renderLiving(reqs) {
  return HEADER + reqs.map(r => `\n## ${r.id}${r.head}\n${[...r.text, ...r.meta].join('\n')}\n`).join('');
}

// parseDelta: a bet's requirements.md as { reqs: [{ local, head, text, changes }], removed: [{ id, reason }], errors }.
export function parseDelta(text) {
  const reqs = [], removed = [], errors = [];
  for (const s of sections(text)) {
    const [first, ...rest] = s.split('\n');
    const m = first.match(/^## ([RP][0-9]+)\b(.*)$/);
    if (m) {
      const ch = rest.map(l => l.match(/^Changes:\s*(.*?)\s*$/)).filter(Boolean);
      if (ch.length > 1) errors.push(`${m[1]}: more than one Changes: line`);
      reqs.push({ local: m[1], head: m[2].trimEnd(), text: trimBlank(rest.filter(l => !/^Changes:/.test(l))), changes: ch[0]?.[1] || null });
    } else if (/^## Removed\s*$/.test(first)) {
      for (const l of rest) {
        if (!l.trim()) continue;
        const r = l.match(/^\s*[-*]\s*([^\s:]+)\s*:\s*(.*?)\s*$/);
        if (r) removed.push({ id: r[1], reason: r[2] });
        else errors.push(`## Removed: "${l.trim()}" is not "- <living id>: <reason>"`);
      }
    }
  }
  return { reqs, removed, errors };
}

// checkDelta: every reason the delta cannot be applied to this living spec ([] when it can).
export function checkDelta(delta, living) {
  const have = new Set(living.map(r => r.id));
  const errs = [...delta.errors], seen = new Map();
  const claim = (id, by) => { if (seen.has(id)) errs.push(`${id} is ${seen.get(id)} and ${by}; a bet changes or removes a living requirement once`); else seen.set(id, by); };
  for (const r of delta.reqs) {
    if (!r.changes) continue;
    if (!have.has(r.changes)) errs.push(`${r.local}: "Changes: ${r.changes}" names no requirement in the living spec`);
    else claim(r.changes, `changed by ${r.local}`);
  }
  for (const x of delta.removed) {
    if (!have.has(x.id)) errs.push(`## Removed: ${x.id} is not in the living spec`);
    else if (!x.reason) errs.push(`## Removed: ${x.id} needs a reason`);
    else claim(x.id, 'removed');
  }
  return errs;
}

// applyDelta: the living spec after this bet. Changed requirements keep their id and gain a
// "Changed by" line; removed ones go; new ones are appended as <slug>.<local id>. References to the
// bet's own ids inside its text (Validates: R1, "as R2 says") become living ids.
export function applyDelta(living, delta, slug, date) {
  const map = Object.fromEntries(delta.reqs.map(r => [r.local, r.changes || `${slug}.${r.local}`]));
  const rewrite = lines => lines.map(l => l.replace(/(?<![\w.-])([RP][0-9]+)\b/g, (w, id) => map[id] || w));
  const gone = new Set(delta.removed.map(x => x.id));
  const byTarget = Object.fromEntries(delta.reqs.filter(r => r.changes).map(r => [r.changes, r]));
  const changed = [];
  const kept = living.filter(r => !gone.has(r.id)).map(r => {
    const c = byTarget[r.id];
    if (!c) return r;
    const next = { id: r.id, head: c.head, text: rewrite(c.text), meta: [...r.meta, `Changed by: ${slug} (${date})`] };
    changed.push({ id: r.id, local: c.local, before: r, after: next });
    return next;
  });
  const added = delta.reqs.filter(r => !r.changes).map(r => ({ id: `${slug}.${r.local}`, head: r.head, text: rewrite(r.text), meta: [`Source: ${slug} (${date})`] }));
  return { reqs: [...kept, ...added], added, changed, removed: delta.removed.filter(x => living.some(r => r.id === x.id)) };
}

// changesMarkdown: what this bet adds, changes and removes, for the acceptance package.
export function changesMarkdown(res) {
  if (!res.added.length && !res.changed.length && !res.removed.length) return 'This bet adds, changes and removes nothing in the living spec.';
  const one = r => r.text.join(' ').replace(/\s+/g, ' ').trim();
  const out = [];
  if (res.added.length) out.push('Added:', ...res.added.map(r => `- ${r.id}: ${one(r)}`), '');
  if (res.changed.length) out.push('Changed:', ...res.changed.flatMap(c => [`- ${c.id} (by ${c.local})`, `  - before: ${one(c.before)}`, `  - after: ${one(c.after)}`]), '');
  if (res.removed.length) out.push('Removed:', ...res.removed.map(x => `- ${x.id}: ${x.reason}`), '');
  return out.join('\n').trim();
}

// seed: the living spec from delivered bets, oldest first ([{ slug, date, text }]). A bet whose
// Changes/Removed lines do not fit what came before is added whole, with a warning.
export function seed(entries) {
  let reqs = [];
  const warnings = [];
  for (const e of entries) {
    const delta = parseDelta(e.text);
    const errs = checkDelta(delta, reqs);
    if (errs.length) {
      warnings.push(`${e.slug}: ${errs.join('; ')}; its Changes and Removed lines are ignored and its requirements added as new`);
      delta.reqs = delta.reqs.map(r => ({ ...r, changes: null }));
      delta.removed = [];
    }
    reqs = applyDelta(reqs, delta, e.slug, e.date).reqs;
  }
  return { reqs, warnings };
}

// ---------- files ----------
export const readLiving = root => existsSync(livingPath(root)) ? readFileSync(livingPath(root), 'utf8') : '';
export function writeLiving(root, reqs) {
  mkdirSync(dirname(livingPath(root)), { recursive: true });
  writeFileSync(livingPath(root), renderLiving(reqs));
}
// ensureBase: the living spec as it was when the bet was first shaped (copied then, kept after).
export function ensureBase(root, slug) {
  const f = basePath(root, slug);
  if (!existsSync(f)) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, readLiving(root)); }
  return readFileSync(f, 'utf8');
}
export function digest(...parts) {
  const h = createHash('sha256');
  for (const p of parts) { h.update(String(p ?? '')); h.update('\0'); }
  return h.digest('hex');
}
// mergeForBet: write the living spec this bet produces; returns what changed.
export function mergeForBet(root, slug, date) {
  const living = parseLiving(ensureBase(root, slug));
  const delta = parseDelta(readFileSync(join(root, '.bridgie', 'specs', slug, 'requirements.md'), 'utf8'));
  const errs = checkDelta(delta, living);
  if (errs.length) throw new Error(`the requirements of "${slug}" do not fit the living spec: ${errs.join('; ')}`);
  const res = applyDelta(living, delta, slug, date);
  writeLiving(root, res.reqs);
  return res;
}
```

- [ ] **Step 4: run** `node --test runner/spec.test.mjs` → all pass.
- [ ] **Step 5: commit** `git add runner/spec.mjs runner/spec.test.mjs && git commit -m "Living spec: parse, check, apply and seed requirement deltas"`

### Task 2: shape snapshots the base and checks the delta; plan checks ignore delta lines

**Files:** `runner/flow.mjs`, `runner/cmd/shape.mjs`, `runner/context.mjs`, `runner/flow.test.mjs`.

- [ ] **Step 1: failing unit tests** (append to `runner/flow.test.mjs`)

```js
test('writeSpecFiles refuses a delta that names a requirement the living spec does not have', () => {
  const root = project();
  mkdirSync(join(root, '.bridgie', 'spec'), { recursive: true });
  writeFileSync(join(root, '.bridgie', 'spec', 'requirements.md'), '# Living spec\n\n## old.R1 · event · risk: none\nTHE SYSTEM SHALL a.\nSource: old (2026-11-01)\n');
  const out = join(root, 'shape-out.json');
  const req = r => JSON.stringify({ seat: 'shaper', summary_md: 's', files: { 'requirements.md': r, 'design.md': '# D\n' } });
  writeFileSync(out, req('## R1 · event · risk: none\nChanges: old.R9\nTHE SYSTEM SHALL b.\n'));
  assert.throws(() => fl.writeSpecFiles(root, 'b', out), /names no requirement in the living spec/);
  writeFileSync(out, req('## R1 · event · risk: none\nChanges: old.R1\nTHE SYSTEM SHALL b.\n'));
  assert.deepEqual(fl.writeSpecFiles(root, 'b', out).ids, ['R1']);
  assert.match(readFileSync(join(root, '.bridgie', 'specs', 'b', 'living-base.md'), 'utf8'), /## old\.R1/);
});

test('plan warnings ignore Changes lines and living ids in requirement text', () => {
  const root = project();
  writeFileSync(join(root, '.bridgie', 'specs', 'b', 'requirements.md'), '## R1 · event · risk: none\nChanges: old.R2\nWHEN a THE SYSTEM SHALL b, as old.R2 said.\n\n## R2 · event · risk: none\nTHE SYSTEM SHALL c.\n\n## Removed\n- old.R1: gone, see R2\n');
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1']), T('T2', ['R2'])]));
  assert.deepEqual(fl.planWarnings(root, 'b'), []);
});
```

- [ ] **Step 2: run** `node --test runner/flow.test.mjs` → both fail.
- [ ] **Step 3: implement**
  - `runner/flow.mjs`: `import * as sp from './spec.mjs';`. In `writeSpecFiles`, after the `## R<n>` check:
    ```js
    const errs = sp.checkDelta(sp.parseDelta(req), sp.parseLiving(sp.ensureBase(root, slug)));
    if (errs.length) throw new Error(`requirements.md does not fit the living spec (.bridgie/spec/requirements.md): ${errs.join('; ')}`);
    ```
  - `requirementSections`: split on every `## ` heading and drop `Changes:` lines:
    ```js
    const parts = readFileSync(f, 'utf8').split(/^(?=## )/m);
    for (const p of parts) { const m = p.match(/^## ([RP][0-9]+)\b/); if (m) out[m[1]] = p.replace(/^Changes:.*\n?/gm, ''); }
    ```
  - `planWarnings`: `text.match(/(?<![\w.-])[RP][0-9]+\b/g)`.
  - `runner/cmd/shape.mjs`: `import * as sp from '../spec.mjs';` and `sp.ensureBase(root, slug);` right before `runSeat(slug, 'build/shaper', …)`.
  - `runner/context.mjs`: input `living_spec` →
    ```js
    if (name === 'living_spec') {
      const f = join(root, '.bridgie', 'specs', slug, 'living-base.md');
      const text = existsSync(f) ? readFileSync(f, 'utf8').trim() : '';
      return { label: 'living spec: every requirement accepted before this bet (read-only; say what you change with Changes: and ## Removed)', text: text || '(none yet: no bet has been accepted with a living spec)' };
    }
    ```
- [ ] **Step 4: run** `node --test` → all pass.
- [ ] **Step 5: commit** "Shape: snapshot the living spec and check the bet's delta against it".

### Task 3: contracts — shaper, template, spec-checker seat, schemas, policy, fixture

**Files:** `seats/build/shaper/SKILL.md`, `templates/requirements.md`, `seats/verify/spec-checker/SKILL.md` (new),
`schemas/spec-check.json` (new), `schemas/seat.json`, `schemas/decisions.json`, `schemas/policy.json`,
`policy/default.yaml`, `adapters/fake/fixtures/spec-checker.json` (new).

- [ ] **Step 1:** shaper manifest `inputs: [bet, living_spec?, requirements?, design?, gotchas, repo_readonly, agents_md]`; add to Judgment criteria:
  "- Read the living spec first. A requirement that alters one there carries `Changes: <living id>` on the line under its heading; one there that this bet ends goes under `## Removed` as `- <living id>: <reason>`. Do not restate living requirements the bet leaves alone."
  Add the same two rules to the output contract paragraph for `requirements.md`.
- [ ] **Step 2:** `templates/requirements.md`: after the "Tag each with risk" line add
  "A requirement that changes one in the living spec (.bridgie/spec/requirements.md) has `Changes: <id>` under its heading; living requirements this bet ends are listed under `## Removed`." and append an example `## Removed` section with `- <slug>.R<n>: <reason>` commented as optional.
- [ ] **Step 3:** `seats/verify/spec-checker/SKILL.md`:
  ```markdown
  ---
  name: spec-checker
  description: Read-only check, before acceptance, that a bet's whole change leaves every earlier requirement in the living spec true, or says it changes it.
  loop: verify
  tier: judgment
  inputs: [living_base, requirements, bet_diff, repo_readonly, gotchas, drift_answers?]
  writes: run_dir
  tools: [read, grep]
  output: spec-check.json
  stop_when: ["the diff is empty"]
  ---

  ## Role
  You protect requirements that earlier bets delivered. The living spec lists them; the bet's requirements say which it changes (`Changes:`) and removes (`## Removed`). For every other living requirement, judge whether this bet's code change breaks it or makes its text untrue. You read the repository and never change it.

  ## Judgment criteria
  - Only living requirements the bet does not change or remove are in scope; the bet's own requirements were reviewed task by task.
  - A finding points at the code: file and line in the diff or the repository, and what now happens instead of what the requirement says.
  - blocker: the requirement is now false on a normal path. major: false on an edge the requirement names, or its text no longer describes the code. minor: wording drift with no behaviour change.
  - Not findings: style, missing tests, things the requirement does not say.
  - An earlier answer "still holds" with a reason (drift answers) settles that finding; raise it again only with new code.

  ## Output contract
  `spec-check.json`: `findings` (empty when nothing drifts), each with the living `requirement` id, `severity`, `claim`, `file`, `line`; `summary_md` one line.

  ## Stop conditions
  Stop with no findings if the diff is empty.
  ```
- [ ] **Step 4:** `schemas/spec-check.json`:
  ```json
  {
    "type": "object",
    "required": ["seat", "summary_md", "findings"],
    "additionalProperties": false,
    "properties": {
      "seat": { "type": "string" },
      "summary_md": { "type": "string" },
      "findings": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["requirement", "severity", "claim"],
          "additionalProperties": false,
          "properties": {
            "requirement": { "type": "string" },
            "severity": { "type": "string", "enum": ["blocker", "major", "minor"] },
            "claim": { "type": "string" },
            "file": { "type": ["string", "null"] },
            "line": { "type": ["integer", "null"] }
          }
        }
      }
    }
  }
  ```
  `schemas/seat.json` output enum += `"spec-check.json"`; `schemas/decisions.json` type enum += `"spec_drift"`;
  `schemas/policy.json` properties += `"living_spec": { "type": "object", "additionalProperties": false, "properties": { "drift_check": { "type": "boolean" } } }`;
  `policy/default.yaml` after `acceptance:` add the comment and `living_spec: { drift_check: true }`.
  Fixture `adapters/fake/fixtures/spec-checker.json`: `{ "seat": "spec-checker", "summary_md": "No earlier requirement drifts.", "findings": [] }`.
- [ ] **Step 5:** `node --test && bats tests/` → all pass (no behaviour uses these yet). Commit "Contracts for the living spec: shaper rules, spec-checker seat, schemas, policy".

### Task 4: accept — drift check, decisions, merge, package sections

**Files:** `runner/cli/git.mjs`, `runner/context.mjs`, `runner/flow.mjs`, `runner/cmd/accept.mjs`, `runner/state.mjs`, `runner/surface.mjs`, `tests/26-living-spec.bats` (new).

- [ ] **Step 1: failing CLI tests** (`tests/26-living-spec.bats`):

```bash
#!/usr/bin/env bats
load helpers

setup() {
  export BRIDGIE_ADAPTER=fake BRIDGIE_FAKE_SCRIPT="$BRIDGIE_HOME/tests/fixtures/fake-script-implement.sh"
  P="$(make_project --git)"
  D="$(mktemp -d)"; cp "$BRIDGIE_HOME"/adapters/fake/fixtures/*.json "$D"/
  export BRIDGIE_FAKE_DIR="$D"
}

living() {   # living <project>: a living spec with one earlier requirement, as if a bet "old" was accepted
  mkdir -p "$1/.bridgie/spec"
  printf '# Living spec\n\n## old.R1 · event · risk: none\nWHEN a refund is made THE SYSTEM SHALL record it.\nSource: old (2026-11-01)\n\n## old.R2 · ubiquitous · risk: none\nTHE SYSTEM SHALL show refunds.\nSource: old (2026-11-01)\n' > "$1/.bridgie/spec/requirements.md"
}
shaper_with() {   # shaper_with <extra requirements text>: the fake shaper's requirements gain this text
  node -e 'const f=process.argv[1];const o=JSON.parse(require("fs").readFileSync(f,"utf8"));o.files["requirements.md"]+=process.argv[2];require("fs").writeFileSync(f,JSON.stringify(o))' "$D/shaper.json" "$1"
}
drift_finding() {   # the spec-checker reports one major finding on old.R1
  printf '{"seat":"spec-checker","summary_md":"one","findings":[{"requirement":"old.R1","severity":"major","claim":"refunds are no longer recorded","file":"feature-1.txt","line":1}]}' > "$D/spec-checker.json"
}
to_accept() {   # signed → shaped → approved → built and verified, ready to package
  signed_bet "$P" b
  (cd "$P" && bridgie shape b && bridgie shape b --approve && bridgie plan b && bridgie build b && bridgie verify b && bridgie build b && bridgie verify b) >/dev/null 2>&1
}

@test "the first accepted bet starts the living spec, and the package lists what it added" {
  to_accept
  run bash -c "cd '$P' && bridgie accept b"
  [ "$status" -eq 0 ]
  grep -q '^## b.R1 · event · risk: none' "$P/.bridgie/spec/requirements.md"
  grep -q '^Source: b (' "$P/.bridgie/spec/requirements.md"
  grep -q '^## Spec changes' "$P/.bridgie/acceptance/b.md"
  grep -q 'b.R2' "$P/.bridgie/acceptance/b.md"
  [ ! -d "$P/.bridgie/runs/b/spec-checker-01" ]   # nothing earlier to check
}

@test "shape rejects a Changes line that names no living requirement" {
  living "$P"; shaper_with $'\n## R3 · event · risk: none\nChanges: old.R9\nTHE SYSTEM SHALL x.\n'
  signed_bet "$P" b
  run bash -c "cd '$P' && bridgie shape b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"names no requirement in the living spec"* ]]
}

@test "a bet that changes and removes living requirements: the merged spec keeps ids, drops removals, and repackaging does not apply it twice" {
  living "$P"; shaper_with $'\n## Removed\n- old.R2: replaced by R1.\n'
  node -e 'const f=process.argv[1];const o=JSON.parse(require("fs").readFileSync(f,"utf8"));o.files["requirements.md"]=o.files["requirements.md"].replace("## R1 · event · risk: none\n","## R1 · event · risk: none\nChanges: old.R1\n");require("fs").writeFileSync(f,JSON.stringify(o))' "$D/shaper.json"
  to_accept
  run bash -c "cd '$P' && bridgie accept b"
  [ "$status" -eq 0 ]
  L="$P/.bridgie/spec/requirements.md"
  grep -q '^## old.R1' "$L"
  grep -q '^Changed by: b (' "$L"
  ! grep -q '^## old.R2' "$L"
  grep -q '^## b.R2' "$L"
  grep -q 'old.R2: replaced by R1.' "$P/.bridgie/acceptance/b.md"
  cp "$L" "$BATS_TEST_TMPDIR/once"
  bash -c "cd '$P' && bridgie accept b --reject 'again' && bridgie accept b" >/dev/null 2>&1
  cmp -s "$L" "$BATS_TEST_TMPDIR/once"
}

@test "a drift finding waits for the owner; still holds needs a reason and lets the package through" {
  living "$P"; drift_finding; to_accept
  run bash -c "cd '$P' && bridgie accept b"
  [ "$status" -eq 3 ]
  [[ "$output" == *"spec drift"* ]]
  [ ! -f "$P/.bridgie/acceptance/b.md" ]
  id="$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).decisions.find(x=>x.type==="spec_drift"&&x.status==="pending");console.log(d.id)' "$P/.bridgie/decisions/b.json")"
  run bash -c "cd '$P' && bridgie decide b $id 'still holds'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"reason"* ]]
  bash -c "cd '$P' && bridgie decide b $id 'still holds' --text 'refunds are recorded by the ledger'" >/dev/null 2>&1
  run bash -c "cd '$P' && bridgie accept b"
  [ "$status" -eq 0 ]
  [ "$(ls -d "$P"/.bridgie/runs/b/spec-checker-* | wc -l | tr -d ' ')" = 1 ]   # the result was reused
  grep -q '^## Spec drift' "$P/.bridgie/acceptance/b.md"
  grep -q 'refunds are recorded by the ledger' "$P/.bridgie/acceptance/b.md"
}

@test "amend the design re-opens the design with the finding" {
  living "$P"; drift_finding; to_accept
  bash -c "cd '$P' && bridgie accept b" >/dev/null 2>&1 || true
  id="$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).decisions.find(x=>x.type==="spec_drift"&&x.status==="pending");console.log(d.id)' "$P/.bridgie/decisions/b.json")"
  run bash -c "cd '$P' && bridgie decide b $id 'amend the design'"
  [ "$status" -eq 0 ]
  [ "$(node "$BRIDGIE_HOME/runner/flow.mjs" design-approved "$P" b)" = false ]
  grep -q 'refunds are no longer recorded' "$P/.bridgie/decisions/b.json"
}

@test "a spec-checker at its usage limit makes accept wait, with nothing changed" {
  living "$P"; to_accept
  node -e 'const f=process.argv[1];const s={};s["fake"]={until:new Date(Date.now()+3600e3).toISOString()};require("fs").writeFileSync(f,JSON.stringify(s))' "$P/.bridgie/.adapter-state.json"
  run bash -c "cd '$P' && bridgie accept b"
  [ "$status" -eq 3 ]
  [[ "$output" == *"waiting"* ]]
  [ ! -f "$P/.bridgie/acceptance/b.md" ]
}

@test "drift_check off skips the check; turning it off after signing is governance drift" {
  living "$P"; drift_finding
  signed_bet "$P" b
  printf 'living_spec: { drift_check: false }\n' >> "$P/.bridgie/policy.yaml"
  run node "$BRIDGIE_HOME/runner/flow.mjs" governance-gate "$P" b
  [[ "$output" == D* ]]
}

@test "the package goes stale when the living spec is edited after packaging" {
  to_accept
  bash -c "cd '$P' && bridgie accept b" >/dev/null 2>&1
  echo "edited" >> "$P/.bridgie/spec/requirements.md"
  run bash -c "cd '$P' && bridgie accept b --approve"
  [ "$status" -ne 0 ]
  [[ "$output" == *"stale"* ]]
}
```

  (The usage-limit test writes the adapter-state file in the format `st.exhaustedUntil` reads; check that
  format in `runner/state.mjs` and adjust the test's JSON before running it.)

- [ ] **Step 2: run** `bats tests/26-living-spec.bats` → fail.
- [ ] **Step 3: implement**
  - `runner/cli/git.mjs`:
    ```js
    // betDiff: the whole bet's code change since it branched (three dots: the base's later commits are not in it).
    export const betDiff = (root, base, slug) => git(['-C', root, 'diff', `${base}...${featureBranch(slug)}`, ...EXCLUDE]).out;
    export function detachedWorktree(root, ref, path) {
      if (existsSync(path)) removeWorktree(root, path);
      mkdirSync(dirname(path), { recursive: true });
      gitOrDie(['-C', root, 'worktree', 'add', '-q', '--detach', path, ref]);
      return path;
    }
    ```
  - `runner/context.mjs` inputs: `living_base` → `runDir/living-base.md` ("the living spec before this bet");
    `bet_diff` → `runDir/bet-diff.patch`; `drift_answers` → `runDir/drift-answers.md` (optional).
  - `runner/state.mjs` `governanceRules`: `drift_check: policy.living_spec?.drift_check !== false`;
    `governanceDrift`: `if (s.drift_check && now.drift_check === false) out.push('the living-spec drift check at accept was turned off');`
  - `runner/flow.mjs`:
    - `packageDigest`: `add('living-spec', sp.livingPath(root));`
    - `effectFor`: `if (d.type === 'spec_drift') { if (answer === 'still holds' && !text) throw new Error('"still holds" needs the reason (--text)'); return answer === 'amend the design' ? \`the design is re-opened; re-run bridgie shape ${slug}\` : \`still holds: ${text}\`; }`
    - `answer()`: after saving, when `d.type === 'spec_drift' && ans === 'amend the design'`, add an `approve_design`
      decision and answer it `request changes` with text `Spec drift: ${d.context}${opts.text ? \` Owner: ${opts.text}\` : ''}` (as `shape --amend` does).
    - `driftAnswers(root, slug)`: answered `spec_drift` decisions as markdown lines, for the seat and the package.
  - `runner/cmd/accept.mjs` packaging path, after `g.onFeature`:
    1. `const check = await driftCheck(root, slug, base)` (below); if any `spec_drift` is pending →
       `waitHuman(\`accept: ${n} spec drift finding(s) for you to decide first: bridgie open ${slug}\`)`.
    2. `const merged = sp.mergeForBet(root, slug, today())` (die on error with the message).
    3. Base-branch warning: `git show ${base}:.bridgie/spec/requirements.md`; for each changed/removed id whose
       text there differs from `living-base.md`, log the warning and keep it for the package.
    4. Packet gets `## Living spec` with `sp.changesMarkdown(merged)`; after the packager, the body gets
       `## Spec changes` (changesMarkdown + warnings) and, when the check ran, `## Spec drift` (each finding with
       severity, and the answer for the serious ones) appended by the runner.
    `driftCheck`:
    ```js
    async function driftCheck(root, slug, base) {
      if (st.loadPolicy(root).living_spec?.drift_check === false) return null;
      const baseText = sp.ensureBase(root, slug), living = sp.parseLiving(baseText);
      const reqText = readFileSync(join(root, '.bridgie', 'specs', slug, 'requirements.md'), 'utf8');
      const delta = sp.parseDelta(reqText);
      const declared = new Set([...delta.reqs.map(r => r.changes).filter(Boolean), ...delta.removed.map(x => x.id)]);
      const earlier = living.filter(r => !declared.has(r.id)).map(r => r.id);
      if (!earlier.length) return null;
      const diff = g.betDiff(root, base, slug);
      const key = sp.digest(baseText, reqText, diff);
      const cacheFile = join(root, '.bridgie', 'specs', slug, 'spec-check.json');
      const cached = existsSync(cacheFile) ? st.readJson(cacheFile) : null;
      if (cached?.key === key) return cached;
      const packet = mkdtempSync(join(tmpdir(), 'bridgie-spec-check-'));
      const wt = join(root, '.bridgie', 'worktrees', slug, 'spec-check');
      let runDir, failure = null;
      try {
        writeFileSync(join(packet, 'living-base.md'), baseText);
        writeFileSync(join(packet, 'bet-diff.patch'), diff);
        const answers = fl.driftAnswers(root, slug); if (answers) writeFileSync(join(packet, 'drift-answers.md'), answers);
        g.detachedWorktree(root, `bridgie/${slug}`, wt);
        const producer = fl.loadTasks(root, slug).tasks.map(t => fl.producerVendor(root, slug, t.id)).find(Boolean) || '';
        try { runDir = await runSeat(slug, 'verify/spec-checker', { root, cwd: wt, packet, needsRepo: true, avoidVendor: fl.crossFamily(root, slug) ? producer : '' }); } catch (e) { failure = e; }
        const dirty = git(['-C', wt, 'status', '--porcelain']).out.trim();
        g.removeWorktree(root, wt);
        if (failure?.code === 3) die(`${failure.message}\naccept: the living-spec check did not run; nothing was packaged`, 3);
        if (failure) die(`${failure.message}\naccept: the living-spec check failed; nothing was packaged`);
        if (dirty) die('accept: the spec-checker modified its read-only worktree; its result is discarded');
      } finally { rmSync(packet, { recursive: true, force: true }); }
      const out = st.readJson(join(runDir, 'spec-check.json'));
      const findings = out.findings.filter(f => { if (earlier.includes(f.requirement)) return true; log(`spec-checker named ${f.requirement}, which is not an earlier living requirement; ignored`); return false; });
      for (const d of st.loadDecisions(root, slug).decisions.filter(x => x.type === 'spec_drift' && x.status !== 'answered')) st.supersedeDecision(root, slug, d.id, 'superseded: the check ran again');
      const run = rel(root, runDir);
      for (const f of findings.filter(x => x.severity !== 'minor'))
        st.addDecision(root, slug, { type: 'spec_drift', allow_free_text: true, raised_by: { seat: 'spec-checker', run },
          context: `${f.requirement} may no longer hold (${f.severity}): ${f.claim}${f.file ? ` (${f.file}:${f.line ?? '?'})` : ''}. Amend the design so the bet changes or keeps it, or say why it still holds.`,
          options: ['amend the design', 'still holds'] });
      const rec = { key, run, at: st.now(), findings };
      st.writeJsonAtomic(cacheFile, rec);
      stateCommit(root, `accept ${slug}: living-spec check`);
      return rec;
    }
    ```
    (Check `st.writeJsonAtomic`'s third argument is an optional schema name, and `rel` is exported by `cli/core.mjs`.)
  - `runner/surface.mjs`: `LABEL.spec_drift = 'Spec drift'`; `CLI.spec_drift = (slug, d) => [\`bridgie decide ${slug} ${d.id} "amend the design"\`, \`bridgie decide ${slug} ${d.id} "still holds" --text "<why>"\`]`; `TEXT_HINT['still holds'] = 'why it still holds'`.
- [ ] **Step 4: run** `bats tests/26-living-spec.bats && bash tests/run.sh` → all pass.
- [ ] **Step 5: commit** "Accept: AI drift check against the living spec, owner decisions, merge into the living spec".

### Task 5: `bridgie spec [--seed]`, doctor hint, help

**Files:** `runner/cmd/spec.mjs` (new), `runner/cmd/help.mjs`, `runner/doctor.mjs`, `tests/26-living-spec.bats`.

- [ ] **Step 1: failing tests** (append):

```bash
@test "spec --seed builds the living spec from delivered bets, oldest first, and refuses a second time" {
  run bash -c "cd '$P' && bridgie init >/dev/null 2>&1; bridgie spec"
  [[ "$output" == *"no living spec yet"* ]]
  for s in one two; do
    mkdir -p "$P/.bridgie/specs/$s"
    bash -c "cd '$P' && bridgie bet new $s --title $s" >/dev/null 2>&1
    node "$BRIDGIE_HOME/runner/state.mjs" fm-set "$P/.bridgie/bets/$s/bet.md" status '"delivered"' --schema bet
  done
  printf '## R1 · event · risk: none\nTHE SYSTEM SHALL a.\n' > "$P/.bridgie/specs/one/requirements.md"
  printf '## R1 · event · risk: none\nChanges: one.R1\nTHE SYSTEM SHALL b.\n' > "$P/.bridgie/specs/two/requirements.md"
  mkdir -p "$P/.bridgie/acceptance"
  printf -- '---\ndecided_at: 2026-11-01T00:00:00Z\n---\n' > "$P/.bridgie/acceptance/one.md"
  printf -- '---\ndecided_at: 2026-11-05T00:00:00Z\n---\n' > "$P/.bridgie/acceptance/two.md"
  run bash -c "cd '$P' && bridgie doctor"
  [[ "$output" == *"bridgie spec --seed"* ]]
  run bash -c "cd '$P' && bridgie spec --seed"
  [ "$status" -eq 0 ]
  grep -q '^THE SYSTEM SHALL b.' "$P/.bridgie/spec/requirements.md"
  grep -q '^Changed by: two (2026-11-05)' "$P/.bridgie/spec/requirements.md"
  run bash -c "cd '$P' && bridgie spec"
  [[ "$output" == *"1 requirement"* ]]
  run bash -c "cd '$P' && bridgie spec --seed"
  [ "$status" -ne 0 ]
}
```

- [ ] **Step 2:** run → fails (unknown command).
- [ ] **Step 3: implement** `runner/cmd/spec.mjs`:

```js
// bridgie spec [--seed] — the living spec: every requirement accepted so far (.bridgie/spec/requirements.md).
// --seed builds it from the bets already delivered, oldest acceptance first.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as st from '../state.mjs';
import * as sp from '../spec.mjs';
import { die, log, parseArgs, projectRoot, rel, stateCommit } from '../cli/core.mjs';

export function deliveredSpecs(root) {
  return st.listBets(root).filter(s => ['delivered', 'evaluated'].includes(st.readFm(st.betPath(root, s)).data.status))
    .map(s => {
      const req = join(root, '.bridgie', 'specs', s, 'requirements.md'), acc = join(root, '.bridgie', 'acceptance', `${s}.md`);
      const at = existsSync(acc) ? String(st.readFm(acc).data.decided_at || '') : '';
      return existsSync(req) ? { slug: s, date: at.slice(0, 10) || 'date unknown', at, text: readFileSync(req, 'utf8') } : null;
    }).filter(Boolean).sort((a, b) => a.at.localeCompare(b.at) || a.slug.localeCompare(b.slug));
}

export default async function spec(argv) {
  const a = parseArgs(argv, { seed: 'bool' }, 'spec');
  const root = projectRoot();
  const f = sp.livingPath(root);
  if (a.seed) {
    if (existsSync(f)) die(`spec: ${rel(root, f)} already exists; it is updated at each accept`);
    const bets = deliveredSpecs(root);
    if (!bets.length) die('spec: no delivered bet with requirements to seed from');
    const { reqs, warnings } = sp.seed(bets);
    sp.writeLiving(root, reqs);
    for (const w of warnings) log(`warning: ${w}`);
    stateCommit(root, 'spec: seeded the living spec');
    log(`seeded ${rel(root, f)}: ${reqs.length} requirement(s) from ${bets.length} delivered bet(s) (${bets.map(b => b.slug).join(', ')}). Review it, then commit`);
    return;
  }
  if (!existsSync(f)) { log(`no living spec yet. It is written when a bet is packaged for acceptance${deliveredSpecs(root).length ? '; bridgie spec --seed builds one from the bets already delivered' : ''}`); return; }
  const reqs = sp.parseLiving(readFileSync(f, 'utf8'));
  const from = new Set(reqs.map(r => r.id.split('.')[0]));
  log(`${rel(root, f)}: ${reqs.length} requirement${reqs.length === 1 ? '' : 's'} from ${from.size} bet${from.size === 1 ? '' : 's'}`);
}
```

  Doctor (inside the project block): `if (!existsSync(sp.livingPath(root)) && st.listBets(root).some(s => ['delivered','evaluated'].includes(st.readFm(st.betPath(root, s)).data.status))) warn('no living spec, but bets were delivered: bridgie spec --seed builds one from them');`
  Help: under Build, `spec [--seed]           the living spec: every accepted requirement; --seed builds it from delivered bets`.
- [ ] **Step 4:** run the bats file and `bash tests/run.sh` → green.
- [ ] **Step 5:** commit "bridgie spec: show and seed the living spec; doctor suggests seeding".

### Task 6: docs and version

- [ ] README: loop table rows for `shape` (checks the bet's changes against the living spec) and `accept`
  (drift check, living spec merged, Spec changes and Spec drift in the package); a "Living spec" paragraph under
  Long runs or its own short section; Layout row for `runner/spec.mjs`; Status "Next" line.
- [ ] CHANGELOG: `## Unreleased` with Living spec, Drift check, `bridgie spec`, Upgrading (first accept creates
  `.bridgie/spec/requirements.md`; `bridgie spec --seed` for delivered bets; `drift_check` joins the signed rules).
- [ ] `docs/agentic-landscape-2026-11.md`: Living specs row → "On par (step 1 of item 7 done)"; item 7 marked done.
- [ ] Design doc: note the four deviations at the top of this plan.
- [ ] `bash tests/run.sh` → ALL GREEN. Commit "Docs: living spec and drift check".

---

## Self-review

- Spec coverage: §1 living file (T1, T4), §2 delta + shaper (T1, T2, T3), §3 merge at accept, digest, package,
  base warning (T4), §4 AI drift check, decisions, reuse, usage limit, governance (T3, T4), §5 commands and doctor
  (T5), §6 layout (all), §7 tests (T1, T2, T4, T5). Step 2 (OpenSpec) is a separate plan.
- Names used across tasks: `ensureBase`, `parseLiving`, `parseDelta`, `checkDelta`, `applyDelta`,
  `changesMarkdown`, `mergeForBet`, `seed`, `digest`, `livingPath`, `basePath`, `driftAnswers`, `betDiff`,
  `detachedWorktree` — each defined in the task that introduces it.
