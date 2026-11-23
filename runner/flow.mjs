// Build/verify/accept flow on top of state.mjs: tasks, evidence reconciliation, acceptance,
// and the effects of approve_design, ack_risk, unblock and accept decisions.
// Every write still goes through state.mjs's atomic, schema-checked writers.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parse as yparse } from './yaml.mjs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as st from './state.mjs';
import { assertValid } from './schema.mjs';
import { extractLastJson } from '../adapters/lib/extract-json.mjs';

export const acceptancePath = (root, slug) => join(root, '.bridgie', 'acceptance', `${slug}.md`);
const requirementsPath = (root, slug) => join(root, '.bridgie', 'specs', slug, 'requirements.md');

// ---------- requirements and tasks ----------
export function requirementIds(root, slug) {
  const f = requirementsPath(root, slug);
  if (!existsSync(f)) throw new Error(`no requirements.md for bet "${slug}" (run bridgie shape ${slug})`);
  return [...readFileSync(f, 'utf8').matchAll(/^## ([RP][0-9]+)\b/gm)].map(m => m[1]);
}

// requirementRisks: the "risk: <level>" tag on each requirement heading (## R2 · event · risk: money).
export function requirementRisks(root, slug) {
  const f = requirementsPath(root, slug);
  if (!existsSync(f)) return {};
  const out = {};
  for (const m of readFileSync(f, 'utf8').matchAll(/^## ([RP][0-9]+)\b([^\n]*)$/gm)) {
    const r = m[2].match(/risk:\s*([a-z]+)/i);
    if (r && st.RISK_ORDER.includes(r[1].toLowerCase())) out[m[1]] = r[1].toLowerCase();
  }
  return out;
}

// writeSpecFiles: requirements.md and design.md from the shaper's output.
// applyEdits: each {old, new} replaces text that occurs exactly once in the file as it stands
// after the edits before it, so a revision names only what changes (a whole long spec can be
// more than a model returns in one reply).
export function applyEdits(text, edits, name) {
  edits.forEach((e, i) => {
    const at = text.indexOf(e.old);
    const where = `edits["${name}"][${i}] (${JSON.stringify(e.old.slice(0, 60))})`;
    if (at < 0) throw new Error(`${where}: old text not found in ${name}`);
    if (text.indexOf(e.old, at + 1) >= 0) throw new Error(`${where}: old text occurs more than once in ${name}; include more context`);
    text = text.slice(0, at) + e.new + text.slice(at + e.old.length);
  });
  return text;
}

export function writeSpecFiles(root, slug, outputFile) {
  const o = assertValid(st.loadSchema('seat-output'), st.readJson(outputFile), outputFile);
  const files = o.files || {}, edits = o.edits || {};
  const dir = join(root, '.bridgie', 'specs', slug);
  // A file comes whole (files), or as edits to the one already there (a revision).
  const spec = name => {
    if (files[name] !== undefined) return files[name];
    if (!edits[name]) return undefined;
    const f = join(dir, name);
    if (!existsSync(f)) throw new Error(`shaper output edits ${name}, which does not exist yet; send it whole in files`);
    return applyEdits(readFileSync(f, 'utf8'), edits[name], name);
  };
  const req = spec('requirements.md'), design = spec('design.md') ?? o.artifact_md;
  if (!req) throw new Error('shaper output has no files["requirements.md"] (or edits to it)');
  if (!/^## R[0-9]+\b/m.test(req)) throw new Error('requirements.md has no "## R<n>" requirement headings');
  if (!design) throw new Error('shaper output has no files["design.md"] (or edits to it)');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'requirements.md'), req.endsWith('\n') ? req : `${req}\n`);
  writeFileSync(join(dir, 'design.md'), design.endsWith('\n') ? design : `${design}\n`);
  return { requirements: join(dir, 'requirements.md'), design: join(dir, 'design.md'), ids: requirementIds(root, slug) };
}

export function loadTasks(root, slug) {
  const f = st.tasksPath(root, slug);
  if (!existsSync(f)) throw new Error(`no tasks.json for bet "${slug}" (run bridgie plan ${slug})`);
  return st.readJson(f);
}
const saveTasks = (root, slug, doc) => st.writeJsonAtomic(st.tasksPath(root, slug), doc, 'tasks');

export function getTask(doc, id) {
  const t = doc.tasks.find(x => x.id === id);
  if (!t) throw new Error(`task ${id} not found`);
  return t;
}
export function setTask(root, slug, id, patch) {
  const doc = loadTasks(root, slug);
  Object.assign(getTask(doc, id), patch);
  saveTasks(root, slug, doc);
  return getTask(doc, id);
}

export function writeTasksFromPlan(root, slug, outputFile) {
  const o = assertValid(st.loadSchema('seat-output'), st.readJson(outputFile), outputFile);
  let raw;
  if (o.files && o.files['tasks.json']) raw = JSON.parse(o.files['tasks.json']);
  else if (o.artifact_md) raw = extractLastJson(o.artifact_md);
  else throw new Error('decomposer output has no tasks (artifact_md json block or files["tasks.json"])');
  const list = Array.isArray(raw) ? raw : raw.tasks;
  if (!Array.isArray(list) || !list.length) throw new Error('decomposer produced an empty task list');

  const reqs = requirementIds(root, slug);
  const ids = new Set();
  for (const t of list) {
    if (!/^T[0-9]+$/.test(t.id || '')) throw new Error(`bad task id "${t.id}" (expected T1, T2, …)`);
    if (ids.has(t.id)) throw new Error(`duplicate task id ${t.id}`);
    ids.add(t.id);
    if (!Array.isArray(t.requirements) || !t.requirements.length) throw new Error(`task ${t.id} maps to no requirement`);
    for (const r of t.requirements) if (!reqs.includes(r)) throw new Error(`task ${t.id} references unknown requirement ${r}`);
  }
  for (const t of list) for (const dep of t.depends_on || []) if (!ids.has(dep)) throw new Error(`task ${t.id} depends on unknown task ${dep}`);
  const unmapped = reqs.filter(r => !list.some(t => t.requirements.includes(r)));
  if (unmapped.length) {
    const props = unmapped.filter(r => /^P\d+$/.test(r));
    throw new Error(`requirements not covered by any task: ${unmapped.join(', ')}${props.length ? ' (P ids are correctness properties: each belongs in the task that builds what its Validates: line names)' : ''}`);
  }
  // cycle check (depth-first)
  const deps = Object.fromEntries(list.map(t => [t.id, t.depends_on || []]));
  const seen = {}, visit = (id, path) => {
    if (seen[id] === 'done') return;
    if (seen[id] === 'open') throw new Error(`dependency cycle: ${[...path, id].join(' → ')}`);
    seen[id] = 'open'; for (const d of deps[id]) visit(d, [...path, id]); seen[id] = 'done';
  };
  for (const t of list) visit(t.id, []);

  const max = st.loadPolicy(root).retries?.max_attempts || 3;
  const doc = {
    bet: slug,
    tasks: list.map(t => ({ id: t.id, title: t.title || t.id, requirements: t.requirements, depends_on: t.depends_on || [], status: 'todo', attempts: 0, max_attempts: max, branch: null, evidence: null, escalation: null })),
  };
  saveTasks(root, slug, doc);
  // Effective risk (finding 3): a requirement tagged with a higher risk raises the bet's risk.
  for (const [id, risk] of Object.entries(requirementRisks(root, slug))) st.raiseRisk(root, slug, risk, `requirement ${id} is tagged risk: ${risk}`);
  // Re-planning invalidates any acceptance package built from the previous plan (finding 1).
  invalidateAcceptance(root, slug, 're-planned');
  return doc;
}

export function readyTasks(root, slug) {
  const doc = loadTasks(root, slug);
  const passed = new Set(doc.tasks.filter(t => t.status === 'passed').map(t => t.id));
  return doc.tasks.filter(t =>
    (t.status === 'todo' || (t.status === 'failed' && t.attempts < t.max_attempts)) &&
    t.depends_on.every(d => passed.has(d)));
}

export function startAttempt(root, slug, id, branch) {
  const doc = loadTasks(root, slug);
  const t = getTask(doc, id);
  if (t.status === 'blocked') throw new Error(`task ${id} is blocked: ${t.escalation || ''}; answer its unblock decision first`);
  if (t.status === 'passed') throw new Error(`task ${id} already passed`);
  if (t.attempts >= t.max_attempts) throw new Error(`task ${id} has used all ${t.max_attempts} attempts`);
  t.attempts += 1; t.status = 'in_progress'; t.branch = branch;
  saveTasks(root, slug, doc);
  return t;
}

// recoverAttempts: tasks left in_progress by a run that is gone (a killed terminal, a restarted
// container) go back to being buildable, and the attempt the dead run started is not counted: it
// never finished, so it is no evidence about the task. Whatever the run left in the task worktree
// stays there for the next attempt. Does nothing while a live agent run holds the seat lock.
export function recoverAttempts(root, slug) {
  if (st.seatLock(root)) return [];
  const doc = loadTasks(root, slug);
  const stuck = doc.tasks.filter(t => t.status === 'in_progress');
  for (const t of stuck) {
    t.attempts = Math.max(0, t.attempts - 1);
    t.status = t.attempts === 0 ? 'todo' : 'failed';
    const note = 'the last attempt was interrupted before it finished (its process ended); it is not counted';
    t.escalation = t.escalation ? `${t.escalation} | ${note}` : note;
  }
  if (stuck.length) saveTasks(root, slug, doc);
  return stuck.map(t => t.id);
}

// failAttempt: the producer could not finish (adapter error, bad output, edited .bridgie/).
export function failAttempt(root, slug, id, reason) {
  const doc = loadTasks(root, slug);
  const t = getTask(doc, id);
  if (t.attempts >= t.max_attempts) {
    t.status = 'blocked';
    t.escalation = `blocked after ${t.attempts} attempts. Last: ${reason}`;
    saveTasks(root, slug, doc);
    ensureDecision(root, slug, 'unblock', `Task ${id} "${t.title}" is ${t.escalation}`,
      ['retry with guidance', 'take over manually', 'kill task'], { task: id, allow_free_text: true });
  } else {
    t.status = 'failed';
    t.escalation = `attempt ${t.attempts} of ${t.max_attempts} failed: ${reason}`;
    saveTasks(root, slug, doc);
  }
  return t;
}

// stampTask: the runner, not the model, decides which task an output belongs to.
export function stampTask(file, id) {
  const o = st.readJson(file);
  if (o.task !== id) { o.task = id; writeFileSync(file, JSON.stringify(o, null, 2) + '\n'); }
}

export const allPassed = (root, slug) => loadTasks(root, slug).tasks.every(t => t.status === 'passed');

// ---------- evidence ----------
// reconcile: combine the reviewer's evidence with mechanical rows; every requirement on the task
// needs a passing row (a missing row is not_proven, R4); blocker/major findings fail the task.
// On pass the task stays in "verify" until the runner has merged it (markPassed).
export function reconcile(root, slug, id, reviewerFile, mechanicalRows, outFile) {
  const doc = loadTasks(root, slug);
  const t = getTask(doc, id);
  const rev = assertValid(st.loadSchema('evidence'), st.readJson(reviewerFile), reviewerFile);
  // Every reviewer row counts (finding 2): a requirement is proven only when it has at least one
  // row and every one of its rows passes. Rows for ids outside the task still count.
  const missing = r => ({ id: r, tier: 'adversarial', check: 'no evidence row from the reviewer', result: 'not_proven', artifact: null });
  const criteria = [
    ...t.requirements.flatMap(r => { const rs = rev.criteria.filter(c => c.id === r); return rs.length ? rs : [missing(r)]; }),
    ...rev.criteria.filter(c => !t.requirements.includes(c.id)),
  ];
  const rows = [...criteria, ...mechanicalRows];
  const serious = rev.findings.filter(f => f.severity === 'blocker' || f.severity === 'major');
  // The reviewer's own verdict can only make the result stricter, never looser.
  let verdict = 'pass';
  if (rows.some(r => r.result === 'fail') || serious.length || rev.verdict === 'fail') verdict = 'fail';
  else if (rows.some(r => r.result !== 'pass') || rev.verdict !== 'pass') verdict = 'not_proven';
  const evidence = { task: id, criteria: rows, findings: rev.findings, verdict, verifier: rev.verifier };
  st.writeJsonAtomic(outFile, evidence, 'evidence');

  if (verdict !== 'pass') {
    const why = [
      ...rows.filter(r => r.result !== 'pass').map(r => `${r.id} ${r.result} (${r.check})`),
      ...serious.map(f => `${f.severity}: ${f.claim}${f.file ? ` at ${f.file}:${f.line ?? '?'}` : ''}`),
      ...(rev.verdict !== 'pass' ? [`reviewer verdict ${rev.verdict}`] : []),
    ].join('; ');
    t.evidence = outFile;
    if (t.attempts >= t.max_attempts) {
      t.status = 'blocked';
      t.escalation = `blocked after ${t.attempts} attempts. Last verdict ${verdict}: ${why}`;
      saveTasks(root, slug, doc);
      ensureDecision(root, slug, 'unblock', `Task ${id} "${t.title}" is ${t.escalation}`,
        ['retry with guidance', 'take over manually', 'kill task'], { task: id, allow_free_text: true });
    } else {
      t.status = 'failed';
      t.escalation = `attempt ${t.attempts} of ${t.max_attempts} ${verdict}: ${why}`;
      saveTasks(root, slug, doc);
    }
  } else {
    t.evidence = outFile;
    saveTasks(root, slug, doc);
  }
  return { verdict, evidence };
}

export function markPassed(root, slug, id, evidenceFile) {
  return setTask(root, slug, id, { status: 'passed', evidence: evidenceFile, escalation: null });
}

// ---------- verification planning ----------
export function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const RISK_ORDER = st.RISK_ORDER;
export function riskOfPaths(root, slug, files) {
  const bet = st.readFm(st.betPath(root, slug)).data;
  const policy = st.loadPolicy(root);
  const laneFile = join(st.HOME, 'lanes', bet.lane, 'risk-paths.yaml');
  const rules = [
    ...(existsSync(laneFile) ? yparse(readFileSync(laneFile, 'utf8')).paths || [] : []),
    ...(policy.lanes?.[bet.lane]?.risk_paths || []),
  ].map(r => ({ re: globToRegex(r.glob), risk: r.risk }));
  let risk = 'none'; const paths = [];
  for (const f of files) {
    const hit = rules.filter(r => r.re.test(f)).map(r => r.risk).sort((a, b) => RISK_ORDER.indexOf(b) - RISK_ORDER.indexOf(a))[0];
    if (!hit) continue;
    paths.push(`${f} (${hit})`);
    if (RISK_ORDER.indexOf(hit) > RISK_ORDER.indexOf(risk)) risk = hit;
  }
  const effective = st.maxRisk(bet.risk, risk);
  const needs_ack = !!st.lanePolicy(policy, bet.lane, effective).human_ack_before_build && effective !== 'none';
  return { risk, paths, needs_ack, effective };
}

function detectStacks(wt) {
  const stacks = [];
  const has = (dir, test) => existsSync(dir) && readdirSync(dir).some(test);
  if (has(wt, f => f.endsWith('.sln')) || has(join(wt, 'src'), f => f.endsWith('.sln'))) stacks.push('dotnet');
  if (existsSync(join(wt, 'package.json'))) stacks.push('node');
  return stacks;
}

// Tiers the runner runs as commands; "adversarial" is the reviewer seat and "human" is acceptance.
export const COMMAND_TIERS = ['mechanical', 'specified', 'contracts', 'invariants', 'behavioural', 'dual_run'];

// mechanicalPlan: commands for every command tier the policy requires at the bet's risk.
// A required tier with no command is returned as { tier, cmd: null, missing: true } so verify
// records it as not_proven instead of silently dropping it (finding 3).
export function mechanicalPlan(root, slug, wt) {
  const bet = st.readFm(st.betPath(root, slug)).data;
  const policy = st.loadPolicy(root);
  const tiers = st.lanePolicy(policy, bet.lane, bet.risk).tiers || policy.lanes?.[bet.lane]?.tiers_default || ['mechanical'];
  const commandTiers = COMMAND_TIERS.filter(t => tiers.includes(t));
  const project = policy.verify?.commands;
  let byTier;
  if (project) byTier = t => project[t] || [];
  else {
    const laneFile = join(st.HOME, 'lanes', bet.lane, 'verifiers.yaml');
    const lane = existsSync(laneFile) ? yparse(readFileSync(laneFile, 'utf8')).tiers || {} : {};
    const stacks = detectStacks(wt);
    byTier = t => stacks.flatMap(sk => lane[t]?.[sk] || []);
  }
  return commandTiers.flatMap(t => {
    const cmds = byTier(t);
    return cmds.length ? cmds.map(cmd => ({ tier: t, cmd })) : [{ tier: t, cmd: null, missing: true }];
  });
}

// producerVendor: vendor of the newest producer run (implementer/hardener) for a task.
export function producerVendor(root, slug, task) {
  const d = st.runsDir(root, slug);
  let best = null;
  for (const run of existsSync(d) ? readdirSync(d) : []) {
    if (!/^(implementer|hardener)-/.test(run)) continue;
    const claim = join(d, run, 'claim.json'), caps = join(d, run, 'adapter.json');
    if (!existsSync(claim) || !existsSync(caps)) continue;
    try { if (st.readJson(claim).task !== task) continue; } catch { continue; }
    const m = statSync(claim).mtimeMs;
    if (!best || m > best.m) best = { m, vendor: st.readJson(caps).vendor };
  }
  return best ? best.vendor : '';
}

export function crossFamily(root, slug) {
  const bet = st.readFm(st.betPath(root, slug)).data;
  return !!st.lanePolicy(st.loadPolicy(root), bet.lane, bet.risk).cross_family;
}

// ---------- decisions ----------
export function ensureDecision(root, slug, type, context, options, extra = {}) {
  const doc = st.loadDecisions(root, slug);
  const open = doc.decisions.find(d => d.type === type && d.status !== 'answered' && (extra.task ? d.task === extra.task : true));
  if (open && !(extra.risk && open.risk !== extra.risk)) return open;
  if (open) st.supersedeDecision(root, slug, open.id, `superseded: risk is now ${extra.risk}`);
  return st.addDecision(root, slug, { type, context, options, allow_free_text: extra.allow_free_text ?? true, task: extra.task, risk: extra.risk });
}

const latest = (root, slug, type) => st.loadDecisions(root, slug).decisions.filter(d => d.type === type && d.status === 'answered' && d.answer !== 'superseded').pop();
export const designApproved = (root, slug) => latest(root, slug, 'approve_design')?.answer === 'approve';
// An ack covers the risk level it was given for; a later raise needs a new ack (finding 3).
export function ackRecorded(root, slug) {
  const d = latest(root, slug, 'ack_risk');
  if (d?.answer !== 'ack') return false;
  const risk = st.readFm(st.betPath(root, slug)).data.risk;
  return st.RISK_ORDER.indexOf(d.risk || 'none') >= st.RISK_ORDER.indexOf(risk);
}
export const ackDeclined = (root, slug) => latest(root, slug, 'ack_risk')?.answer === 'decline';

function effectFor(root, slug, extra) {
  return (d, answer, { by, text }) => {
    if (d.type === 'approve_design') return answer === 'approve' ? 'design approved' : `changes requested${text ? `: ${text}` : ''}; re-run bridgie shape ${slug}`;
    if (d.type === 'ack_risk') return answer === 'ack' ? 'risk paths acknowledged' : 'declined; build and verify stay stopped';
    if (d.type === 'unblock') {
      const id = d.task;
      if (answer === 'retry with guidance') {
        const t = loadTasks(root, slug).tasks.find(x => x.id === id);
        setTask(root, slug, id, { status: 'failed', max_attempts: t.max_attempts + 1, escalation: `${t.escalation || ''}${text ? ` | guidance: ${text}` : ''}` });
        return `task ${id} gets one more attempt`;
      }
      if (answer === 'take over manually') { setTask(root, slug, id, { status: 'verify' }); return `task ${id} handed to ${by}; commit in its worktree, then bridgie verify ${slug} --task ${id}`; }
      if (answer === 'kill task') { setTask(root, slug, id, { escalation: `killed by ${by}` }); return `task ${id} killed; re-plan the bet to continue`; }
    }
    if (d.type === 'accept') return acceptEffect(root, slug, answer, { by, text, gitSha: extra.gitSha });
    if (d.type === 'confidence') {
      const m = answer.match(/^accept (opinion|anecdote|data|test)$/);
      if (m) { st.setFm(st.betPath(root, slug), { confidence: m[1] }, 'bet'); return `confidence set to ${m[1]}`; }
      return 'confidence unchanged';
    }
    return null;
  };
}

// answer: the one entry point for answering any decision (CLI, surface, shorthands).
export function answer(root, slug, id, ans, opts = {}) {
  const d = st.answerDecision(root, slug, id, ans, { ...opts, effectFn: effectFor(root, slug, opts) });
  // Raise follow-up decisions only after the answer is saved (answerDecision rewrites the file).
  if (d.type === 'accept' && /^approval \d+ of \d+ recorded$/.test(d.effect)) {
    const { data } = st.readFm(acceptancePath(root, slug));
    ensureDecision(root, slug, 'accept', `Another approval needed for "${data.title}" (${data.approvals.length} of ${data.approvers_required}; not ${data.approvals.map(a => a.by).join(', ')}).`,
      ['approve', 'approve with conditions', 'reject'], { allow_free_text: true });
  }
  return d;
}

// acceptancePacket: the runner's own summary for the packager — every task's verdict and rows,
// findings, and cost totals. Returns { md, cost }.
export function acceptancePacket(root, slug, diffStat = '') {
  const doc = loadTasks(root, slug);
  const lines = [`# Acceptance packet — ${slug}`, '', '## Tasks', '', '| Task | Title | Attempts | Status | Verdict |', '|---|---|---|---|---|'];
  const details = [];
  for (const t of doc.tasks) {
    const ev = t.evidence && existsSync(t.evidence) ? st.readJson(t.evidence) : null;
    lines.push(`| ${t.id} | ${t.title} | ${t.attempts} | ${t.status} | ${ev ? ev.verdict : 'no evidence'} |`);
    if (!ev) continue;
    details.push(`### ${t.id} evidence`, '', '| Criterion | Tier | Check | Result |', '|---|---|---|---|',
      ...ev.criteria.map(c => `| ${c.id} | ${c.tier} | ${String(c.check).replace(/\|/g, '/')} | ${c.result} |`), '');
    if (ev.findings.length) details.push(`Findings for ${t.id}:`, ...ev.findings.map(f => `- ${f.severity}: ${f.claim}${f.file ? ` (${f.file}:${f.line ?? '?'})` : ''}`), '');
  }
  let entries = 0, seconds = 0, retries = 0;
  const d = st.runsDir(root, slug);
  for (const run of existsSync(d) ? readdirSync(d) : []) {
    const c = join(d, run, 'cost.json');
    if (!existsSync(c)) continue;
    for (const e of st.readJson(c).entries) { entries++; seconds += e.duration_s || 0; }
  }
  for (const t of doc.tasks) retries += Math.max(0, t.attempts - 1);
  const cost = { seat_runs: entries, seconds, attempts_total: doc.tasks.reduce((n, t) => n + t.attempts, 0), retries, usd: null };
  lines.push('', ...details, '## Change', '', '```', diffStat.trim() || '(no diff stat)', '```', '',
    '## Cost', '', `${cost.seat_runs} seat runs, ${cost.seconds}s, ${cost.attempts_total} attempts (${cost.retries} retries). Token cost not reported by all adapters.`, '');
  return { md: lines.join('\n'), cost };
}

// proposeConfidence: a seat's confidence proposal becomes a decision the owner answers; nothing
// changes until they accept. Returns the decision, or null when the proposal is not a valid tier.
export function proposeConfidence(root, slug, text, raisedBy) {
  const m = String(text).match(/\b(opinion|anecdote|data|test)\b/i);
  if (!m) return null;
  const tier = m[1].toLowerCase();
  const current = st.readFm(st.betPath(root, slug)).data.confidence;
  if (tier === current) return null;
  const open = st.loadDecisions(root, slug).decisions.find(d => d.type === 'confidence' && d.status !== 'answered');
  if (open) st.supersedeDecision(root, slug, open.id, 'superseded by a newer confidence proposal');
  return st.addDecision(root, slug, { type: 'confidence', context: `Evidence proposal: confidence ${current} → ${tier}. ${text}`, options: [`accept ${tier}`, `keep ${current}`], allow_free_text: false, raised_by: raisedBy });
}

// ---------- acceptance ----------
// featureSha: the commit of bridgie/<slug>, or null outside git.
export function featureSha(root, slug) {
  try { return execFileSync('git', ['-C', root, 'rev-parse', '-q', '--verify', `bridgie/${slug}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

// packageDigest: one hash over everything an approval vouches for — requirements, design,
// the task list with statuses, and every task's evidence file.
export function packageDigest(root, slug) {
  const h = createHash('sha256');
  const add = (name, f) => { h.update(`${name}\0`); h.update(existsSync(f) ? readFileSync(f) : '(missing)'); h.update('\0'); };
  const dir = join(root, '.bridgie', 'specs', slug);
  add('requirements.md', join(dir, 'requirements.md'));
  add('design.md', join(dir, 'design.md'));
  add('tasks.json', st.tasksPath(root, slug));
  for (const t of loadTasks(root, slug).tasks) if (t.evidence) add(`evidence:${t.id}`, t.evidence);
  return h.digest('hex');
}

// stalePackage: why the acceptance package no longer describes the work, or null if it still does.
export function stalePackage(root, slug, data) {
  const pending = loadTasks(root, slug).tasks.filter(t => t.status !== 'passed');
  if (pending.length) return `tasks no longer passed: ${pending.map(t => `${t.id} (${t.status})`).join(', ')}`;
  if (data.packaged_digest && data.packaged_digest !== packageDigest(root, slug)) return 'requirements, design, tasks or evidence changed since the package was built';
  const sha = featureSha(root, slug);
  if (data.packaged_sha && sha !== data.packaged_sha) return `bridgie/${slug} moved from ${data.packaged_sha.slice(0, 10)} to ${sha ? sha.slice(0, 10) : 'nothing'} since the package was built`;
  return null;
}

// invalidateAcceptance: close pending accept decisions and mark the package superseded.
export function invalidateAcceptance(root, slug, reason) {
  for (const d of st.loadDecisions(root, slug).decisions.filter(x => x.type === 'accept' && x.status !== 'answered')) st.supersedeDecision(root, slug, d.id, `superseded: ${reason}`);
  const f = acceptancePath(root, slug);
  if (!existsSync(f)) return;
  const { data, body } = st.readFm(f);
  if (data.decision === 'pending') st.writeFm(f, { ...data, decision: 'superseded', conditions: [...(data.conditions || []), `superseded: ${reason}`] }, body, 'acceptance');
}

export function writeAcceptance(root, slug, { body, residual = [], cost = {} }) {
  const pending = loadTasks(root, slug).tasks.filter(t => t.status !== 'passed');
  if (pending.length) throw new Error(`cannot accept "${slug}": tasks not passed: ${pending.map(t => t.id).join(', ')}`);
  invalidateAcceptance(root, slug, 'a new package was built');
  const bet = st.readFm(st.betPath(root, slug)).data;
  const required = st.lanePolicy(st.loadPolicy(root), bet.lane, bet.risk).approvers || 1;
  const data = { bet: slug, title: bet.title, decision: 'pending', approver: null, decided_at: null, git_sha: null, conditions: [], residual_uncertainty: residual, cost, approvals: [], approvers_required: required,
    risk: bet.risk, packaged_at: st.now(), packaged_sha: featureSha(root, slug), packaged_digest: packageDigest(root, slug) };
  st.writeFm(acceptancePath(root, slug), data, body.startsWith('\n') ? body : `\n${body}`, 'acceptance');
  ensureDecision(root, slug, 'accept', `Accept "${bet.title}"? ${required} approval(s) required. Read the acceptance package first.`,
    ['approve', 'approve with conditions', 'reject'], { allow_free_text: true });
}

function acceptEffect(root, slug, ans, { by, text, gitSha }) {
  const f = acceptancePath(root, slug);
  const { data, body } = st.readFm(f);
  if (ans !== 'approve' && !text) throw new Error(`"${ans}" needs a reason or the conditions (--text)`);
  if (data.decision !== 'pending') throw new Error(`the acceptance package for "${slug}" is ${data.decision}; run bridgie accept ${slug} to build a new one`);
  if (ans === 'reject') {
    st.writeFm(f, { ...data, decision: 'rejected', approver: by, decided_at: st.now(), git_sha: data.packaged_sha || gitSha || null, conditions: [text] }, body, 'acceptance');
    return 'rejected; fix and re-run bridgie accept';
  }
  // Approval is bound to what was packaged (finding 1): re-check the gates at the moment of approval.
  const stale = stalePackage(root, slug, data);
  if (stale) throw new Error(`the acceptance package for "${slug}" is stale: ${stale}. Run bridgie accept ${slug} again`);
  if (data.packaged_sha && gitSha && gitSha !== data.packaged_sha) throw new Error(`approval names ${gitSha.slice(0, 10)} but the package was built at ${data.packaged_sha.slice(0, 10)}`);
  const bet = st.readFm(st.betPath(root, slug)).data;
  const required = Math.max(data.approvers_required, st.lanePolicy(st.loadPolicy(root), bet.lane, bet.risk).approvers || 1);
  if (data.approvals.some(a => a.by === by)) throw new Error(`${by} already approved; a different approver is required`);
  const sha = data.packaged_sha || gitSha || null;
  const approvals = [...data.approvals, { by, at: st.now(), decision: ans, conditions: text || null, sha, digest: data.packaged_digest || null }];
  const conditions = approvals.filter(a => a.conditions).map(a => a.conditions);
  if (approvals.length < required) {
    st.writeFm(f, { ...data, approvers_required: required, approvals, conditions }, body, 'acceptance');
    return `approval ${approvals.length} of ${required} recorded`;
  }
  const decision = approvals.some(a => a.decision === 'approve with conditions') ? 'approved_with_conditions' : 'approved';
  st.writeFm(f, { ...data, approvers_required: required, approvals, conditions, decision, approver: approvals.map(a => a.by).join(', '), decided_at: st.now(), git_sha: sha }, body, 'acceptance');
  st.betTransition(root, slug, 'delivered');
  return `${decision}; bet delivered. Merge bridgie/${slug} when you are ready.`;
}

// ---------- CLI ----------
function flag(a, n) { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; }
const out = x => process.stdout.write((typeof x === 'string' ? x : JSON.stringify(x, null, 2)) + '\n');
const OPS = {
  'requirement-ids': a => out(requirementIds(a[0], a[1])),
  'write-spec': a => out(writeSpecFiles(a[0], a[1], a[2]).ids.join(' ')),
  'write-tasks': a => out(writeTasksFromPlan(a[0], a[1], a[2])),
  'ready-tasks': a => out(readyTasks(a[0], a[1]).map(t => t.id).join('\n')),
  'task-get': a => out(getTask(loadTasks(a[0], a[1]), a[2])),
  'task-set': a => out(setTask(a[0], a[1], a[2], JSON.parse(a[3]))),
  'start-attempt': a => out(startAttempt(a[0], a[1], a[2], a[3])),
  'reconcile': a => out(reconcile(a[0], a[1], a[2], a[3], JSON.parse(readFileSync(a[4], 'utf8')), a[5]).verdict),
  'fail-attempt': a => out(failAttempt(a[0], a[1], a[2], a[3]).status),
  'recover-attempts': a => out(recoverAttempts(a[0], a[1]).join('\n')),
  'stamp-task': a => { stampTask(a[0], a[1]); out('ok'); },
  'risk-of-paths': a => out(riskOfPaths(a[0], a[1], readFileSync(a[2], 'utf8').split('\n').filter(Boolean))),
  'mechanical-plan': a => out(mechanicalPlan(a[0], a[1], a[2])),
  'producer-vendor': a => out(producerVendor(a[0], a[1], a[2])),
  'cross-family': a => out(String(crossFamily(a[0], a[1]))),
  'mark-passed': a => out(markPassed(a[0], a[1], a[2], a[3])),
  'all-passed': a => out(String(allPassed(a[0], a[1]))),
  'ensure-decision': a => out(ensureDecision(a[0], a[1], a[2], a[3], JSON.parse(a[4]), { ...(flag(a, 'task') ? { task: flag(a, 'task') } : {}), ...(flag(a, 'risk') ? { risk: flag(a, 'risk') } : {}) }).id),
  'propose-confidence': a => out(proposeConfidence(a[0], a[1], a[2], flag(a, 'run') ? { seat: flag(a, 'seat') || 'evidence', run: flag(a, 'run') } : null)?.id || ''),
  'raise-risk': a => out(st.raiseRisk(a[0], a[1], a[2], flag(a, 'reason') || 'raised by the runner')),
  'stale-package': a => { const f = acceptancePath(a[0], a[1]); out(existsSync(f) ? stalePackage(a[0], a[1], st.readFm(f).data) || '' : 'no package'); },
  'invalidate-acceptance': a => { invalidateAcceptance(a[0], a[1], a[2] || 'invalidated'); out('ok'); },
  'design-approved': a => out(String(designApproved(a[0], a[1]))),
  'ack-recorded': a => out(String(ackRecorded(a[0], a[1]))),
  'ack-declined': a => out(String(ackDeclined(a[0], a[1]))),
  'decision-answer': a => out(answer(a[0], a[1], a[2], a[3], { text: flag(a, 'text'), by: flag(a, 'by'), gitSha: flag(a, 'sha') })),
  'pending-of-type': a => out(st.listDecisions(a[0], a[1], { pending: true }).filter(d => d.type === a[2]).map(d => d.id).join('\n')),
  'acceptance-packet': a => {
    const diffStat = a[3] && existsSync(a[3]) ? readFileSync(a[3], 'utf8') : '';
    const { md, cost } = acceptancePacket(a[0], a[1], diffStat);
    writeFileSync(a[2], md);
    out(cost);
  },
  'write-acceptance': a => {
    const o = st.readJson(a[2]);
    const cost = JSON.parse(a[3] || '{}');
    const body = o.artifact_md || o.summary_md;
    const sec = body.split(/^## /m).find(x => /^residual uncertainty/i.test(x)) || '';
    const residual = sec.split('\n').filter(l => /^\s*-\s+/.test(l)).map(l => l.replace(/^\s*-\s+/, '').trim());
    out(writeAcceptance(a[0], a[1], { body, residual, cost }) ?? 'ok');
  },
};
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [op, ...a] = process.argv.slice(2);
  try {
    if (!OPS[op]) throw new Error(`unknown op "${op}"`);
    OPS[op](a);
  } catch (e) { console.error(`flow.mjs: ${e.message}`); process.exit(1); }
}
