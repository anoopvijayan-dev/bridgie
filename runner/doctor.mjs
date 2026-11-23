// bridgie doctor: validate the tool and, when inside a project, its state.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { splitFrontmatter, parse as yparse } from './yaml.mjs';
import { validate } from './schema.mjs';
import * as st from './state.mjs';
import { leftoverSnapshots } from './guard.mjs';
import { installedSkills, skillSource } from './skills.mjs';

export function doctor(root) {
  const r = [];
  const ok = m => r.push(['ok', m]), warn = m => r.push(['warn', m]), fail = m => r.push(['fail', m]);

  const major = Number(process.versions.node.split('.')[0]);
  major >= 20 ? ok(`node ${process.versions.node}`) : fail(`node ${process.versions.node}; need >= 20`);
  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  git.status === 0 ? ok(git.stdout.trim()) : fail('git not found');
  const bats = spawnSync('bats', ['--version'], { encoding: 'utf8' });
  if (bats.status === 0) ok(`${bats.stdout.trim()} (for Bridgie's own CLI tests)`);   // users do not need bats

  let bad = 0;
  for (const f of readdirSync(join(st.HOME, 'schemas'))) { try { JSON.parse(readFileSync(join(st.HOME, 'schemas', f), 'utf8')); } catch (e) { bad++; fail(`schema ${f}: ${e.message}`); } }
  if (!bad) ok('schemas parse');
  try { const def = yparse(readFileSync(join(st.HOME, 'policy', 'default.yaml'), 'utf8')); const e = validate(st.loadSchema('policy'), def); e.length ? fail(`default policy: ${e.join('; ')}`) : ok('default policy valid'); } catch (e) { fail(`default policy: ${e.message}`); }

  const seatSchema = st.loadSchema('seat'); let seats = 0, seatFail = 0;
  for (const loop of readdirSync(join(st.HOME, 'seats'))) {
    for (const s of readdirSync(join(st.HOME, 'seats', loop))) {
      const dir = join(st.HOME, 'seats', loop, s), f = join(dir, 'SKILL.md');
      if (!existsSync(f)) { seatFail++; fail(`seat ${loop}/${s}: no SKILL.md`); continue; }
      const { data, body } = splitFrontmatter(readFileSync(f, 'utf8'));
      const errs = validate(seatSchema, data);
      if (errs.length) { seatFail++; fail(`seat ${loop}/${s}: ${errs.join('; ')}`); continue; }
      if (data.name !== s || data.loop !== loop) { seatFail++; fail(`seat ${loop}/${s}: name/loop must match the folder`); continue; }
      if (body.split('\n').length >= 150) warn(`seat ${loop}/${s}: body is >= 150 lines; move detail to references/`);
      for (const ref of data.references || []) if (!existsSync(join(dir, ref))) { seatFail++; fail(`seat ${loop}/${s}: missing reference ${ref}`); }
      seats++;
    }
  }
  if (!seatFail) ok(`${seats} seats valid`);

  for (const t of ['bet.md', 'requirements.md', 'design.md', 'AGENTS.md', 'project-policy.yaml', 'bridgie-gitignore']) if (!existsSync(join(st.HOME, 'templates', t))) fail(`template missing: ${t}`);
  for (const t of ['base.html', 'inbox.html', 'bet.html']) if (!existsSync(join(st.HOME, 'ui', 'templates', t))) fail(`ui template missing: ${t}`);
  if (!r.some(([k, m]) => k === 'fail' && /template missing/.test(m))) ok('templates present');

  for (const a of readdirSync(join(st.HOME, 'adapters'))) {
    const run = join(st.HOME, 'adapters', a, 'run.mjs');
    if (!existsSync(run)) continue;
    const p = spawnSync(process.execPath, [run, '--probe'], { encoding: 'utf8', timeout: 30000 });
    p.status === 0 && /OK/.test(p.stdout || '') ? ok(`adapter ${a}: probe OK`) : warn(`adapter ${a}: probe failed: ${((p.stderr || p.stdout || p.error?.message || '').trim().split('\n')[0]) || 'no output'}`);
  }

  // The agent skill: one source in skills/bridgie/, copies in each agent's skills folder.
  if (process.env.CLAUDE_CODE_REMOTE) ok('Claude cloud session: the bridgie skill comes from claude.ai (upload skills/bridgie/SKILL.md there after it changes)');
  else if (existsSync(join(skillSource(st.HOME), 'SKILL.md'))) {
    const got = installedSkills(st.HOME);
    if (!got.length) warn('agent skill not installed; run: bridgie setup --no-link --no-policy');
    for (const t of got) t.state === 'current' ? ok(`skill current for ${t.who}: ${t.dir}`)
      : warn(`skill out of date for ${t.who}: ${t.dir}; run: bridgie setup --no-link --no-policy`);
  }

  if (!root) { warn('not inside a project: tool checks only'); return r; }
  try { st.loadPolicy(root); ok('project policy merges and validates'); } catch (e) { fail(`project policy: ${e.message}`); }
  try {   // Antigravity runs only in a folder one of its projects covers; say so before a seat fails
    const pol = st.loadPolicy(root), routes = [...Object.values(pol.routing?.tiers || {}), ...Object.values(pol.routing?.seats || {})];
    if (!process.env.BRIDGIE_ADAPTER && routes.some(x => x.adapter === 'antigravity')) {
      const p = spawnSync(process.execPath, [join(st.HOME, 'adapters', 'antigravity', 'run.mjs'), '--check-cwd', root], { encoding: 'utf8', timeout: 30000 });
      if (p.status === 0) ok(`Antigravity project for this folder: ${(p.stdout || '').trim().replace(/^OK /, '')}`);
      else {
        const spare = st.fallbacks(root, 'antigravity')[0];
        warn(`no Antigravity project covers ${root}; seats routed to Antigravity will ${spare ? `fall back to ${spare}` : 'fail'}. Fix: open this folder once in Antigravity, or set BRIDGIE_AGY_PROJECT to a project id`);
      }
    }
  } catch { /* policy errors are reported above */ }
  const betSchema = st.loadSchema('bet'), decSchema = st.loadSchema('decisions'); let betFail = 0;
  for (const s of st.listBets(root)) {
    const e1 = validate(betSchema, st.readFm(st.betPath(root, s)).data); if (e1.length) { betFail++; fail(`bet ${s}: ${e1.join('; ')}`); }
    const dp = st.decisionsPath(root, s); if (existsSync(dp)) { const e2 = validate(decSchema, st.readJson(dp)); if (e2.length) { betFail++; fail(`decisions ${s}: ${e2.join('; ')}`); } }
  }
  if (!betFail) ok(`${st.listBets(root).length} bet(s) checked`);
  const am = join(root, 'AGENTS.md');
  if (existsSync(am)) {
    const txt = readFileSync(am, 'utf8'); const n = txt.split('\n').length;
    n > 120 ? warn(`AGENTS.md is ${n} lines; it is a map, aim for ~100`) : ok(`AGENTS.md ${n} lines`);
    for (const m of txt.matchAll(/\]\(([^)#:]+)\)/g)) if (!existsSync(join(root, m[1]))) fail(`AGENTS.md link does not resolve: ${m[1]}`);
  } else warn('no AGENTS.md in project; copy templates/AGENTS.md once the project has code');
  // Run logs tracked by git before Bridgie ignored them: they stay tracked until someone untracks them.
  try {
    const tracked = spawnSync('git', ['-C', root, 'ls-files', '--', '.bridgie/runs'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const logs = tracked.status === 0 ? tracked.stdout.split('\n').filter(f => /(\.log(\.err)?|\/diff\.patch|\/reply\.txt)$/.test(f)) : [];
    let commit = false; try { commit = st.loadPolicy(root).commit_transcripts === true; } catch { /* reported above */ }
    if (logs.length && !commit) warn(`${logs.length} run log(s), diff packet(s) and raw replies are tracked by git under .bridgie/runs; new ones are ignored. To untrack the old ones and keep the files: git rm -r -q --cached .bridgie/runs && git add .bridgie/runs`);
    else if (!commit) ok('run logs are kept out of git');
  } catch { /* not a git repository */ }
  const left = leftoverSnapshots(root);
  if (left.length) {
    const mb = Math.round(left.reduce((n, x) => n + x.bytes, 0) / 1048576);
    warn(`${left.length} leftover state snapshot(s) under .bridgie/runs (${mb} MB) from an older Bridgie; safe to delete (not committed): find .bridgie/runs -type d -name .snapshot -prune -exec rm -rf {} +`);
  } else ok('no leftover state snapshots');
  return r;
}

function flag(a, n) { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; }
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const a = process.argv.slice(2);
  const results = doctor(flag(a, 'root'));
  for (const [k, m] of results) console.log(`[${k}] ${m}`);
  process.exit(results.some(([k]) => k === 'fail') ? 1 : 0);
}
