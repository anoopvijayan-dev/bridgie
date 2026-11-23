// Mutation check: would the tests notice if the new code were slightly wrong?
// For each line a change added, make one small edit at a time (">" to ">=", "and" to "or", "+" to
// "-", True to False, a number plus one, a "not" removed), run the tests, and put the line back.
// A test that fails "kills" the mutant. A mutant that survives is a change to the code that no
// test noticed: either a test is missing, or the edit cannot matter (an equivalent mutant), which
// is why the bar is a share of mutants killed and not all of them.
//
// Works on text, so it is language-neutral and rough: it only touches operators with spaces around
// them, whole words and whole numbers, never inside a string or a comment, never in test files.
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const CODE = /\.(py|js|mjs|cjs|jsx|ts|tsx|cs|java|go|rb|rs|php|kt|swift|c|cc|cpp|h|hpp|scala)$/i;
const TEST_PATH = /(^|\/)(tests?|spec|specs|__tests__|checks|testing|fixtures)\/|(^|\/)(test_[^/]*|[^/]*(_test|\.test|\.spec|\.check|Tests?))\.[a-z]+$/;
export const isMutable = file => CODE.test(file) && !TEST_PATH.test(file.replace(/\\/g, '/'));

// Each operator: what to look for (a global regex) and what it becomes.
const OPS = [
  [/ >= /g, ' > '], [/ <= /g, ' < '], [/ > /g, ' >= '], [/ < /g, ' <= '],
  [/===/g, '!=='], [/!==/g, '==='], [/(?<![=!<>])==(?!=)/g, '!='], [/!=(?!=)/g, '=='],
  [/ and /g, ' or '], [/ or /g, ' and '], [/&&/g, '||'], [/\|\|/g, '&&'],
  [/\bTrue\b/g, 'False'], [/\bFalse\b/g, 'True'], [/\btrue\b/g, 'false'], [/\bfalse\b/g, 'true'],
  [/ \+ /g, ' - '], [/ - /g, ' + '], [/ \* /g, ' / '],
  [/\bnot /g, ''], [/!(?=[A-Za-z_(])/g, ''],
  [/(?<![\w.])\d+(?![\w.])/g, m => String(Number(m) + 1)],
];
const SKIP_LINE = /^\s*($|#|\/\/|\/\*|\*|@|import\b|from\b.*\bimport\b|using\b|package\b|export\s+\{|export\s+\*|"""|'''|"[^"]*"\s*$|'[^']*'\s*$)/;

// codePart: the line up to a trailing comment, and a test for "is this position inside a string".
function codePart(line) {
  let quote = null, end = line.length;
  const inString = new Array(line.length).fill(false);
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) { inString[i] = true; if (ch === '\\') { i++; if (i < line.length) inString[i] = true; } else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; inString[i] = true; continue; }
    if (ch === '#' || (ch === '/' && line[i + 1] === '/')) { end = i; break; }
  }
  return { end, inString };
}

// candidates: every single-edit mutant of the given lines (1-based) of a file's text.
export function candidates(text, lines) {
  const src = text.split('\n'), out = [];
  for (const n of [...lines].sort((a, b) => a - b)) {
    const line = src[n - 1];
    if (line === undefined || SKIP_LINE.test(line)) continue;
    const { end, inString } = codePart(line);
    for (const [re, to] of OPS) {
      re.lastIndex = 0;
      for (let m; (m = re.exec(line));) {
        const at = m.index;
        if (at >= end || inString[at] || inString[at + m[0].length - 1]) continue;
        const repl = typeof to === 'function' ? to(m[0]) : to;
        out.push({ line: n, col: at, from: m[0].trim() || m[0], to: repl.trim(), text: line.slice(0, at) + repl + line.slice(at + m[0].length) });
      }
    }
  }
  return out;
}

// pick: at most `max` mutants, spread over the changed lines before any line gets a second one.
export function pick(all, max) {
  const byLine = new Map();
  for (const c of all) { const k = `${c.file}:${c.line}`; if (!byLine.has(k)) byLine.set(k, []); byLine.get(k).push(c); }
  const groups = [...byLine.values()], out = [];
  for (let round = 0; out.length < max && groups.some(g => g.length > round); round++) for (const g of groups) { if (out.length >= max) break; if (g[round]) out.push(g[round]); }
  return out;
}

const git = (cwd, args) => { const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); return { ok: r.status === 0, out: (r.stdout || '').replace(/\r?\n$/, '') }; };

// changedLines: { file: [line numbers the change added or rewrote] } against a base commit,
// for files this check mutates. Uncommitted work counts.
export function changedLines(cwd, base) {
  const out = {};
  const names = git(cwd, ['diff', '--name-only', '--diff-filter=AM', base, '--', '.', ':(exclude).bridgie']);
  if (!names.ok) throw new Error(`cannot diff against ${base}`);
  for (const file of names.out.split(/\r?\n/).filter(Boolean)) {
    if (!isMutable(file)) continue;
    const lines = [];
    for (const m of git(cwd, ['diff', '-U0', '--no-color', base, '--', file]).out.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
      const start = Number(m[1]), count = m[2] === undefined ? 1 : Number(m[2]);
      for (let i = 0; i < count; i++) lines.push(start + i);
    }
    if (lines.length) out[file] = lines;
  }
  // files not yet added to git are new in full
  for (const file of git(cwd, ['ls-files', '--others', '--exclude-standard', '--', '.', ':(exclude).bridgie']).out.split(/\r?\n/).filter(Boolean)) {
    if (!isMutable(file) || out[file]) continue;
    const n = readFileSync(join(cwd, file), 'utf8').split('\n').length;
    out[file] = Array.from({ length: n }, (_, i) => i + 1);
  }
  return out;
}

// A mutant is in the working tree while its tests run. If the process dies then, the journal lets
// the next run (and bridgie verify, before it commits anything) put the original back.
const journal = cwd => { const d = git(cwd, ['rev-parse', '--absolute-git-dir']); return d.ok ? join(d.out, 'bridgie-mutation.json') : null; };
export function restorePending(cwd) {
  const j = journal(cwd);
  if (!j || !existsSync(j)) return null;
  try { const { file, original } = JSON.parse(readFileSync(j, 'utf8')); writeFileSync(join(cwd, file), original); rmSync(j, { force: true }); return file; }
  catch { rmSync(j, { force: true }); return null; }
}

// run: the whole check in `cwd`. Returns { total, killed, survivors, score, ok, note }; prints as it goes.
export function run(cwd, { base, test, max = 20, min = 0.6, timeoutS = null, print = s => process.stdout.write(`${s}\n`) } = {}) {
  cwd = resolve(cwd);
  const restored = restorePending(cwd);
  if (restored) print(`mutation: put back ${restored}, left changed by an interrupted run`);
  const lines = changedLines(cwd, base);
  const all = [];
  for (const [file, ns] of Object.entries(lines)) for (const c of candidates(readFileSync(join(cwd, file), 'utf8').replace(/\r\n/g, '\n'), ns)) all.push({ file, ...c });
  const files = Object.keys(lines).length;
  if (!all.length) { print(`mutation: nothing to try (${files ? `${files} changed code file(s), no operator, condition or number on the changed lines` : 'the change touches no code file this check mutates'})`); return { total: 0, killed: 0, survivors: [], score: null, ok: true, note: 'nothing to mutate' }; }
  if (!test) { print('mutation: no test command (set verify.commands.specified, or mutation.test, in .bridgie/policy.yaml)'); return { total: 0, killed: 0, survivors: [], score: null, ok: false, note: 'no test command' }; }
  const tests = ms => spawnSync(test, { cwd, shell: true, stdio: 'ignore', timeout: ms, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  const t0 = Date.now(), first = tests(timeoutS ? timeoutS * 1000 : 30 * 60 * 1000), took = Date.now() - t0;
  if (first.status !== 0) { print(`mutation: the tests do not pass before any change is made (${test}); nothing was tried`); return { total: 0, killed: 0, survivors: [], score: null, ok: false, note: 'baseline fails' }; }
  const limit = timeoutS ? timeoutS * 1000 : Math.max(20000, took * 4);
  const chosen = pick(all, max);
  print(`mutation: the tests pass (${(took / 1000).toFixed(1)}s); trying ${chosen.length} of ${all.length} small changes on ${new Set(all.map(c => `${c.file}:${c.line}`)).size} changed line(s) in ${files} file(s)`);
  const j = journal(cwd), survivors = [];
  let killed = 0;
  for (const c of chosen) {
    const path = join(cwd, c.file), original = readFileSync(path, 'utf8');
    const eol = original.includes('\r\n') ? '\r\n' : '\n', src = original.replace(/\r\n/g, '\n').split('\n');
    const was = src[c.line - 1];
    src[c.line - 1] = c.text;
    if (j) writeFileSync(j, JSON.stringify({ file: c.file, original }));
    let r;
    try { writeFileSync(path, src.join(eol)); r = tests(limit); }
    finally { writeFileSync(path, original); if (j) rmSync(j, { force: true }); }
    const dead = r.status !== 0;            // a failing test, or a hang cut short, both notice the change
    if (dead) killed++; else survivors.push({ file: c.file, line: c.line, from: c.from, to: c.to, code: was.trim() });
    print(`  ${dead ? 'killed  ' : 'survived'}  ${c.file}:${c.line}  "${c.from}" → "${c.to}"${dead ? '' : `    ${was.trim().slice(0, 100)}`}`);
  }
  const score = killed / chosen.length, ok = score >= min;
  print(`mutation: ${killed} of ${chosen.length} noticed by the tests (${Math.round(score * 100)}%); ${survivors.length} survived; the bar is ${Math.round(min * 100)}%`);
  if (survivors.length) print('a survivor is a change to the new code that no test noticed: add a test that fails for it, or say why it cannot matter');
  return { total: chosen.length, killed, survivors, score, ok, note: '' };
}
