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
