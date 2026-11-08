// Shared helpers for bridgie commands. Plain Node: no bash, no coreutils, same on Windows, macOS, Linux.
import { existsSync, statSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, delimiter, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as st from '../state.mjs';

export const HOME = st.HOME;
export const IS_WIN = process.platform === 'win32';

// BridgieExit: how a command stops. code 1 = error, 2 = verify verdict failed, 3 = a person must decide.
export class BridgieExit extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}
export const die = (msg, code = 1) => { throw new BridgieExit(msg, code); };
export const waitHuman = msg => { throw new BridgieExit(msg, 3); };
export const log = msg => process.stderr.write(`${msg}\n`);

// which: the full path of a command on PATH (PATHEXT on Windows), or null.
export function which(cmd) {
  if (!cmd) return null;
  if (cmd.includes('/') || cmd.includes('\\')) return existsSync(cmd) ? cmd : null;
  const exts = IS_WIN ? ['', ...(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').toLowerCase().split(';')] : [''];
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    for (const e of exts) {
      const p = join(dir, cmd + e);
      try { if (statSync(p).isFile()) return p; } catch { /* not here */ }
    }
  }
  return null;
}
export const needCmd = cmd => which(cmd) || die(`missing required command: ${cmd}`);

// findRoot: walk up from dir to the nearest Bridgie project, or null. A project is a folder whose
// .bridgie/ has a bets/ folder: ~/.bridgie (this machine's policy) is not a project, so folders
// under the home directory are not mistaken for one.
export const isProject = d => { try { return statSync(join(d, '.bridgie', 'bets')).isDirectory(); } catch { return false; } };
export function findRoot(dir = process.cwd()) {
  let d = resolve(dir);
  try { d = realpathSync.native(d); } catch { /* keep as given */ }
  for (;;) {
    if (isProject(d)) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}
export const projectRoot = () => findRoot() || die("not inside a bridgie project (no .bridgie/ found); run 'bridgie init' first, or 'bridgie new <folder>'");

// git: run git and return { ok, out, err, code }. Never goes through a shell.
export function git(args, { cwd, input } = {}) {
  const r = spawnSync('git', args, { cwd, input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) die(`git could not run: ${r.error.message}`);
  return { ok: r.status === 0, out: (r.stdout || '').replace(/\r?\n$/, ''), err: (r.stderr || '').trim(), code: r.status };
}
export function gitOrDie(args, opts) {
  const r = git(args, opts);
  if (!r.ok) die(`git ${args.join(' ')} failed: ${r.err || r.out}`);
  return r.out;
}

// user: who is acting — $BRIDGIE_USER, else git user.name, else the OS user.
export function user() {
  if (process.env.BRIDGIE_USER) return process.env.BRIDGIE_USER;
  const n = git(['config', 'user.name']).out.trim();
  return n || process.env.USER || process.env.USERNAME || 'unknown';
}

// stateCommit: commit .bridgie changes when inside a git repository.
export function stateCommit(root, msg) {
  if (process.env.BRIDGIE_NO_COMMIT === '1') return;
  if (!git(['-C', root, 'rev-parse', '--is-inside-work-tree']).ok) return;
  if (!git(['-C', root, 'add', '-A', '--', '.bridgie']).ok) return;
  if (git(['-C', root, 'diff', '--cached', '--quiet', '--', '.bridgie']).ok) return;
  git(['-C', root, 'commit', '-q', '-m', `bridgie: ${msg}`, '--', '.bridgie']);
}

// args: tiny flag parser. spec maps flag → 'value' | 'bool'; positionals collected in order.
export function parseArgs(argv, spec, cmd) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (!(k in spec)) die(`${cmd}: unknown argument ${a}`);
      if (spec[k] === 'bool') out[k] = true;
      else if (spec[k] === 'list') { if (i + 1 >= argv.length) die(`${cmd}: ${a} needs a value`); (out[k] ||= []).push(argv[++i]); }
      else { if (i + 1 >= argv.length) die(`${cmd}: ${a} needs a value`); out[k] = argv[++i]; }
    } else out._.push(a);
  }
  return out;
}

export const betFile = (root, slug) => join(root, '.bridgie', 'bets', slug, 'bet.md');
export function betStatus(root, slug) {
  const f = betFile(root, slug);
  if (!existsSync(f)) die(`no bet '${slug}' (bridgie bet new ${slug})`);
  return st.readFm(f).data.status;
}
export const rel = (root, p) => p.startsWith(root) ? p.slice(root.length + 1).replace(/\\/g, '/') : p;
export const today = () => new Date().toISOString().slice(0, 10);
export const version = () => readFileSync(join(HOME, 'VERSION'), 'utf8').trim();
export { extname };
