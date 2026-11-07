// Single writer for Bridgie project state. Everything under <root>/.bridgie is
// read and written through this module. Importable (surface.mjs) and a CLI.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as yparse, splitFrontmatter, joinFrontmatter } from './yaml.mjs';
import { validate, assertValid } from './schema.mjs';

export const HOME = process.env.BRIDGIE_HOME || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const CONFIDENCE = ['opinion', 'anecdote', 'data', 'test'];
export const RISK_ORDER = ['none', 'ux', 'data', 'infra', 'security', 'money'];
export const maxRisk = (a, b) => (RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b);

// ---------- seat lock ----------
// While an agent (seat) runs, Bridgie state is read-only for everyone but that run's own directory,
// so a human decision is refused with a clear message instead of being rolled back as tampering
// (finding 4). The runner takes the lock in run_seat (runner/lib/seat.sh).
const LOCK_STALE_MS = 6 * 3600 * 1000;
export function seatLock(root) {
  const dir = join(root, '.bridgie', '.seat-lock');
  if (!existsSync(dir)) return null;
  let o;
  try { o = readJson(join(dir, 'owner.json')); } catch { o = { seat: 'unknown', since: statSync(dir).mtime.toISOString(), run_dir: null }; }
  if (Date.now() - Date.parse(o.since) > LOCK_STALE_MS) return null;   // a crashed run cannot lock state forever
  return o;
}
function assertUnlocked(file) {
  const p = resolve(file).split(sep).join('/');
  const i = p.lastIndexOf('/.bridgie/');
  if (i < 0) return;
  const root = p.slice(0, i);
  const lock = seatLock(root);
  if (!lock || (lock.run_dir && p.startsWith(`${root}/${lock.run_dir}/`))) return;
  throw new Error(`an agent run is in progress (seat ${lock.seat}, since ${lock.since}); Bridgie state is read-only until it finishes, so nothing was changed. Try again when it finishes. If no agent is running, delete ${root}/.bridgie/.seat-lock`);
}

// ---------- files ----------
export function loadSchema(name) { return JSON.parse(readFileSync(join(HOME, 'schemas', `${name}.json`), 'utf8')); }
export function readJson(file) { return JSON.parse(readFileSync(file, 'utf8')); }
export function writeJsonAtomic(file, obj, schemaName) {
  assertUnlocked(file);
  if (schemaName) assertValid(loadSchema(schemaName), obj, file);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  renameSync(tmp, file);
  return file;
}
export function readFm(file) { return splitFrontmatter(readFileSync(file, 'utf8')); }
export function writeFm(file, data, body, schemaName) {
  assertUnlocked(file);
  if (schemaName) assertValid(loadSchema(schemaName), data, file);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, joinFrontmatter(data, body));
  renameSync(tmp, file);
  return file;
}
export function setFm(file, patch, schemaName) {
  const { data, body } = readFm(file);
  return writeFm(file, { ...data, ...patch }, body, schemaName);
}
export function now() { return new Date().toISOString(); }
export function today() { return now().slice(0, 10); }

// ---------- paths ----------
export const stateDir = root => join(root, '.bridgie');
export const betPath = (root, slug) => join(root, '.bridgie', 'bets', slug, 'bet.md');
export const decisionsPath = (root, slug) => join(root, '.bridgie', 'decisions', `${slug}.json`);
export const tasksPath = (root, slug) => join(root, '.bridgie', 'specs', slug, 'tasks.json');
export const runsDir = (root, slug) => join(root, '.bridgie', 'runs', slug);
export function listBets(root) {
  const d = join(root, '.bridgie', 'bets');
  if (!existsSync(d)) return [];
  return readdirSync(d).filter(s => existsSync(betPath(root, s))).sort();
}

// ---------- policy ----------
function deepMerge(a, b) {
  if (Array.isArray(a) || Array.isArray(b) || typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return b === undefined ? a : b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? deepMerge(out[k], v) : v;
  return out;
}
export function loadPolicy(root) {
  const def = yparse(readFileSync(join(HOME, 'policy', 'default.yaml'), 'utf8'));
  // default ← user (~/.bridgie/policy.yaml or $BRIDGIE_USER_POLICY, e.g. model routing per machine) ← project
  const uf = process.env.BRIDGIE_USER_POLICY || join(homedir(), '.bridgie', 'policy.yaml');
  const user = existsSync(uf) ? yparse(readFileSync(uf, 'utf8')) : {};
  const pf = join(root, '.bridgie', 'policy.yaml');
  const proj = existsSync(pf) ? yparse(readFileSync(pf, 'utf8')) : {};
  const merged = deepMerge(deepMerge(def, user), proj);
  assertValid(loadSchema('policy'), merged, 'policy');
  return merged;
}
export function lanePolicy(policy, lane, risk) {
  const l = policy.lanes[lane] || {};
  const r = (l.by_risk || {})[risk] || {};
  return { ...l, ...r, by_risk: undefined };
}

// ---------- markdown body helpers ----------
export function appendToSection(body, heading, line) {
  const h = `## ${heading}`;
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(l => l.trim() === h);
  if (start < 0) {
    const trimmed = body.replace(/\s+$/, '');
    return `${trimmed}\n\n${h}\n\n${line}\n`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^## /.test(lines[i])) { end = i; break; }
  // insert before trailing blank lines of the section
  let ins = end;
  while (ins > start + 1 && lines[ins - 1].trim() === '') ins--;
  lines.splice(ins, 0, line);
  if (ins === start + 1) lines.splice(ins, 0, '');  // blank line after heading
  return lines.join('\n').replace(/\n*$/, '\n');
}

// ---------- bets ----------
export function betNew(root, slug, opts = {}) {
  if (!SLUG.test(slug)) throw new Error(`invalid slug "${slug}": lowercase letters, digits, hyphens`);
  const file = betPath(root, slug);
  if (existsSync(file)) throw new Error(`bet "${slug}" already exists at ${file}`);
  const tpl = readFileSync(join(HOME, 'templates', 'bet.md'), 'utf8');
  const { body } = splitFrontmatter(tpl);
  const data = {
    id: slug, title: opts.title || slug, lane: opts.lane || 'engineering', risk: opts.risk || 'none',
    owner: opts.owner || 'unknown', status: 'draft', confidence: 'opinion',
    appetite: { time: '2w', tokens_usd: 20 }, kill_criteria: [], non_goals: [], created: today(),
  };
  writeFm(file, data, body.replace(/\{\{title\}\}/g, data.title), 'bet');
  writeJsonAtomic(decisionsPath(root, slug), { bet: slug, next_id: 1, decisions: [] }, 'decisions');
  return file;
}

const TRANSITIONS = {
  draft: ['grilling', 'killed'],
  grilling: ['evidence', 'killed', 'draft'],
  evidence: ['grilling', 'signed', 'killed'],
  signed: ['delivered', 'killed'],
  delivered: ['evaluated'],
  killed: [], evaluated: [],
};

export function betTransition(root, slug, to, opts = {}) {
  const file = betPath(root, slug);
  const { data } = readFm(file);
  const from = data.status;
  if (!(TRANSITIONS[from] || []).includes(to)) throw new Error(`bet "${slug}": transition ${from} → ${to} is not allowed`);
  const patch = { status: to };
  if (to === 'signed') {
    const pol = lanePolicy(loadPolicy(root), data.lane, data.risk);
    const min = pol.min_confidence_to_sign || 'anecdote';
    if (CONFIDENCE.indexOf(data.confidence) < CONFIDENCE.indexOf(min)) throw new Error(`bet "${slug}": confidence "${data.confidence}" is below "${min}" required for lane ${data.lane} / risk ${data.risk}`);
    if (!opts.by || opts.by !== data.owner) throw new Error(`bet "${slug}": only the owner "${data.owner}" can sign (acting as "${opts.by || 'nobody'}")`);
    const pending = existsSync(decisionsPath(root, slug)) ? readJson(decisionsPath(root, slug)).decisions.filter(d => d.type === 'question' && d.status === 'pending') : [];
    if (pending.length) throw new Error(`bet "${slug}": ${pending.length} question(s) still pending (${pending.map(d => d.id).join(', ')}); answer or defer them first`);
    patch.signed_at = now(); patch.signed_by = opts.by;
  }
  setFm(file, patch, 'bet');
  return { from, to };
}

// raiseRisk: the bet's risk only ever goes up; every raise is logged in the bet body.
export function raiseRisk(root, slug, risk, reason) {
  if (!RISK_ORDER.includes(risk)) throw new Error(`unknown risk "${risk}"`);
  const file = betPath(root, slug);
  const { data, body } = readFm(file);
  if (RISK_ORDER.indexOf(risk) <= RISK_ORDER.indexOf(data.risk)) return { from: data.risk, to: data.risk, changed: false };
  writeFm(file, { ...data, risk }, appendToSection(body, 'Risk log', `- ${today()} risk ${data.risk} → ${risk}: ${reason}`), 'bet');
  return { from: data.risk, to: risk, changed: true };
}

// ---------- decisions ----------
export function loadDecisions(root, slug) {
  const f = decisionsPath(root, slug);
  return existsSync(f) ? readJson(f) : { bet: slug, next_id: 1, decisions: [] };
}
export function saveDecisions(root, slug, doc) { return writeJsonAtomic(decisionsPath(root, slug), doc, 'decisions'); }

export function addDecision(root, slug, d) {
  const doc = loadDecisions(root, slug);
  const id = `D${doc.next_id || 1}`;
  const rec = {
    id, type: d.type, ...(d.task ? { task: d.task } : {}), ...(d.risk ? { risk: d.risk } : {}), raised_by: d.raised_by || null, context: d.context, options: d.options,
    allow_free_text: d.allow_free_text ?? (d.type === 'question'), status: 'pending',
    answer: null, free_text: null, decided_by: null, decided_at: null, effect: null, created_at: now(),
  };
  doc.decisions.push(rec);
  doc.next_id = (doc.next_id || 1) + 1;
  saveDecisions(root, slug, doc);
  return rec;
}

// supersedeDecision: the runner closes a pending decision that no longer applies.
export function supersedeDecision(root, slug, id, reason) {
  const doc = loadDecisions(root, slug);
  const d = doc.decisions.find(x => x.id === id);
  if (!d || d.status === 'answered') return d;
  Object.assign(d, { status: 'answered', answer: 'superseded', free_text: null, decided_by: 'bridgie', decided_at: now(), effect: reason });
  saveDecisions(root, slug, doc);
  return d;
}

export function listDecisions(root, slug, opts = {}) {
  const slugs = slug ? [slug] : listBets(root);
  const all = [];
  for (const s of slugs) for (const d of loadDecisions(root, s).decisions) all.push({ ...d, bet: s });
  const filtered = opts.pending ? all.filter(d => d.status !== 'answered') : all;
  return filtered.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function ensureSignDecision(root, slug) {
  const doc = loadDecisions(root, slug);
  const open = doc.decisions.find(d => d.type === 'sign' && d.status !== 'answered');
  if (open) return open;
  const { data } = readFm(betPath(root, slug));
  return addDecision(root, slug, {
    type: 'sign', allow_free_text: false,
    context: `Sign "${data.title}"? lane ${data.lane}, risk ${data.risk}, confidence ${data.confidence}, appetite ${data.appetite?.time || '?'}.`,
    options: ['sign', 'kill', 'need more evidence'],
  });
}

function appendBody(root, slug, heading, line) {
  const file = betPath(root, slug);
  const { data, body } = readFm(file);
  writeFm(file, data, appendToSection(body, heading, line), 'bet');
}

export function answerDecision(root, slug, id, answer, opts = {}) {
  const doc = loadDecisions(root, slug);
  const d = doc.decisions.find(x => x.id === id);
  if (!d) throw new Error(`decision ${id} not found for bet "${slug}"`);
  if (d.status === 'answered') throw new Error(`decision ${id} already answered (${d.answer})`);
  const by = opts.by || 'unknown';

  if (answer === 'defer') {
    d.status = 'deferred'; d.effect = 'deferred'; d.decided_by = by; d.decided_at = now();
    saveDecisions(root, slug, doc);
    appendBody(root, slug, 'Decision log', `- ${today()} ${id} (${d.type}): deferred by ${by}`);
    return d;
  }
  if (!d.options.includes(answer) && !(d.allow_free_text && opts.text)) {
    throw new Error(`answer "${answer}" is not one of: ${d.options.join(', ')}${d.allow_free_text ? ' (or pass --text for a free-text answer)' : ''}`);
  }

  let effect = 'recorded';
  if (d.type === 'question' && answer === "don't know") {
    const n = doc.decisions.filter(x => x.effect && x.effect.startsWith('evidence task')).length + 1;
    appendBody(root, slug, 'Evidence tasks', `- [ ] E${n}: ${d.context} (from ${id})`);
    effect = `evidence task E${n} created`;
  } else if (d.type === 'sign') {
    const status = readFm(betPath(root, slug)).data.status;
    if (answer === 'sign') { betTransition(root, slug, 'signed', { by }); effect = 'bet signed'; }
    else if (answer === 'kill') { betTransition(root, slug, 'killed'); effect = 'bet killed'; }
    else if (answer === 'need more evidence') {
      if (status === 'grilling') betTransition(root, slug, 'evidence');
      effect = 'bet stays in evidence; add evidence tasks or re-grill';
    }
  }
  // approve_design, ack_risk, accept, unblock: their effects live in flow.mjs and arrive as opts.effectFn.
  if (opts.effectFn) effect = opts.effectFn(d, answer, { by, text: opts.text }) || effect;

  d.status = 'answered'; d.answer = answer; d.free_text = opts.text || null;
  d.decided_by = by; d.decided_at = now(); d.effect = effect;
  saveDecisions(root, slug, doc);
  appendBody(root, slug, 'Decision log', `- ${today()} ${id} (${d.type}): ${answer}${opts.text ? ` — ${opts.text}` : ''} → ${effect} [${by}]`);
  return d;
}

export function ingestQuestions(root, slug, outputFile, runId) {
  const o = assertValid(loadSchema('seat-output'), readJson(outputFile), outputFile);
  const ids = [];
  for (const q of o.questions || []) {
    const d = addDecision(root, slug, { type: 'question', context: q.context, options: q.options, allow_free_text: q.allow_free_text ?? true, raised_by: { seat: o.seat, run: runId } });
    appendBody(root, slug, 'Open questions', `- ${d.id}: ${q.context}`);
    ids.push(d.id);
  }
  return ids;
}

// ---------- routing and cost ----------
export function route(root, manifest) {
  const pol = loadPolicy(root);
  const r = (pol.routing?.seats || {})[manifest.name] || (pol.routing?.tiers || {})[manifest.tier] || {};
  return {
    adapter: process.env.BRIDGIE_ADAPTER || r.adapter || 'none',
    model: process.env.BRIDGIE_MODEL || r.model || 'default',
    effort: r.effort || null,
  };
}
export function costAdd(runDir, entry) {
  const f = join(runDir, 'cost.json');
  const doc = existsSync(f) ? readJson(f) : { entries: [] };
  doc.entries.push(entry);
  return writeJsonAtomic(f, doc, 'cost');
}

// ---------- status ----------
export function status(root) {
  return listBets(root).map(slug => {
    const { data } = readFm(betPath(root, slug));
    const pending = loadDecisions(root, slug).decisions.filter(d => d.status === 'pending').length;
    let tasks = null;
    if (existsSync(tasksPath(root, slug))) {
      const t = readJson(tasksPath(root, slug)).tasks;
      tasks = { total: t.length, passed: t.filter(x => x.status === 'passed').length, blocked: t.filter(x => x.status === 'blocked').length };
    }
    return { slug, title: data.title, lane: data.lane, risk: data.risk, status: data.status, confidence: data.confidence, pending, tasks };
  });
}
export function statusTable(rows) {
  if (!rows.length) return 'No bets yet. Create one with: bridgie bet new <slug>';
  const cols = [['SLUG', r => r.slug], ['LANE', r => r.lane], ['RISK', r => r.risk], ['STATUS', r => r.status], ['CONF', r => r.confidence], ['PENDING', r => String(r.pending)], ['TASKS', r => r.tasks ? `${r.tasks.passed}/${r.tasks.total}${r.tasks.blocked ? ` (${r.tasks.blocked} blocked)` : ''}` : '-'], ['TITLE', r => r.title]];
  const widths = cols.map(([h, f]) => Math.max(h.length, ...rows.map(r => f(r).length)));
  const line = vals => vals.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd();
  return [line(cols.map(c => c[0])), ...rows.map(r => line(cols.map(c => c[1](r))))].join('\n');
}

// ---------- CLI ----------
function out(x) { process.stdout.write((typeof x === 'string' ? x : JSON.stringify(x, null, 2)) + '\n'); }
export async function main(argv) {
  const [op, ...a] = argv;
  const flag = n => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; };
  switch (op) {
    case 'fm-get': { const { data } = readFm(a[0]); console.log(JSON.stringify(a[1] ? (data[a[1]] ?? null) : data)); return; }
    case 'fm-set': setFm(a[0], { [a[1]]: JSON.parse(a[2]) }, flag('schema')); return;
    case 'validate': { const errs = validate(loadSchema(a[0]), a[1].endsWith('.md') ? readFm(a[1]).data : readJson(a[1])); if (errs.length) { console.error(errs.join('\n')); process.exit(1); } return; }
    case 'policy': out(loadPolicy(a[0])); return;
    case 'bet-new': out(betNew(a[0], a[1], { title: flag('title'), lane: flag('lane'), risk: flag('risk'), owner: flag('owner') })); return;
    case 'bet-transition': out(betTransition(a[0], a[1], a[2], { by: flag('by') })); return;
    case 'list-bets': out(listBets(a[0])); return;
    default:
      if (EXTRA_OPS[op]) return EXTRA_OPS[op](a, flag, out);
      console.error(`state.mjs: unknown op "${op}"`); process.exit(2);
  }
}
export const EXTRA_OPS = {};   // later tasks register ops here (decisions, cost, status, route)
Object.assign(EXTRA_OPS, {
  'decision-add': (a, flag, out) => {
    const src = a[2] === '-' ? readFileSync(0, 'utf8') : readFileSync(a[2], 'utf8');
    out(addDecision(a[0], a[1], JSON.parse(src)));
  },
  'decision-answer': (a, flag, out) => out(answerDecision(a[0], a[1], a[2], a[3], { text: flag('text'), by: flag('by') })),
  'decision-list': (a, flag, out) => out(listDecisions(a[0], a[1] && !a[1].startsWith('--') ? a[1] : null, { pending: a.includes('--pending') })),
  'ensure-sign': (a, flag, out) => out(ensureSignDecision(a[0], a[1]).id),
  'ingest-questions': (a, flag, out) => out(ingestQuestions(a[0], a[1], a[2], flag('run') || 'unknown')),
  'seat-lock': (a, flag, out) => { const l = seatLock(a[0]); out(l ? JSON.stringify(l) : ''); },
  'needs-ack': (a, flag, out) => { const bet = readFm(betPath(a[0], a[1])).data; const p = lanePolicy(loadPolicy(a[0]), bet.lane, bet.risk); out(p.human_ack_before_build ? bet.risk : ''); },
  'status': (a, flag, out) => { const rows = status(a[0]); out(a.includes('--table') ? statusTable(rows) : rows); },
  'route': (a, flag, out) => { const { data } = splitFrontmatter(readFileSync(join(HOME, 'seats', a[1], 'SKILL.md'), 'utf8')); out(route(a[0], data)); },
  'cost-add': (a, flag, out) => out(costAdd(a[0], {
    seat: flag('seat'), adapter: flag('adapter'), model: flag('model') || 'default', started_at: flag('started'),
    duration_s: Number(flag('duration')), attempt: Number(flag('attempt')), exit_code: Number(flag('exit')),
    tokens_in: null, tokens_out: null, usd: null,
  })),
});

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(e => { console.error(`state.mjs: ${e.message}`); process.exit(1); });
}
