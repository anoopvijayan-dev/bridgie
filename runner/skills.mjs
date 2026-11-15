// Where agent harnesses look for user-level skills, and how to keep the bridgie skill there current.
// One source: skills/bridgie/ in this repo. `bridgie setup` copies it into every home below that
// exists; `bridgie doctor` warns when an installed copy differs from the source.
import { existsSync, readdirSync, readFileSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// [agent home (must already exist), skills folder inside it, who reads it]
export const SKILL_HOMES = [
  ['.claude', 'skills', 'Claude Code (also read by Copilot CLI)'],
  ['.agents', 'skills', 'Codex and other agents that follow the shared .agents layout'],
  ['.copilot', 'skills', 'GitHub Copilot CLI'],
  [join('.gemini', 'antigravity'), 'skills', 'Antigravity'],
];

export const skillSource = bridgieHome => join(bridgieHome, 'skills', 'bridgie');

function files(dir, rel = '') {
  const out = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = join(rel, e.name);
    if (e.isDirectory()) out.push(...files(dir, r)); else out.push(r);
  }
  return out;
}

// Install targets on this machine: [{ dir, who }] for every agent home that exists.
export function skillTargets(home = homedir()) {
  return SKILL_HOMES.filter(([h]) => existsSync(join(home, h)) && statSync(join(home, h)).isDirectory())
    .map(([h, s, who]) => ({ dir: join(home, h, s, 'bridgie'), who }));
}

// Copy the whole skill folder (SKILL.md and any references/) into dir.
export function installSkill(bridgieHome, dir) {
  const src = skillSource(bridgieHome);
  for (const f of files(src)) {
    mkdirSync(join(dir, f, '..'), { recursive: true });
    copyFileSync(join(src, f), join(dir, f));
  }
}

// 'current' | 'stale' | 'missing' for an installed copy, compared file by file (line endings ignored).
export function skillState(bridgieHome, dir) {
  if (!existsSync(join(dir, 'SKILL.md'))) return 'missing';
  const src = skillSource(bridgieHome), norm = s => s.replace(/\r\n/g, '\n');
  for (const f of files(src)) {
    const p = join(dir, f);
    if (!existsSync(p) || norm(readFileSync(p, 'utf8')) !== norm(readFileSync(join(src, f), 'utf8'))) return 'stale';
  }
  return 'current';
}
