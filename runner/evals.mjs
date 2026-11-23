// Reviewer calibration: how often does a reviewer model catch a bug that was planted on purpose,
// and how often does it fail a change that is fine? Cases live in evals/reviewer/<name>/:
//   case.json   title, stack, test command, requirements, the producer's claim, and `planted`:
//               the defects in the change ([] for a clean case), each { file, anchor, about }
//   base/       the repository before the change        change/   files the change adds or replaces
// A case's own tests pass with the change applied: the planted bug is one the tests do not catch,
// which is the only kind a reviewer is needed for.
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import * as st from './state.mjs';

export const CASES_DIR = join(st.HOME, 'evals', 'reviewer');
const SERIOUS = ['blocker', 'major'];

function tree(dir, rel = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(n => (statSync(join(dir, n)).isDirectory() ? tree(join(dir, n), `${rel}${n}/`) : [`${rel}${n}`]));
}

// loadCases: every case in a directory, with each planted defect's line found from its anchor.
export function loadCases(dir = CASES_DIR, only = null) {
  if (!existsSync(dir)) throw new Error(`no eval cases at ${dir}`);
  const names = readdirSync(dir).filter(n => existsSync(join(dir, n, 'case.json'))).sort();
  const want = only ? names.filter(n => only.includes(n)) : names;
  if (only) for (const n of only) if (!names.includes(n)) throw new Error(`no eval case "${n}" in ${dir} (cases: ${names.join(', ')})`);
  return want.map(name => {
    const root = join(dir, name), c = JSON.parse(readFileSync(join(root, 'case.json'), 'utf8'));
    const planted = (c.planted || []).map(p => {
      const text = readFileSync(join(root, 'change', p.file), 'utf8');
      const at = text.indexOf(p.anchor);
      if (at < 0) throw new Error(`eval case ${name}: anchor not found in change/${p.file}`);
      return { ...p, line: text.slice(0, at).split('\n').length };
    });
    return { name, dir: root, ...c, planted, base: tree(join(root, 'base')), change: tree(join(root, 'change')) };
  });
}

const sameFile = (found, planted) => {
  if (!found) return false;
  const a = String(found).replace(/\\/g, '/').replace(/^\.\//, ''), b = planted.replace(/\\/g, '/');
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
};

// scoreCase: what the reviewer's evidence says about one case.
//   caught        a blocker or major finding names the planted defect: the right file within a few
//                 lines of it, or words that describe it
//   missed        the planted defect was not named (whatever the verdict: failing the change for
//                 another reason does not find the bug)
//   clean pass    a clean change passed with no serious finding
//   false alarm   a clean change was failed, or given a blocker or major finding
export function scoreCase(c, evidence, slack = 6) {
  const serious = (evidence.findings || []).filter(f => SERIOUS.includes(f.severity));
  const brief = f => ({ severity: f.severity, file: f.file ?? null, line: f.line ?? null, claim: String(f.claim || '').slice(0, 300) });
  if (!c.planted.length) {
    const alarm = evidence.verdict !== 'pass' || serious.length > 0;
    return { name: c.name, planted: false, result: alarm ? 'false alarm' : 'clean pass', verdict: evidence.verdict, serious: serious.length, findings: serious.map(brief) };
  }
  const hits = c.planted.map(p => serious.find(f => {
    const near = sameFile(f.file, p.file) && Number.isInteger(f.line) && Math.abs(f.line - p.line) <= slack;
    const words = new RegExp(p.about, 'i').test(`${f.claim || ''} ${f.repro || ''}`) && (!f.file || sameFile(f.file, p.file));
    return near || words;
  }));
  const caught = hits.every(Boolean);
  return { name: c.name, planted: true, result: caught ? 'caught' : 'missed', verdict: evidence.verdict, serious: serious.length,
    other_serious: serious.filter(f => !hits.includes(f)).length, findings: serious.map(brief) };
}

// summarise: the numbers a person needs to decide how far to trust a reviewer.
export function summarise(results) {
  const ran = results.filter(r => r.result && !['skipped', 'error'].includes(r.result));
  const bugs = ran.filter(r => r.planted), clean = ran.filter(r => !r.planted);
  const caught = bugs.filter(r => r.result === 'caught').length, alarms = clean.filter(r => r.result === 'false alarm').length;
  return { cases: results.length, ran: ran.length, planted: bugs.length, caught, missed: bugs.length - caught, clean: clean.length, false_alarms: alarms,
    recall: bugs.length ? caught / bugs.length : null, false_alarm_rate: clean.length ? alarms / clean.length : null,
    skipped: results.filter(r => r.result === 'skipped').length, errors: results.filter(r => r.result === 'error').length };
}
export function summaryText(s) {
  if (!s.ran) return 'no case could be run';
  const parts = [];
  if (s.planted) parts.push(`caught ${s.caught} of ${s.planted} planted bugs`);
  if (s.clean) parts.push(`${s.false_alarms} false alarm${s.false_alarms === 1 ? '' : 's'} on ${s.clean} clean change${s.clean === 1 ? '' : 's'}`);
  return parts.join('; ');
}

// ---------- stored results (per machine: a reviewer is a model CLI on this computer) ----------
export const evalsFile = () => join(process.env.BRIDGIE_EVALS_HOME || join(homedir(), '.bridgie', 'evals'), 'reviewer.json');
export function loadRuns() {
  const f = evalsFile();
  if (!existsSync(f)) return [];
  try { const d = JSON.parse(readFileSync(f, 'utf8')); return Array.isArray(d.runs) ? d.runs : []; } catch { return []; }
}
export function saveRun(run) {
  const f = evalsFile(), runs = [...loadRuns(), run].slice(-50);
  mkdirSync(join(f, '..'), { recursive: true });
  writeFileSync(f, JSON.stringify({ runs }, null, 2) + '\n');
  return f;
}
// calibration: the latest stored eval of an adapter (and model, when given), or null.
export function calibration(adapter, model = null) {
  const runs = loadRuns().filter(r => r.adapter === adapter && (!model || r.model === model) && r.summary?.ran);
  return runs.length ? runs[runs.length - 1] : null;
}
export function calibrationText(adapter) {
  const r = calibration(adapter);
  if (!r) return `${adapter}: never tested with planted bugs (bridgie eval reviewer --adapter ${adapter})`;
  return `${adapter}${r.model && r.model !== 'default' ? ` (${r.model})` : ''}: ${summaryText(r.summary)}, tested ${r.at.slice(0, 10)}`;
}
