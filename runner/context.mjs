// Assemble a seat's prompt from exactly the inputs its manifest declares.
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { splitFrontmatter } from './yaml.mjs';
import { assertValid } from './schema.mjs';
import { HOME, loadSchema, betPath, readFm, readJson, tasksPath, runsDir } from './state.mjs';

const REQUIRED = new Set(['bet', 'requirements', 'design', 'task']);

export function loadSeat(seatRel) {
  const dir = join(HOME, 'seats', seatRel);
  const f = join(dir, 'SKILL.md');
  if (!existsSync(f)) throw new Error(`no such seat: ${seatRel}`);
  const { data, body } = splitFrontmatter(readFileSync(f, 'utf8'));
  assertValid(loadSchema('seat'), data, f);
  return { dir, manifest: data, body };
}

function newest(root, slug, task, name) {
  const d = runsDir(root, slug);
  if (!existsSync(d)) return null;
  let best = null;
  for (const run of readdirSync(d)) {
    const f = join(d, run, name);
    if (!existsSync(f)) continue;
    try { if (task && readJson(f).task !== task) continue; } catch { continue; }
    const m = statSync(f).mtimeMs;
    if (!best || m > best.m) best = { f, m };
  }
  return best ? best.f : null;
}

function resolveInput(name, ctx) {
  const { root, slug, lane, runDir, cwd, task } = ctx;
  const file = (p, label) => existsSync(p) ? { label, text: readFileSync(p, 'utf8'), path: p } : null;
  if (name === 'bet') return file(betPath(root, slug), '.bridgie/bets/' + slug + '/bet.md');
  if (name === 'requirements') return file(join(root, '.bridgie', 'specs', slug, 'requirements.md'), `.bridgie/specs/${slug}/requirements.md`);
  if (name === 'design') return file(join(root, '.bridgie', 'specs', slug, 'design.md'), `.bridgie/specs/${slug}/design.md`);
  if (name === 'task') {
    if (!task) throw new Error(`seat input "task" needs --task <id>`);
    const tp = tasksPath(root, slug);
    if (!existsSync(tp)) return null;
    const t = readJson(tp).tasks.find(x => x.id === task);
    if (!t) throw new Error(`task ${task} not found in ${tp}`);
    return { label: `task ${task}`, text: '```json\n' + JSON.stringify(t, null, 2) + '\n```', path: tp };
  }
  if (name === 'diff') return file(join(runDir, 'diff.patch'), 'diff.patch');
  if (name === 'claim') { const f = newest(root, slug, task, 'claim.json'); return f ? file(f, 'latest claim.json') : null; }
  if (name === 'evidence') { const f = newest(root, slug, task, 'evidence.json'); return f ? file(f, 'latest evidence.json') : null; }
  if (name === 'repo_readonly') return { label: 'repository', text: `Repository root (read-only): ${cwd}\nRead any file you need to judge the work in context. Do not modify anything.` };
  if (name === 'lane_attacks') return file(join(HOME, 'lanes', lane, 'attacks.md'), `lanes/${lane}/attacks.md`);
  if (name.startsWith('lane_checklist:')) { const n = name.split(':')[1]; return file(join(HOME, 'lanes', lane, 'checklists', `${n}.md`), `lanes/${lane}/checklists/${n}.md`); }
  if (name === 'gotchas') {
    const parts = [];
    const p = join(root, '.bridgie', 'learn', 'gotchas.md'); if (existsSync(p)) parts.push(readFileSync(p, 'utf8'));
    const l = join(HOME, 'lanes', lane, 'gotchas.md'); if (existsSync(l)) parts.push(readFileSync(l, 'utf8'));
    return parts.length ? { label: 'gotchas (project, then lane)', text: parts.join('\n\n') } : null;
  }
  if (name === 'agents_md') return file(join(root, 'AGENTS.md'), 'AGENTS.md');
  throw new Error(`unknown seat input "${name}"`);
}

export function assemble(root, slug, seatRel, opts = {}) {
  const { manifest, body, dir } = loadSeat(seatRel);
  const bet = readFm(betPath(root, slug)).data;
  const ctx = { root, slug, lane: bet.lane, runDir: opts.runDir, cwd: opts.cwd || root, task: opts.task };
  const sections = [], inputs = [], missing = [];
  for (const raw of manifest.inputs) {
    const optional = raw.endsWith('?');
    const name = optional ? raw.slice(0, -1) : raw;
    const r = resolveInput(name, ctx);
    if (!r) { if (REQUIRED.has(name) && !optional) throw new Error(`required input "${name}" is missing for seat ${seatRel}`); missing.push(name); continue; }
    inputs.push(name);
    sections.push(`## ${name} — ${r.label}\n\n${r.text.trim()}\n`);
  }
  const refs = (manifest.references || []).map(p => `## ${p}\n\n${readFileSync(join(dir, p), 'utf8').trim()}\n`);
  const writes = manifest.writes === 'worktree' ? ` and inside your worktree (${ctx.cwd})` : '';
  const outputNote = manifest.output === 'none' ? 'This seat produces no file; print your result.' :
    `End your reply with exactly one fenced \`\`\`json block containing your ${manifest.output} (or write it to ${join(opts.runDir || '<run-dir>', manifest.output)}).\nIt must validate against ${join(HOME, 'schemas', manifest.output)}.` +
    (manifest.output === 'seat-output.json' ? `\nSet "seat": "${manifest.name}".` : '');
  const prompt = [
    `# Seat: ${manifest.name} (${manifest.loop})`, '', body.trim(), '',
    ...(refs.length ? ['# References', '', ...refs] : []),
    '# Inputs', '', ...sections,
    '# Output contract', '', outputNote, `Write nothing anywhere else except the run directory${writes}.`, '',
    '# Run directory', '', String(opts.runDir || ''), '',
  ].join('\n');
  return { prompt, inputs, missing, manifest };
}

function flag(a, n) { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; }
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [op, ...a] = process.argv.slice(2);
  try {
    if (op === 'assemble') {
      const runDir = flag(a, 'run-dir');
      const r = assemble(flag(a, 'root'), flag(a, 'slug'), flag(a, 'seat'), { runDir, cwd: flag(a, 'cwd'), task: flag(a, 'task') });
      writeFileSync(join(runDir, 'prompt.md'), r.prompt);
      writeFileSync(join(runDir, 'inputs.json'), JSON.stringify({ inputs: r.inputs, missing: r.missing }, null, 2) + '\n');
      console.log(JSON.stringify({ prompt_file: join(runDir, 'prompt.md'), inputs: r.inputs, missing: r.missing }));
    } else if (op === 'manifest') {
      const { manifest } = loadSeat(a[0]);
      const v = a[1] ? manifest[a[1]] : manifest;
      console.log(typeof v === 'string' ? v : JSON.stringify(v));
    } else { console.error(`context.mjs: unknown op "${op}"`); process.exit(2); }
  } catch (e) { console.error(`context.mjs: ${e.message}`); process.exit(1); }
}
