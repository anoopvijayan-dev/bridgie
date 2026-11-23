// GitHub Copilot CLI adapter. Vendor follows the model (Claude → anthropic, GPT → openai, Gemini → google).
// The prompt is too large for a command line on Windows, so -p carries an instruction to read the file.
import { dirname, join } from 'node:path';
import * as A from '../lib/common.mjs';

const o = A.parse(process.argv.slice(2));
const bin = A.which(process.env.BRIDGIE_COPILOT_BIN || 'copilot');
const vendorOf = m => {
  m = String(m || '').toLowerCase();
  if (/claude|opus|sonnet|haiku|fable/.test(m)) return 'anthropic';
  if (/gpt|^o\d|codex/.test(m)) return 'openai';
  if (/gemini/.test(m)) return 'google';
  return `copilot-${m || 'default'}`;
};
if (o.probe) A.probe(bin, 'copilot CLI');
if (o.caps) A.caps({ vendor: vendorOf(o.model), reads_repo: true, reads_web: process.env.BRIDGIE_COPILOT_WEB === '1', sandbox: 'none' });
A.requireRunArgs(o);
if (!bin) { process.stderr.write('copilot CLI not found on PATH\n'); process.exit(1); }
const instruction = `Read ${o.prompt} in full. It contains your role, inputs and output contract. Do the work now in ${o.cwd}, then end your reply with the fenced json block it asks for.`;
const args = ['-s', '--no-ask-user', '--add-dir', dirname(o.prompt)];
if (o.model !== 'default') args.push('--model', o.model);
if (o.effort) args.push('--reasoning-effort', o.effort);
if (o.mode === 'readonly') {
  // Non-interactive mode denies anything not allowed; deny rules win over allow rules.
  args.push('--allow-tool', 'shell(git diff:*)', '--allow-tool', 'shell(git log:*)', '--allow-tool', 'shell(git show:*)', '--allow-tool', 'shell(git status:*)', '--deny-tool', 'write');
} else {
  args.push('--allow-tool', 'write', '--allow-tool', 'shell', '--deny-tool', 'shell(git push)', '--deny-tool', 'shell(git remote)', '--deny-tool', 'shell(git checkout)', '--deny-tool', 'shell(git switch)');
}
args.push('-p', instruction);
const reply = A.replyPath(o);
const rc = A.run(bin, args, { cwd: o.cwd, stdout: reply, stderr: join(dirname(o.out), 'copilot.log') });
A.finish(o, reply, rc);
