// Claude Code adapter (anthropic). Prompt on stdin, reply on stdout, JSON extracted to --out.
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import * as A from '../lib/common.mjs';

const o = A.parse(process.argv.slice(2));
const bin = A.which(process.env.BRIDGIE_CLAUDE_BIN || 'claude');
if (o.probe) A.probe(bin, 'claude CLI');
if (o.caps) A.caps({ vendor: 'anthropic', reads_repo: true, reads_web: true });
A.requireRunArgs(o);
if (!bin) { process.stderr.write('claude CLI not found on PATH\n'); process.exit(1); }
// --output-format json: one result object holding the reply text and what the run used (tokens,
// cost). The reply is written to reply.txt as before; the usage goes to usage.json.
const args = ['-p', '--output-format', 'json', '--add-dir', dirname(o.out)];
if (o.model !== 'default') args.push('--model', o.model);
if (o.effort) args.push('--effort', o.effort);
if (o.mode === 'readonly') {
  // Read and inspect only; everything not allowed is refused without prompting.
  args.push('--permission-mode', 'dontAsk',
    '--allowedTools', 'Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git status:*)',
    '--disallowedTools', 'Edit', 'Write', 'NotebookEdit');
} else {
  args.push('--permission-mode', 'acceptEdits',
    '--allowedTools', 'Read', 'Grep', 'Glob', 'LS', 'Edit', 'Write', 'Bash',
    '--disallowedTools', 'Bash(git push:*)', 'Bash(git remote:*)', 'Bash(git checkout:*)', 'Bash(git switch:*)');
}
// A seat's whole reply is one JSON block (a shaper's carries the full requirements and
// design). Past Claude Code's default output cap the CLI makes the model resume in a new
// message, and print mode returns only that last part, so the JSON is lost. Ask for the
// model's ceiling instead (the CLI clamps it to the model's limit); a value already set wins.
process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS ||= process.env.BRIDGIE_CLAUDE_MAX_OUTPUT_TOKENS || '128000';
const reply = A.replyPath(o), raw = join(dirname(o.out), 'claude.json');
const rc = A.run(bin, args, { cwd: o.cwd, stdin: o.prompt, stdout: raw });
let text = '';
try { text = readFileSync(raw, 'utf8'); } catch { /* the CLI wrote nothing */ }
let res = null;
try { const j = JSON.parse(text); if (j && typeof j === 'object' && !Array.isArray(j) && j.type === 'result') res = j; } catch { /* not the result object: plain text (an older CLI, or an error before the run) */ }
if (res) {
  writeFileSync(reply, typeof res.result === 'string' ? res.result : '');
  const u = res.usage || {};
  A.writeUsage(o, { tokens_in: u.input_tokens, tokens_out: u.output_tokens, tokens_cache_read: u.cache_read_input_tokens, tokens_cache_write: u.cache_creation_input_tokens, usd: res.total_cost_usd });
} else writeFileSync(reply, text);
rmSync(raw, { force: true });
A.finish(o, reply, rc);
