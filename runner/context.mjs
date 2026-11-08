// Assemble a seat's prompt from exactly the inputs its manifest declares.
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { splitFrontmatter } from './yaml.mjs';
import { assertValid } from './schema.mjs';
import { HOME, loadSchema, loadPolicy, betPath, readFm, readJson, tasksPath, runsDir } from './state.mjs';

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
  const betFile = (f, label) => file(join(root, '.bridgie', 'bets', slug, f), label || `.bridgie/bets/${slug}/${f}`);
  if (name === 'opportunity') return betFile('opportunity.md', 'the scouted opportunity this bet came from');
  if (name === 'research') return betFile('research.md');
  if (name === 'board') return betFile('board.md');
  if (name === 'panel') return betFile('panel.md');
  if (name === 'numbers') return betFile('numbers.md');
  if (name === 'signals' || name === 'evidence_material') {
    // Text files the runner copied into the run directory (scout) or the owner dropped beside the bet (evidence).
    const dir = name === 'signals' ? join(runDir, 'signals') : join(root, '.bridgie', 'bets', slug, 'evidence');
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir).filter(f => !f.startsWith('_') && statSync(join(dir, f)).isFile()).sort();
    if (!files.length) return null;
    let total = 0;
    const parts = files.map(f => {
      let t = readFileSync(join(dir, f), 'utf8');
      if (t.length > 40 * 1024) t = t.slice(0, 40 * 1024) + '\n…[truncated]';
      total += t.length;
      return total > 400 * 1024 ? `### ${f}\n(omitted: total cap reached)` : `### ${f}\n\n${t.trim()}`;
    });
    const label = name === 'signals' ? `signal files (${files.length}); the runner copied them, nothing else is in scope` : `evidence material the owner collected (${files.length} files)`;
    return { label, text: parts.join('\n\n'), path: dir };
  }
  if (name === 'lens_memos') {
    const dir = join(runDir, 'memos');
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir).filter(f => f.endsWith('.md')).sort();
    return files.length ? { label: `the three lens memos`, text: files.map(f => `### ${f.replace(/\.md$/, '')}\n\n${readFileSync(join(dir, f), 'utf8').trim()}`).join('\n\n'), path: dir } : null;
  }
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
  if (name === 'card') {
    // One swarm member's variables (a buyer persona card), copied by run_seat --vars.
    const f = join(runDir, 'vars.json');
    if (!existsSync(f)) throw new Error('seat input "card" needs run_seat --vars <json>');
    return { label: 'your card (this run only)', text: '```json\n' + JSON.stringify(readJson(f), null, 2) + '\n```', path: f };
  }
  if (name === 'mechanical_results') {
    // The runner ran these commands in the task worktree before the review (finding 6: the
    // reviewer cannot run anything itself). Each row with the tail of its log.
    const f = join(runDir, 'mechanical.json');
    if (!existsSync(f)) return null;
    const rows = readJson(f);
    const tail = p => { if (!p || !existsSync(join(runDir, basename(p)))) return '(no log)'; const l = readFileSync(join(runDir, basename(p)), 'utf8').split('\n'); return l.slice(-60).join('\n').trim() || '(empty log)'; };
    const text = rows.length
      ? rows.map(r => `### ${r.id} · ${r.tier} · ${r.result}\nCommand: ${r.check}\n\n\`\`\`\n${tail(r.artifact)}\n\`\`\``).join('\n\n')
      : 'The runner ran no commands for this task.';
    return { label: 'test results (runner-run, read-only)', text, path: f };
  }
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
  if (name === 'acceptance_packet') return file(join(runDir, 'acceptance-packet.md'), 'acceptance packet (runner-built)');
  if (name === 'acceptance') return file(join(root, '.bridgie', 'acceptance', `${slug}.md`), `.bridgie/acceptance/${slug}.md`);
  throw new Error(`unknown seat input "${name}"`);
}

export function assemble(root, slug, seatRel, opts = {}) {
  const { manifest, body, dir } = loadSeat(seatRel);
  // A bet-less run (bridgie scout) uses the project's default lane.
  const hasBet = existsSync(betPath(root, slug));
  const lane = hasBet ? readFm(betPath(root, slug)).data.lane : (loadPolicy(root).default_lane || 'engineering');
  const ctx = { root, slug, lane, runDir: opts.runDir, cwd: opts.cwd || root, task: opts.task };
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
