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
// cliStatus is the CLI's own exit code: when the CLI failed (signed out, over its limit, crashed) and
// left no JSON, say so with the CLI's message (exit 6) rather than blaming the model's reply.
export function finish(o, reply, cliStatus = 0) {
  if (existsSync(o.out) && statSync(o.out).size > 0) process.exit(0);
  const text = existsSync(reply) ? readFileSync(reply, 'utf8') : '';
  try { writeFileSync(o.out, JSON.stringify(extractLastJson(text), null, 2) + '\n'); process.exit(0); }
  catch (e) {
    if (cliStatus !== 0) {
      const said = text.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' | ').slice(0, 400);
      process.stderr.write(`adapter: the CLI failed (exit ${cliStatus})${said ? `: ${said}` : ''}\n`); process.exit(6);
    }
    if (!text.trim()) { process.stderr.write(`adapter: model produced no reply (see ${reply})\n`); process.exit(4); }
    process.stderr.write(`extract-json: ${e.message}\n`); process.exit(5);
  }
}

// osSandbox: can an OS-level sandbox start on this machine? macOS has one built in (Seatbelt);
// Linux and WSL2 need bubblewrap and socat; native Windows has none.
export function osSandbox() {
  if (process.platform === 'darwin') return { ok: true, why: '' };
  if (process.platform === 'linux') {
    const missing = [['bwrap', 'bubblewrap'], ['socat', 'socat']].filter(([c]) => !which(c)).map(([, n]) => n);
    return missing.length ? { ok: false, why: `${missing.join(' and ')} not installed` } : { ok: true, why: '' };
  }
  return { ok: false, why: 'no OS sandbox on native Windows (WSL2 has one)' };
}
// sandboxAsk: what the runner asks for (BRIDGIE_SANDBOX: off | auto | required; the hosts a
// sandboxed seat may reach in BRIDGIE_SANDBOX_NETWORK). An adapter run by hand gets none.
export function sandboxAsk() {
  const mode = ['auto', 'required'].includes(process.env.BRIDGIE_SANDBOX) ? process.env.BRIDGIE_SANDBOX : 'off';
  return { mode, hosts: (process.env.BRIDGIE_SANDBOX_NETWORK || '').split(',').map(s => s.trim()).filter(Boolean) };
}
export const replyPath = o => join(dirname(o.out), 'reply.txt');
// usage: what the model CLI reported the run used, written beside --out as usage.json for the
// runner to record. Every field is optional; only what the CLI itself said is written, never an
// estimate. `usd` is what the CLI computed (a list-price figure: on a subscription it is not a bill).
export const usagePath = o => join(dirname(o.out), 'usage.json');
export function writeUsage(o, u) {
  const int = v => (Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  const out = { tokens_in: int(u.tokens_in), tokens_out: int(u.tokens_out), tokens_cache_read: int(u.tokens_cache_read), tokens_cache_write: int(u.tokens_cache_write),
    tokens_total: int(u.tokens_total), usd: Number.isFinite(u.usd) && u.usd >= 0 ? u.usd : null };
  if (Object.values(out).every(v => v === null)) return false;
  if (out.tokens_total === null) { const parts = [out.tokens_in, out.tokens_out, out.tokens_cache_read, out.tokens_cache_write].filter(v => v !== null); if (parts.length) out.tokens_total = parts.reduce((a, b) => a + b, 0); }
  writeFileSync(usagePath(o), JSON.stringify(out) + '\n');
  return true;
}

export function parseCopilotUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const td = raw.tokenDetails;
  if (td && typeof td === 'object') {
    const num = x => (typeof x?.tokenCount === 'number' && Number.isFinite(x.tokenCount) ? Math.round(x.tokenCount) : null);
    const tIn = num(td.input), tOut = num(td.output), tCr = num(td.cache_read), tCw = num(td.cache_write);
    if ([tIn, tOut, tCr, tCw].some(v => v !== null)) {
      const total = [tIn, tOut, tCr, tCw].filter(v => v !== null).reduce((a, b) => a + b, 0);
      return { tokens_in: tIn, tokens_out: tOut, tokens_cache_read: tCr, tokens_cache_write: tCw, tokens_total: total };
    }
  }
  const mm = raw.modelMetrics;
  if (mm && typeof mm === 'object') {
    let sumIn = 0, sumOut = 0, sumCr = 0, sumCw = 0, seen = false;
    for (const v of Object.values(mm)) {
      const u = v?.usage;
      if (!u || typeof u !== 'object') continue;
      if (typeof u.inputTokens === 'number') { sumIn += u.inputTokens; seen = true; }
      if (typeof u.outputTokens === 'number') { sumOut += u.outputTokens; seen = true; }
      if (typeof u.cacheReadTokens === 'number') { sumCr += u.cacheReadTokens; seen = true; }
      if (typeof u.cacheWriteTokens === 'number') { sumCw += u.cacheWriteTokens; seen = true; }
    }
    if (seen) {
      return {
        tokens_in: Math.max(0, Math.round(sumIn - sumCr - sumCw)),
        tokens_out: Math.round(sumOut),
        tokens_cache_read: Math.round(sumCr),
        tokens_cache_write: Math.round(sumCw),
        tokens_total: Math.round(sumIn + sumOut),
      };
    }
  }
  return null;
}

export function parseAgyJson(text) {
  if (typeof text !== 'string' || !text.trim().startsWith('{')) return null;
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j) || typeof j.response !== 'string') return null;
  const u = j.usage;
  let usage = null;
  if (u && typeof u === 'object') {
    const int = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
    const rawIn = int(u.input_tokens), tOut = int(u.output_tokens), tCr = int(u.cache_read_tokens), tCw = int(u.cache_write_tokens), tTot = int(u.total_tokens);
    if ([rawIn, tOut, tCr, tCw, tTot].some(v => v !== null)) {
      const tIn = rawIn !== null ? Math.max(0, rawIn - (tCr || 0) - (tCw || 0)) : null;
      usage = { tokens_in: tIn, tokens_out: tOut, tokens_cache_read: tCr, tokens_cache_write: tCw, tokens_total: tTot };
    }
  }
  return { response: j.response, usage };
}

export const caps = obj => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(0); };
export const probe = (bin, what) => {
  if (bin) { process.stdout.write('OK\n'); process.exit(0); }
  process.stderr.write(`${what} not found on PATH\n`); process.exit(1);
};
