// Claude Code adapter (anthropic). Prompt on stdin, reply on stdout, JSON extracted to --out.
import { dirname } from 'node:path';
import * as A from '../lib/common.mjs';

const o = A.parse(process.argv.slice(2));
const bin = A.which(process.env.BRIDGIE_CLAUDE_BIN || 'claude');
if (o.probe) A.probe(bin, 'claude CLI');
if (o.caps) A.caps({ vendor: 'anthropic', reads_repo: true, reads_web: true });
A.requireRunArgs(o);
if (!bin) { process.stderr.write('claude CLI not found on PATH\n'); process.exit(1); }
const args = ['-p', '--output-format', 'text', '--add-dir', dirname(o.out)];
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
const reply = A.replyPath(o);
const rc = A.run(bin, args, { cwd: o.cwd, stdin: o.prompt, stdout: reply });
A.finish(o, reply, rc);
