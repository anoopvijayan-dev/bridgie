// Codex CLI adapter (openai). Prompt on stdin; last message written with -o; JSON extracted to --out.
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import * as A from '../lib/common.mjs';

const o = A.parse(process.argv.slice(2));
const bin = A.which(process.env.BRIDGIE_CODEX_BIN || 'codex');
if (o.probe) A.probe(bin, 'codex CLI');
if (o.caps) A.caps({ vendor: 'openai', reads_repo: true, reads_web: true });
A.requireRunArgs(o);
if (!bin) { process.stderr.write('codex CLI not found on PATH\n'); process.exit(1); }
const reply = A.replyPath(o);
// --search is a top-level codex option (0.169 refuses it after exec): web search tool on
const args = ['--search', 'exec', '-s', o.mode === 'write' ? 'workspace-write' : 'read-only', '-C', o.cwd, '--skip-git-repo-check', '-o', reply];
// ChatGPT-auth Codex rejects -m for models it does not offer: only pass it when one is configured.
if (o.model !== 'default') args.push('-m', o.model);
if (o.effort) args.push('-c', `model_reasoning_effort="${o.effort}"`);
const log = join(dirname(o.out), 'codex.log');
const rc = A.run(bin, args, { stdin: o.prompt, stdout: log, stderr: log + '.err' });
// Codex ends its log with "tokens used" and a total (no split, no cost): record what it said.
for (const f of [log + '.err', log]) {
  let tail = '';
  try { tail = readFileSync(f, 'utf8').slice(-400); } catch { continue; }
  const m = tail.match(/tokens used\s*:?\s*([\d,]+)\s*$/i);
  if (m) { A.writeUsage(o, { tokens_total: Number(m[1].replace(/,/g, '')) }); break; }
}
A.finish(o, reply, rc);
