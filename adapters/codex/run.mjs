// Codex CLI adapter (openai). Prompt on stdin; last message written with -o; JSON extracted to --out.
import { dirname, join } from 'node:path';
import * as A from '../lib/common.mjs';

const o = A.parse(process.argv.slice(2));
const bin = A.which(process.env.BRIDGIE_CODEX_BIN || 'codex');
if (o.probe) A.probe(bin, 'codex CLI');
if (o.caps) A.caps({ vendor: 'openai', reads_repo: true, reads_web: true });
A.requireRunArgs(o);
if (!bin) { process.stderr.write('codex CLI not found on PATH\n'); process.exit(1); }
const reply = A.replyPath(o);
const args = ['exec', '--search', '-s', o.mode === 'write' ? 'workspace-write' : 'read-only', '-C', o.cwd, '--skip-git-repo-check', '-o', reply];   // --search: web search tool on
// ChatGPT-auth Codex rejects -m for models it does not offer: only pass it when one is configured.
if (o.model !== 'default') args.push('-m', o.model);
if (o.effort) args.push('-c', `model_reasoning_effort="${o.effort}"`);
const log = join(dirname(o.out), 'codex.log');
const rc = A.run(bin, args, { stdin: o.prompt, stdout: log, stderr: log + '.err' });
A.finish(o, reply, rc);
