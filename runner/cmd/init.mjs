// bridgie init [--lane L] — create .bridgie/ in the current folder.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as st from '../state.mjs';
import { HOME, die, log, parseArgs, stateCommit } from '../cli/core.mjs';

export default async function init(argv, { cwd = process.cwd() } = {}) {
  const a = parseArgs(argv, { lane: 'value' }, 'init');
  const lane = a.lane || 'engineering';
  const s = join(cwd, '.bridgie');
  if (existsSync(join(s, 'bets'))) die(`init: ${s} already exists`);
  // ~/.bridgie holds this machine's policy; a project in the home folder itself shares the folder.
  for (const d of ['bets', 'specs', 'runs', 'acceptance', 'decisions', 'learn']) mkdirSync(join(s, d), { recursive: true });
  // Templates are written with LF even if this clone was checked out with CRLF (Windows autocrlf).
  const tpl = name => readFileSync(join(HOME, 'templates', name), 'utf8').replace(/\r\n/g, '\n');
  if (!existsSync(join(s, 'policy.yaml'))) writeFileSync(join(s, 'policy.yaml'), tpl('project-policy.yaml').replace(/\{\{lane\}\}/g, lane));
  writeFileSync(join(s, '.gitignore'), tpl('bridgie-gitignore'));
  // Keep state LF on every OS: Windows autocrlf would otherwise rewrite it (and change acceptance digests).
  writeFileSync(join(s, '.gitattributes'), '* text eol=lf\n');
  writeFileSync(join(s, 'learn', 'gotchas.md'), '# Gotchas\n\nDated one-line corrections learned in this project.\n');
  try { st.loadPolicy(cwd); } catch (e) { die(`init: generated policy does not validate: ${e.message}`); }
  stateCommit(cwd, `init (lane ${lane})`);
  log(`initialised ${s} (lane: ${lane}). Next: bridgie bet new <slug>`);
}
