// Antigravity CLI adapter (google). agy has no stdin mode: it is told to read the prompt file.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { homedir } from 'node:os';
import * as A from '../lib/common.mjs';

// --check-cwd DIR (used by bridgie doctor): OK when an Antigravity project covers DIR, else the reason.
const cc = process.argv.indexOf('--check-cwd');
const o = cc >= 0 ? {} : A.parse(process.argv.slice(2));
function findAgy() {
  if (process.env.BRIDGIE_AGY_BIN) return process.env.BRIDGIE_AGY_BIN;
  const onPath = A.which('agy');
  if (onPath) return onPath;
  const la = process.env.LOCALAPPDATA;
  if (la && existsSync(join(la, 'agy', 'bin', 'agy.exe'))) return join(la, 'agy', 'bin', 'agy.exe');
  return null;
}
// findProject: Antigravity project id whose folderUri covers dir. Without it agy runs in
// "default-cli-project" and wipes the permission grants (see gotchas.md).
function findProject(dir) {
  if (process.env.BRIDGIE_AGY_PROJECT) return process.env.BRIDGIE_AGY_PROJECT;
  const want = dir.replace(/\\/g, '/').toLowerCase();
  const d = join(homedir(), '.gemini', 'config', 'projects');
  let best = null;
  for (const f of existsSync(d) ? readdirSync(d) : []) {
    try {
      const j = JSON.parse(readFileSync(join(d, f), 'utf8'));
      const uris = [j.folderUri, ...(j.folders || []).map(x => x.uri || x)].filter(Boolean);
      for (const u of uris) {
        const p = decodeURIComponent(String(u).replace(/^file:\/\//, '')).replace(/\\/g, '/').replace(/^\/([a-zA-Z]:)/, '$1').toLowerCase().replace(/\/$/, '');
        if (want.startsWith(p) && (!best || p.length > best.len)) best = { id: j.id || basename(f, '.json'), len: p.length };
      }
    } catch { /* skip unreadable project files */ }
  }
  return best?.id || null;
}
const bin = findAgy();
if (cc >= 0) {
  const dir = process.argv[cc + 1];
  const id = findProject(dir);
  if (id) { process.stdout.write(`OK ${id}\n`); process.exit(0); }
  process.stdout.write(`no Antigravity project covers ${dir}\n`); process.exit(1);
}
if (o.probe) A.probe(bin, 'agy (PATH or %LOCALAPPDATA%/agy/bin)');
if (o.caps) A.caps({ vendor: 'google', reads_repo: true, reads_web: false, sandbox: 'none' });
A.requireRunArgs(o);
if (!bin) { process.stderr.write('agy not found\n'); process.exit(1); }
const project = findProject(o.cwd);
if (!project) { process.stderr.write(`no Antigravity project covers ${o.cwd}; open it in Antigravity once or set BRIDGIE_AGY_PROJECT\n`); process.exit(1); }
const mode = o.mode === 'write' ? (process.env.BRIDGIE_AGY_WRITE_MODE || 'agent') : 'plan';
const instruction = `Read ${o.prompt} in full. It contains your role, inputs and output contract. Do the work now in ${o.cwd}, then end your reply with the fenced json block it asks for.`;
const args = ['--project', project, '--mode', mode, '--effort', o.effort || 'high', '--print-timeout', process.env.BRIDGIE_AGY_TIMEOUT || '15m', '--output-format', 'json'];
if (o.model !== 'default') args.push('--model', o.model);
args.push('--print', instruction);   // --print takes the prompt as its VALUE and must come last
const reply = A.replyPath(o), raw = join(dirname(o.out), 'agy.json');
const rc = A.run(bin, args, { cwd: o.cwd, stdout: raw, stderr: join(dirname(o.out), 'agy.log') });
let rawText = '';
try { rawText = readFileSync(raw, 'utf8'); } catch { /* the CLI wrote nothing */ }
const parsed = A.parseAgyJson(rawText);
if (parsed) {
  writeFileSync(reply, parsed.response);
  if (parsed.usage) A.writeUsage(o, parsed.usage);
} else {
  writeFileSync(reply, rawText);
}
rmSync(raw, { force: true });
A.finish(o, reply, rc);
