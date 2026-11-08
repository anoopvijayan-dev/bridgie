// bridgie setup [--no-link] [--no-policy] — install Bridgie for this user, on any OS:
//   1. the agent skill into ~/.claude/skills and ~/.agents/skills (when those homes exist)
//   2. `bridgie` on PATH via `npm install -g <this folder>` (npm writes the right launcher for
//      PowerShell, cmd, Git Bash, macOS and Linux), and removal of the old bash-era Windows shim
//   3. ~/.bridgie/policy.yaml: which model runtime each seat tier uses on this machine
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { HOME, IS_WIN, parseArgs, which } from '../cli/core.mjs';

const POLICY = `# Bridgie routing for this machine. Projects can override in .bridgie/policy.yaml.
# Adapters: claude-code, copilot, codex, antigravity, fake. Check them with: bridgie doctor
version: 1
routing:
  tiers:
    judgment: { adapter: copilot, model: claude-opus-5.5, effort: xhigh }
    production: { adapter: antigravity, model: default }
    scout: { adapter: antigravity, model: default }
  seats:
    reviewer: { adapter: copilot, model: claude-opus-5.5, effort: high }
`;

export default async function setup(argv) {
  const a = parseArgs(argv, { 'no-link': 'bool', 'no-policy': 'bool', path: 'bool', policy: 'bool' }, 'setup');
  const home = homedir();
  const say = s => process.stdout.write(`${s}\n`);

  // 1. skill
  let installed = 0;
  for (const h of [join(home, '.claude'), join(home, '.agents')]) {
    if (!existsSync(h)) continue;
    mkdirSync(join(h, 'skills', 'bridgie'), { recursive: true });
    copyFileSync(join(HOME, 'skills', 'bridgie', 'SKILL.md'), join(h, 'skills', 'bridgie', 'SKILL.md'));
    say(`skill installed: ${join(h, 'skills', 'bridgie', 'SKILL.md')}`);
    installed++;
  }
  if (!installed) say("no ~/.claude or ~/.agents folder found; copy skills/bridgie/ into your agent's skills folder by hand");

  // 2. command on PATH
  const oldShim = join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Microsoft', 'WindowsApps', 'bridgie.cmd');
  if (existsSync(oldShim) && /bin[\\/]bridgie"/.test(readFileSync(oldShim, 'utf8'))) { rmSync(oldShim); say(`removed the old bash shim ${oldShim}`); }
  if (!a['no-link']) {
    const npm = which('npm');
    if (!npm) say(`npm not found; put ${join(HOME, 'bin')} on your PATH to use bridgie`);
    else {
      const r = spawnSync(npm, ['install', '-g', HOME], { stdio: 'inherit', shell: IS_WIN });   // npm is npm.cmd on Windows
      if (r.status === 0) say('bridgie linked with npm: works in PowerShell, cmd, Git Bash, macOS and Linux terminals');
      else say(`npm install -g failed; put ${join(HOME, 'bin')} on your PATH instead, or fix npm's global prefix (npm config get prefix)`);
    }
  }

  // 3. routing policy
  if (!a['no-policy']) {
    const p = join(home, '.bridgie', 'policy.yaml');
    if (existsSync(p)) say(`${p} already exists; left unchanged`);
    else { mkdirSync(join(home, '.bridgie'), { recursive: true }); writeFileSync(p, POLICY); say(`created ${p} (judgment and review on Copilot Claude, production on Antigravity; edit to taste)`); }
  }
  say('');
  say('Done. Open a NEW terminal and type:  bridgie        (then: bridgie new my-idea)');
}
