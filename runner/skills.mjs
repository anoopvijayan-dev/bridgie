// The bridgie agent skill: one source in skills/bridgie/, shipped inside the npm package.
// Installing it is the job of the open `skills` installer (https://skills.sh), which knows where
// every agent harness reads user-level skills. `bridgie setup` runs it; `bridgie doctor` compares
// the installed copies below with the bundled source.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SKILLS_CLI = 'skills@1.8.1';   // pinned; bump deliberately

// The folders `skills add -g` writes to: the shared ~/.agents layout (Codex, Copilot, Gemini CLI and
// most others read it) plus the agents that keep their own folder.
export const INSTALLED = [
  [join('.agents', 'skills', 'bridgie'), 'agents that read ~/.agents/skills (Codex, Copilot, Gemini CLI and others)'],
  [join('.claude', 'skills', 'bridgie'), 'Claude Code'],
  [join('.gemini', 'config', 'skills', 'bridgie'), 'Antigravity'],
];

export const skillSource = bridgieHome => join(bridgieHome, 'skills', 'bridgie');

// `skills add` arguments that install the bundled skill for every agent detected on this machine.
// --copy, not symlinks: Windows needs admin rights or developer mode for symlinks.
export const addArgs = (bridgieHome, agents) =>
  ['-y', SKILLS_CLI, 'add', skillSource(bridgieHome), '-g', '-y', '--copy', ...(agents ? ['--agent', ...agents] : [])];

function files(dir, rel = '') {
  const out = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = join(rel, e.name);
    if (e.isDirectory()) out.push(...files(dir, r)); else out.push(r);
  }
  return out;
}

// Installed copies on this machine: [{ dir, who, state: 'current' | 'stale' }].
export function installedSkills(bridgieHome, home = homedir()) {
  const src = skillSource(bridgieHome), norm = s => s.replace(/\r\n/g, '\n');
  return INSTALLED.filter(([d]) => existsSync(join(home, d, 'SKILL.md'))).map(([d, who]) => {
    const dir = join(home, d);
    const same = files(src).every(f => existsSync(join(dir, f)) && norm(readFileSync(join(dir, f), 'utf8')) === norm(readFileSync(join(src, f), 'utf8')));
    return { dir, who, state: same ? 'current' : 'stale' };
  });
}
