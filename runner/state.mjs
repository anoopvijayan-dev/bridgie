// Single writer for Bridgie project state. Everything under <root>/.bridgie is
// read and written through this module. Importable (surface.mjs) and a CLI.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as yparse, splitFrontmatter, joinFrontmatter } from './yaml.mjs';
import { validate, assertValid } from './schema.mjs';

export const HOME = process.env.BRIDGIE_HOME || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const CONFIDENCE = ['opinion', 'anecdote', 'data', 'test'];

// ---------- files ----------
export function loadSchema(name) { return JSON.parse(readFileSync(join(HOME, 'schemas', `${name}.json`), 'utf8')); }
export function readJson(file) { return JSON.parse(readFileSync(file, 'utf8')); }
export function writeJsonAtomic(file, obj, schemaName) {
  if (schemaName) assertValid(loadSchema(schemaName), obj, file);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  renameSync(tmp, file);
  return file;
}
export function readFm(file) { return splitFrontmatter(readFileSync(file, 'utf8')); }
export function writeFm(file, data, body, schemaName) {
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
  const pf = join(root, '.bridgie', 'policy.yaml');
  const proj = existsSync(pf) ? yparse(readFileSync(pf, 'utf8')) : {};
  const merged = deepMerge(def, proj);
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
  grilling: ['evidence', 'killed'],
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(e => { console.error(`state.mjs: ${e.message}`); process.exit(1); });
}
