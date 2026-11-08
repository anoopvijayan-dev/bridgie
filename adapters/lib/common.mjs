// Shared argument parsing, CLI launching and output handling for adapters. Plain Node: the same on
// Windows, macOS and Linux. Contract (adapters/README.md):
//   run.mjs --probe | --capabilities --seat S [--model M] | --seat S --prompt F --out F --cwd D --mode readonly|write --model M [--effort E]
import { existsSync, statSync, writeFileSync, readFileSync, openSync, closeSync } from 'node:fs';
import { dirname, join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { extractLastJson } from './extract-json.mjs';

export const IS_WIN = process.platform === 'win32';

export function parse(argv) {
  const o = { mode: 'readonly', model: 'default', effort: '', caps: false, probe: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--probe') o.probe = true;
    else if (a === '--capabilities') o.caps = true;
    else if (['--seat', '--prompt', '--out', '--cwd', '--mode', '--model', '--effort'].includes(a)) o[a.slice(2)] = argv[++i];
    else { process.stderr.write(`adapter: unknown argument ${a}\n`); process.exit(2); }
  }
  return o;
}

export function requireRunArgs(o) {
  if (!o.prompt || !existsSync(o.prompt) || !o.out || !o.cwd || !existsSync(o.cwd)) { process.stderr.write('adapter: --prompt, --out and --cwd are required\n'); process.exit(2); }
  if (!['readonly', 'write'].includes(o.mode)) { process.stderr.write('adapter: --mode must be readonly or write\n'); process.exit(2); }
}

// which: full path of a command on PATH (PATHEXT on Windows), or null.
export function which(cmd) {
  if (!cmd) return null;
  if (/[\\/]/.test(cmd)) return existsSync(cmd) ? cmd : null;
  const exts = IS_WIN ? ['', ...(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').toLowerCase().split(';')] : [''];
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    for (const e of exts) { const p = join(dir, cmd + e); try { if (statSync(p).isFile()) return p; } catch { /* next */ } }
  }
  return null;
}

// winQuote: one argument, quoted the way Windows programs parse their command line (backslashes
// before a quote are doubled, quotes are backslash-escaped). Used only to launch .cmd/.bat shims
// (npm-installed CLIs), which Node can start only through cmd.exe.
export function winQuote(a) {
  let out = '"', bs = 0;
  for (const ch of String(a)) {
    if (ch === '\\') { bs++; continue; }
    if (ch === '"') { out += '\\'.repeat(bs * 2 + 1) + '"'; bs = 0; continue; }
    out += '\\'.repeat(bs) + ch; bs = 0;
  }
  return `${out}${'\\'.repeat(bs * 2)}"`;
}

// run: launch a CLI with arguments, an optional stdin file and stdout/stderr files. Never uses a shell
// except to start a Windows .cmd/.bat shim, where every argument is quoted.
export function run(bin, args, { cwd, stdin, stdout, stderr } = {}) {
  const fds = [stdin ? openSync(stdin, 'r') : 'ignore', stdout ? openSync(stdout, 'w') : 'inherit', stderr ? openSync(stderr, 'w') : 'inherit'];
  try {
    const shim = IS_WIN && /\.(cmd|bat)$/i.test(bin);
    const r = shim
      ? spawnSync([bin, ...args].map(winQuote).join(' '), { cwd, stdio: fds, shell: true, windowsVerbatimArguments: true })
      : spawnSync(bin, args, { cwd, stdio: fds });
    if (r.error) { process.stderr.write(`adapter: could not start ${bin}: ${r.error.message}\n`); return 127; }
    return r.status ?? 1;
  } finally { for (const f of fds) if (typeof f === 'number') closeSync(f); }
}

// finish: keep a model-written --out, else extract the last JSON block from the reply.
export function finish(o, reply) {
  if (existsSync(o.out) && statSync(o.out).size > 0) process.exit(0);
  if (!existsSync(reply) || statSync(reply).size === 0) { process.stderr.write(`adapter: model produced no reply (see ${reply})\n`); process.exit(4); }
  try { writeFileSync(o.out, JSON.stringify(extractLastJson(readFileSync(reply, 'utf8')), null, 2) + '\n'); }
  catch (e) { process.stderr.write(`extract-json: ${e.message}\n`); process.exit(5); }
  process.exit(0);
}

export const replyPath = o => join(dirname(o.out), 'reply.txt');
export const caps = obj => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(0); };
export const probe = (bin, what) => {
  if (bin) { process.stdout.write('OK\n'); process.exit(0); }
  process.stderr.write(`${what} not found on PATH\n`); process.exit(1);
};
