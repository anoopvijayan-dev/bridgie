// bridgie setup [--no-link] [--no-skill] [--no-policy] [--agent NAME...] — install Bridgie for this user, on any OS.
// Usually run as:  npx bridgie@latest setup
//   1. `bridgie` on PATH via npm (npm writes the right launcher for PowerShell, cmd, Git Bash, macOS
//      and Linux): from a git clone it links the clone, otherwise it installs bridgie@<this version>.
//      Also removes the old bash-era Windows shim.
//   2. the agent skill, through the open `skills` installer, for every agent found on this machine
//      (or only --agent NAME...); see runner/skills.mjs
//   3. ~/.bridgie/policy.yaml: which model runtime each seat tier uses, from the CLIs found here
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { HOME, IS_WIN, parseArgs, which, version } from '../cli/core.mjs';
import { addArgs } from '../skills.mjs';

const PREFERRED = `version: 1
routing:
  tiers:
    judgment: { adapter: copilot, model: claude-opus-5.5, effort: xhigh }
    production: { adapter: antigravity, model: default }
    scout: { adapter: antigravity, model: default }
  seats:
    reviewer: { adapter: copilot, model: claude-opus-5.5, effort: high }
`;
const single = a => `version: 1
routing:
  tiers:
    judgment: { adapter: ${a}, model: default }
    production: { adapter: ${a}, model: default }
    scout: { adapter: ${a}, model: default }
  seats:
    reviewer: { adapter: ${a}, model: default }
`;
const HEAD = `# Bridgie routing for this machine. Projects can override in .bridgie/policy.yaml.
# Adapters: claude-code, copilot, codex, antigravity, fake. Check them with: bridgie doctor
`;

// Pick a routing for the model CLIs installed here: Copilot judgment with Antigravity production when
// both are present, otherwise everything on the first one found.
function routing() {
  const found = ['copilot', 'antigravity', 'claude-code', 'codex'].filter(a => {
    const p = spawnSync(process.execPath, [join(HOME, 'adapters', a, 'run.mjs'), '--probe'], { encoding: 'utf8', timeout: 30000 });
    return p.status === 0 && /OK/.test(p.stdout || '');
  });
  if (found.includes('copilot') && found.includes('antigravity')) return [PREFERRED, 'judgment and review on Copilot Claude, production on Antigravity'];
  if (found.length) return [single(found[0]), `every seat on ${found[0]}`];
  return [single('claude-code'), 'every seat on claude-code, but no model CLI was found: install one, then run bridgie doctor'];
}

const inside = (dir, parent) => { const r = relative(parent, dir); return r && !r.startsWith('..') && !isAbsolute(r); };
// Run npm or npx. On Windows they are .cmd files, which only run through cmd.exe, so build one command
// line with every part quoted (npm usually lives in C:\Program Files\nodejs) and let cmd find the
// command by name; elsewhere run the resolved path directly with no shell.
const winQuote = s => (/[\s"&|<>^()%!]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
export const commandLine = (name, args) => [name, ...args].map(winQuote).join(' ');
const run = (name, path, args, opts = {}) => IS_WIN
  ? spawnSync(commandLine(name, args), { stdio: 'inherit', ...opts, shell: true })
  : spawnSync(path, args, { stdio: 'inherit', ...opts });

export default async function setup(argv) {
  const a = parseArgs(argv, { 'no-link': 'bool', 'no-skill': 'bool', 'no-policy': 'bool', agent: 'list', path: 'bool', policy: 'bool' }, 'setup');
  const home = homedir();
  const say = s => process.stdout.write(`${s}\n`);
  const npm = which('npm'), npx = which('npx');

  // 1. command on PATH. The old bash-era Windows shim goes only once the new command is in place.
  const oldShim = join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Microsoft', 'WindowsApps', 'bridgie.cmd');
  const dropShim = () => { if (existsSync(oldShim) && /bin[\\/]bridgie"/.test(readFileSync(oldShim, 'utf8'))) { rmSync(oldShim); say(`removed the old bash shim ${oldShim}`); } };
  if (a['no-link']) dropShim();
  else {
    const fromClone = existsSync(join(HOME, '.git'));
    const globalRoot = npm ? (run('npm', npm, ['root', '-g'], { stdio: 'pipe', encoding: 'utf8' }).stdout || '').trim() : '';
    if (!npm) say(`npm not found; install Node.js (it includes npm), then run: npx bridgie@latest setup`);
    else if (!fromClone && globalRoot && inside(resolve(HOME), resolve(globalRoot))) { say(`bridgie ${version()} is already installed with npm`); dropShim(); }
    else {
      const target = fromClone ? HOME : `bridgie@${version()}`;
      const r = run('npm', npm, ['install', '-g', target]);
      if (r.status === 0) { say(`bridgie ${fromClone ? 'linked from this clone' : `${version()} installed`} with npm: works in PowerShell, cmd, Git Bash, macOS and Linux terminals`); dropShim(); }
      else say(`npm install -g failed; run it yourself to see why: npm install -g ${fromClone ? `"${HOME}"` : target}   (or check npm's global prefix: npm config get prefix)`);
    }
  }

  // 2. agent skill, for every agent on this machine, through the skills installer
  if (!a['no-skill']) {
    const args = addArgs(HOME, a.agent);
    const r = npx ? run('npx', npx, args) : { status: 1 };
    if (r.status === 0) say('bridgie skill installed for the agents found on this machine (list them: npx skills ls -g)');
    else say(`could not run the skills installer${npx ? '' : ' (npx not found)'}; install the skill by hand: npx -y ${args[1]} add anoopvijayan-dev/bridgie -g -y --copy`);
    say('Claude chat and Claude cloud sessions read skills from claude.ai: upload skills/bridgie/SKILL.md there once (and again after it changes)');
  }

  // 3. routing policy
  if (!a['no-policy']) {
    const p = join(home, '.bridgie', 'policy.yaml');
    if (existsSync(p)) say(`${p} already exists; left unchanged`);
    else {
      const [body, why] = routing();
      mkdirSync(join(home, '.bridgie'), { recursive: true }); writeFileSync(p, HEAD + body);
      say(`created ${p} (${why}; edit to taste)`);
    }
  }
  say('');
  say('Done. Open a NEW terminal and type:  bridgie        (then: bridgie new my-idea)');
}
