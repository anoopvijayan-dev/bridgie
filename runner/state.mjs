// Single writer for Bridgie project state. Everything under <root>/.bridgie is
// read and written through this module. Importable (surface.mjs) and a CLI.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { homedir, hostname, userInfo } from 'node:os';
import { createHash } from 'node:crypto';
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
// pidAlive: whether a process of this machine still runs. EPERM means it runs under another user.
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
export function seatLock(root) {
  const dir = join(root, '.bridgie', '.seat-lock');
  if (!existsSync(dir)) return null;
  let o;
  try { o = readJson(join(dir, 'owner.json')); } catch { o = { seat: 'unknown', since: statSync(dir).mtime.toISOString(), run_dir: null }; }
  if (Date.now() - Date.parse(o.since) > LOCK_STALE_MS) return null;   // a crashed run cannot lock state forever
  // A lock taken on this machine by a process that is gone is stale at once: a killed run (a closed
  // terminal, a restarted container) must not block the project for hours. A lock from another
  // machine (a shared folder) keeps the time rule only.
  if (o.pid !== undefined && (!o.host || o.host === hostname()) && !pidAlive(o.pid)) return null;
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

// ---------- governance ----------
// harness: the agent harness this process runs inside, when the environment shows one. Best effort:
// it reads the variables the harnesses set for the commands they run. $BRIDGIE_HARNESS names one
// outright ("none" for a person's own terminal).
export function harness() {
  const h = process.env.BRIDGIE_HARNESS;
  if (h) return h === 'none' ? null : h;
  if (process.env.BRIDGIE_PARENT_ADAPTER) return process.env.BRIDGIE_PARENT_ADAPTER;
  if (process.env.CLAUDECODE) return 'claude-code';
  if (process.env.CODEX_SANDBOX || process.env.CODEX_THREAD_ID) return 'codex';
  if (process.env.GEMINI_CLI) return 'gemini-cli';
  if (process.env.CURSOR_AGENT) return 'cursor';
  return null;
}
// provenance: through what a decision was answered. `channel` is 'cli' or 'surface' (the page a
// person clicks in a browser); `agent` is the harness the command ran inside, or null.
export function provenance(channel = 'cli', extra = {}) {
  let os_user = null;
  try { os_user = userInfo().username; } catch { /* no passwd entry */ }
  return { channel, agent: harness(), os_user, host: hostname(), ...extra };
}
// humansOnly: the decision types a person must answer, and whether an agent may relay a person's
// answer (recorded as relayed) or is refused outright.
export function humansOnly(policy) {
  const h = policy.humans_only || {};
  return { decisions: h.decisions || [], relay: h.relay !== false };
}
const short = x => createHash('sha256').update(JSON.stringify(x ?? null)).digest('hex').slice(0, 12);
// governanceRules: the rules a bet is held to at its lane and risk. Stored on the bet when it is
// signed; governanceDrift compares the signed rules with today's.
export function governanceRules(root, lane, risk) {
  const policy = loadPolicy(root);
  const pol = lanePolicy(policy, lane, risk);
  const ho = humansOnly(policy);
  const sizes = {};
  for (const k of ['small', 'medium', 'large']) sizes[k] = { harden: policy.sizes?.[k]?.harden ?? null, skip_tiers: [...(policy.sizes?.[k]?.skip_tiers || [])].sort() };
  return {
    tiers: [...(pol.tiers || pol.tiers_default || ['mechanical'])],
    approvers: pol.approvers || 1,
    cross_family: !!pol.cross_family,
    auto_accept: !!pol.auto_accept,
    human_ack_before_build: !!pol.human_ack_before_build,
    humans_only: [...ho.decisions].sort(),
    relay: ho.relay,
    owner_override: policy.acceptance?.owner_override !== false,
    floor_risk: policy.sizes?.floor_risk || 'data',
    sizes,
    commands: policy.verify?.commands ? short(policy.verify.commands) : null,
    sandbox: ['off', 'auto', 'required'].includes(policy.sandbox?.build) ? policy.sandbox.build : 'auto',
    sandbox_network: [...(policy.sandbox?.network || [])].sort(),
    drift_check: policy.living_spec?.drift_check !== false,
  };
}
// governanceDrift: every way `now` is weaker than `signed` (or, for verify commands, different:
// a command cannot be ranked, so any change is the owner's to confirm). Stronger rules are not drift.
export function governanceDrift(signed, now) {
  const out = [];
  const s = signed || {};
  for (const t of s.tiers || []) if (!now.tiers.includes(t)) out.push(`the ${t} tier is no longer required`);
  if ((s.approvers || 1) > now.approvers) out.push(`approvers required went from ${s.approvers} to ${now.approvers}`);
  if (s.cross_family && !now.cross_family) out.push('a reviewer from another model family is no longer required');
  if (s.auto_accept === false && now.auto_accept) out.push('auto-accept was turned on');
  if (s.human_ack_before_build && !now.human_ack_before_build) out.push('the risk acknowledgement before build was removed');
  for (const d of s.humans_only || []) if (!now.humans_only.includes(d)) out.push(`"${d}" decisions no longer need a person`);
  if (s.relay === false && now.relay) out.push('agents may now relay answers to decisions that need a person');
  if (s.owner_override === false && now.owner_override) out.push('the owner override at acceptance was turned on');
  if (s.floor_risk && RISK_ORDER.indexOf(now.floor_risk) > RISK_ORDER.indexOf(s.floor_risk)) out.push(`the risk floor for small tasks rose from ${s.floor_risk} to ${now.floor_risk}`);
  for (const k of Object.keys(s.sizes || {})) {
    const a = s.sizes[k], b = now.sizes[k] || { harden: null, skip_tiers: [] };
    const more = b.skip_tiers.filter(t => !a.skip_tiers.includes(t));
    if (more.length) out.push(`${k} tasks now skip ${more.join(', ')}`);
    if (a.harden === true && b.harden !== true) out.push(`${k} tasks are no longer always hardened`);
  }
  if ((s.commands ?? null) !== (now.commands ?? null)) out.push('the verify commands in policy.yaml changed');
  const SB = ['off', 'auto', 'required'];
  if (s.sandbox && SB.indexOf(now.sandbox) < SB.indexOf(s.sandbox)) out.push(`the sandbox for build seats went from ${s.sandbox} to ${now.sandbox}`);
  if (s.sandbox_network) { const more = (now.sandbox_network || []).filter(h => !s.sandbox_network.includes(h)); if (more.length && now.sandbox !== 'off') out.push(`sandboxed seats may now reach ${more.join(', ')}`); }
  if (s.drift_check && now.drift_check === false) out.push('the living-spec drift check at accept was turned off');
  return out;
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
  const tpl = readFileSync(join(HOME, 'templates', 'bet.md'), 'utf8').replace(/\r\n/g, '\n');   // LF even from a CRLF checkout
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
    const nums = numbersGate(root, slug, pol);
    if (nums) throw new Error(`bet "${slug}": ${nums}`);
    patch.signed_at = now(); patch.signed_by = opts.by;
    patch.governance = { at: now(), rules: governanceRules(root, data.lane, data.risk) };
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

// numbersGate: why a bet whose policy requires numbers cannot be signed yet, or null.
export function numbersGate(root, slug, pol) {
  if (!pol.require_numbers) return null;
  const f = join(root, '.bridgie', 'bets', slug, 'numbers.json');
  if (!existsSync(f)) return `policy requires unit economics for this risk; run bridgie numbers ${slug} --template, fill it in, then bridgie numbers ${slug}`;
  const n = readJson(f);
  if (!n.checks?.unit_positive) return `unit economics show each unit loses money (contribution ${n.contribution_per_unit}); fix the numbers or kill the bet`;
  return null;
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

const signContext = data => `Sign "${data.title}"? lane ${data.lane}, risk ${data.risk}, confidence ${data.confidence}, appetite ${data.appetite?.time || '?'}.`;

export function ensureSignDecision(root, slug) {
  const doc = loadDecisions(root, slug);
  const open = doc.decisions.find(d => d.type === 'sign' && d.status !== 'answered');
  if (open) return open;
  const { data } = readFm(betPath(root, slug));
  return addDecision(root, slug, {
    type: 'sign', allow_free_text: false,
    context: signContext(data),
    options: ['sign', 'kill', 'need more evidence'],
  });
}

// betSet: correct a bet's risk, owner or appetite before it is signed. Once signed, the risk only goes
// up (raiseRisk) and the rest is held by the governance lock. Every change is logged in the bet body
// with the reason, who made it and through what; a pending sign decision is reworded to match.
export const UNSIGNED = ['draft', 'grilling', 'evidence'];
export function betSet(root, slug, changes, opts = {}) {
  const file = betPath(root, slug);
  if (!existsSync(file)) throw new Error(`bet "${slug}" not found`);
  if (!opts.reason) throw new Error('bet set: --reason is required (it is written to the bet\'s decision log)');
  const { data, body } = readFm(file);
  if (!UNSIGNED.includes(data.status)) throw new Error(`bet "${slug}" is ${data.status}: risk, owner and appetite are fixed once a bet is signed (risk is still raised automatically when the work needs it)`);
  if (changes.risk !== undefined && !RISK_ORDER.includes(changes.risk)) throw new Error(`unknown risk "${changes.risk}" (one of: ${RISK_ORDER.join(', ')})`);
  const app = { ...(data.appetite || {}) };
  if (changes.time !== undefined) app.time = changes.time;
  if (changes.tokens_usd !== undefined) app.tokens_usd = changes.tokens_usd;
  const next = { ...data };
  if (changes.risk !== undefined) next.risk = changes.risk;
  if (changes.owner !== undefined) next.owner = changes.owner;
  next.appetite = app;
  const appText = a => `${a?.time ?? '?'}/$${a?.tokens_usd ?? '?'}`;
  const done = [];
  if (next.risk !== data.risk) done.push(`risk ${data.risk} → ${next.risk}`);
  if (next.owner !== data.owner) done.push(`owner ${data.owner} → ${next.owner}`);
  if (appText(next.appetite) !== appText(data.appetite)) done.push(`appetite ${appText(data.appetite)} → ${appText(next.appetite)}`);
  if (!done.length) throw new Error('bet set: nothing to change (give --risk, --owner, --time or --tokens-usd with a new value)');
  const via = opts.via || null;
  const through = via?.agent ? ` through ${via.agent}${via.relayed ? ' (relayed)' : ''}` : '';
  let b = body;
  for (const c of done) b = appendToSection(b, 'Decision log', `- ${today()} ${c}: ${opts.reason} (by ${opts.by || 'unknown'}${through})`);
  writeFm(file, next, b, 'bet');
  const doc = loadDecisions(root, slug);
  const sign = doc.decisions.find(d => d.type === 'sign' && d.status !== 'answered');
  if (sign) { sign.context = signContext(next); saveDecisions(root, slug, doc); }
  return done;
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
  // via: through what the answer arrived (provenance). Callers that are a way in for people and
  // agents (the CLI, the surface) pass it; it is stored on the decision as it was, never guessed.
  const via = opts.via ? { ...opts.via } : null;
  const through = via?.agent ? ` through ${via.agent}${via.relayed ? ' (relayed)' : ''}` : '';

  if (answer === 'defer') {
    d.status = 'deferred'; d.effect = 'deferred'; d.decided_by = by; d.decided_at = now(); if (via) d.via = via;
    saveDecisions(root, slug, doc);
    appendBody(root, slug, 'Decision log', `- ${today()} ${id} (${d.type}): deferred by ${by}${through}`);
    return d;
  }
  if (!d.options.includes(answer) && !(d.allow_free_text && opts.text)) {
    throw new Error(`answer "${answer}" is not one of: ${d.options.join(', ')}${d.allow_free_text ? ' (or pass --text for a free-text answer)' : ''}`);
  }

  // Decisions policy reserves for a person: an agent's command line is refused, or — when policy
  // allows relaying — must say it is passing on a person's answer, and the record says so. This is a
  // guard against an agent approving on its own and a truthful record, not proof of who typed.
  const ho = humansOnly(loadPolicy(root));
  if (via?.agent && via.channel !== 'surface' && ho.decisions.includes(d.type)) {
    if (!ho.relay) throw new Error(`decision ${id} (${d.type}) is for a person, and this command is running inside an agent (${via.agent}). Answer it in your own terminal or with: bridgie open ${slug}`);
    if (!via.relayed) throw new Error(`decision ${id} (${d.type}) is for a person, and this command is running inside an agent (${via.agent}). If ${by} told you this answer, pass --relayed (the record will say it came through ${via.agent}); otherwise ask them to answer it: bridgie open ${slug}`);
  }

  let effect = 'recorded';
  // "Don't know", "don't know" and "Don't know (I'll ask them to time 3 files)" all mean the same thing
  if (d.type === 'question' && /^don['’]t know\b/i.test(answer.trim())) {
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
  if (opts.effectFn) effect = opts.effectFn(d, answer, { by, text: opts.text, via }) || effect;

  d.status = 'answered'; d.answer = answer; d.free_text = opts.text || null;
  d.decided_by = by; d.decided_at = now(); d.effect = effect; if (via) d.via = via;
  saveDecisions(root, slug, doc);
  appendBody(root, slug, 'Decision log', `- ${today()} ${id} (${d.type}): ${answer}${opts.text ? ` — ${opts.text}` : ''} → ${effect} [${by}${through}]`);
  return d;
}

// supersedeDecisions: close pending decisions that no longer apply (a re-plan replaces the tasks they
// were about). Like supersedeDecision: answered with answer 'superseded' and the reason, and logged.
export function supersedeDecisions(root, slug, pred, why, opts = {}) {
  const doc = loadDecisions(root, slug);
  const closed = [];
  for (const d of doc.decisions) {
    if (d.status === 'answered' || !pred(d)) continue;   // same convention as supersedeDecision
    Object.assign(d, { status: 'answered', answer: 'superseded', free_text: null, decided_by: opts.by || 'bridgie', decided_at: now(), effect: why });
    closed.push(d.id);
  }
  if (!closed.length) return closed;
  saveDecisions(root, slug, doc);
  for (const id of closed) appendBody(root, slug, 'Decision log', `- ${today()} ${id}: superseded (${why}) [${opts.by || 'bridgie'}]`);
  return closed;
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
  // BRIDGIE_ADAPTER pins the adapter. The routed model and effort name another CLI's model ("argon"
  // is Antigravity's), so a pinned adapter that differs from the route runs its own default instead.
  const pinned = process.env.BRIDGIE_ADAPTER, other = pinned && pinned !== r.adapter;
  return {
    adapter: pinned || r.adapter || 'none',
    model: process.env.BRIDGIE_MODEL || (other ? 'default' : r.model) || 'default',
    effort: other ? null : r.effort || null,
  };
}
// parentAdapter: the agent harness running Bridgie, when it can be told from the environment.
export function parentAdapter() {
  if (process.env.BRIDGIE_PARENT_ADAPTER) return process.env.BRIDGIE_PARENT_ADAPTER;
  if (process.env.CLAUDECODE) return 'claude-code';
  return null;
}

// fallbacks: adapters to try, in order, when the routed one cannot run a seat at all (not installed,
// not set up, signed out, crashed). BRIDGIE_ADAPTER pins one adapter: no fallback. routing.fallback
// sets the list ([] turns fallback off); without it: the parent harness, then the known model CLIs.
export function fallbacks(root, primary) {
  if (process.env.BRIDGIE_ADAPTER) return [];
  const set = loadPolicy(root).routing?.fallback;
  const list = Array.isArray(set) ? set : [parentAdapter(), 'claude-code', 'codex', 'antigravity', 'copilot'].filter(a => a !== 'fake');
  return [...new Set(list.filter(a => a && a !== primary && a !== 'none'))];
}

// ---------- adapter quota ----------
// A model CLI that is at its usage limit fails every run until the limit resets. Bridgie reads that
// from the run's own logs, remembers it per machine (.bridgie/.adapter-state.json, not committed),
// routes around the adapter until then, and says when to come back instead of failing again.
const QUOTA = /quota|usage limit|rate limit|RESOURCE_EXHAUSTED|\b429\b|limit reached|too many requests/i;
const DEFAULT_WAIT_MS = 30 * 60 * 1000;   // a limit that names no reset time is tried again in half an hour

// quotaFromText: null when the text shows no usage limit; else { until: ISO time, why: the line }.
export function quotaFromText(text, nowMs = Date.now()) {
  const line = String(text).split(/\r?\n/).filter(l => QUOTA.test(l)).pop();
  if (!line) return null;
  let until = null;
  const rel = line.match(/resets?\s+in\s+((?:\d+\s*[dhms]\s*)+)/i);
  if (rel) {
    let ms = 0;
    for (const m of rel[1].matchAll(/(\d+)\s*([dhms])/gi)) ms += Number(m[1]) * { d: 86400000, h: 3600000, m: 60000, s: 1000 }[m[2].toLowerCase()];
    if (ms > 0) until = nowMs + ms;
  }
  if (until === null) {
    const abs = line.match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?\s*(Z|UTC)?/i);
    const t = abs ? Date.parse(`${abs[1]}T${abs[2]}:00Z`) : NaN;
    if (!Number.isNaN(t) && t > nowMs) until = t;
  }
  return { until: new Date(until ?? nowMs + DEFAULT_WAIT_MS).toISOString(), why: line.trim().slice(0, 300) };
}
// quotaFromRun: the same, read from the tail of every log an adapter wrote in a run folder since
// `sinceMs` (the launch's start).
export function quotaFromRun(runDir, sinceMs = 0, nowMs = Date.now()) {
  let found = null;
  for (const f of existsSync(runDir) ? readdirSync(runDir) : []) {
    if (!/\.log(\.err)?$/.test(f)) continue;
    let text = '';
    try {
      if (statSync(join(runDir, f)).mtimeMs < sinceMs) continue;   // an earlier adapter's log in the same run
      text = readFileSync(join(runDir, f), 'utf8').slice(-20000);
    } catch { continue; }
    const q = quotaFromText(text, nowMs);
    if (q && (!found || q.until > found.until)) found = q;
  }
  return found;
}
const adapterStatePath = root => join(root, '.bridgie', '.adapter-state.json');
export function adapterState(root) {
  try { return readJson(adapterStatePath(root)); } catch { return {}; }
}
export function markExhausted(root, adapter, until, why) {
  const doc = adapterState(root);
  doc[adapter] = { exhausted_until: until, why, noted_at: now() };
  writeFileSync(adapterStatePath(root), JSON.stringify(doc, null, 2) + '\n');   // machine-local, not Bridgie state
}
// exhaustedUntil: the ISO time an adapter's limit resets, or null when it is not known to be at one.
export function exhaustedUntil(root, adapter, nowMs = Date.now()) {
  const u = adapterState(root)[adapter]?.exhausted_until;
  return u && Date.parse(u) > nowMs ? u : null;
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
