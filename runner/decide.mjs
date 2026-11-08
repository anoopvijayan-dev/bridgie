// Decide-loop writers: scout opportunities, framing a bet, research, the lens board, the buyer
// panel summary and evidence synthesis. Every write goes through state.mjs's writers, and every
// verdict here is computed from the artifact, never copied from a model's claim.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, extname, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as st from './state.mjs';
import { assertValid } from './schema.mjs';

export const betDir = (root, slug) => join(root, '.bridgie', 'bets', slug);
export const scoutDir = (root, name) => join(root, '.bridgie', 'scout', name);
const SCOUT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TEXT_EXT = new Set(['.md', '.txt', '.csv', '.json', '.yaml', '.yml', '.eml', '.log', '.tsv', '.html', '.htm']);
export const FILE_CAP = 40 * 1024, TOTAL_CAP = 400 * 1024;

const loadOutput = f => assertValid(st.loadSchema('seat-output'), st.readJson(f), f);
const sections = md => {
  // "## Heading" → { title, body } in order; text before the first heading is dropped.
  const out = []; let cur = null;
  for (const l of md.replace(/\r\n/g, '\n').split('\n')) {
    const h = l.match(/^## (.+)/);
    if (h) { cur = { title: h[1].trim(), lines: [] }; out.push(cur); continue; }
    if (cur) cur.lines.push(l);
  }
  return out.map(s => ({ title: s.title, body: s.lines.join('\n').replace(/^\n+|\s+$/g, '') }));
};

// ---------- signals ----------
// collectSignals: copy the text files of a folder into <packet>/signals/, capped per file and in total.
// Returns { copied: [...], skipped: [{ file, why }] }. Binary and oversized files are listed, not read.
export function collectSignals(from, packet) {
  const out = join(packet, 'signals'); mkdirSync(out, { recursive: true });
  const copied = [], skipped = []; let total = 0;
  const walk = dir => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.')) continue;
      const p = join(dir, name), s = statSync(p);
      if (s.isDirectory()) { walk(p); continue; }
      if (!s.isFile()) continue;
      const rel = relative(from, p).split(sep).join('/');
      if (!TEXT_EXT.has(extname(name).toLowerCase())) { skipped.push({ file: rel, why: 'not a text file' }); continue; }
      if (total >= TOTAL_CAP) { skipped.push({ file: rel, why: 'total cap reached' }); continue; }
      let text = readFileSync(p, 'utf8');
      if (text.includes('\u0000')) { skipped.push({ file: rel, why: 'binary content' }); continue; }
      if (text.length > FILE_CAP) text = text.slice(0, FILE_CAP) + `\n…[truncated at ${FILE_CAP} bytes]\n`;
      total += text.length;
      const dest = join(out, rel.replace(/\//g, '__'));
      writeFileSync(dest, text);
      copied.push(rel);
    }
  };
  walk(from);
  writeFileSync(join(out, '_index.json'), JSON.stringify({ from, copied, skipped }, null, 2) + '\n');
  return { copied, skipped };
}

// ---------- scout ----------
// writeOpportunities: the scout's artifact_md must list "## O<n> · <problem>" sections, each with
// "Sources:" and "Severity:" lines. Anything else is rejected: no counts, no opportunity.
export function parseOpportunities(md) {
  const secs = sections(md).filter(s => /^O[0-9]+\b/.test(s.title));
  if (!secs.length) throw new Error('scout output has no "## O<n> · <problem>" sections');
  return secs.map(s => {
    const id = s.title.match(/^(O[0-9]+)/)[1];
    const problem = s.title.replace(/^O[0-9]+\s*[·:-]?\s*/, '').trim();
    const src = s.body.match(/^Sources:\s*(\d+)\b(.*)$/m);
    const sev = s.body.match(/^Severity:\s*(high|medium|low)\b(.*)$/mi);
    if (!src) throw new Error(`${id}: missing "Sources: <count> (...)" line`);
    if (!sev) throw new Error(`${id}: missing "Severity: high|medium|low — <why>" line`);
    const quote = (s.body.match(/^Quote:\s*(.*)$/m) || [])[1] || '';
    const today = (s.body.match(/^(?:What they do today|Today):\s*(.*)$/m) || [])[1] || '';
    return { id, problem, sources: Number(src[1]), sources_note: src[2].trim(), severity: sev[1].toLowerCase(), severity_note: sev[2].replace(/^\s*[—-]\s*/, '').trim(), quote, today, body: s.body };
  });
}

export function writeOpportunities(root, name, outputFile, meta = {}) {
  if (!SCOUT_NAME.test(name)) throw new Error(`invalid scout name "${name}": lowercase letters, digits, hyphens`);
  const o = loadOutput(outputFile);
  const md = o.artifact_md || o.summary_md;
  const opps = parseOpportunities(md);
  const dir = scoutDir(root, name); mkdirSync(dir, { recursive: true });
  const head = `# Opportunities — ${name}\n\nScouted ${st.today()} from ${meta.from || 'signals'} (${meta.files ?? '?'} files). Ranked by independent sources × severity; counts are the scout's reading of the material, not evidence.\n\n`;
  writeFileSync(join(dir, 'opportunities.md'), head + md.trim() + '\n');
  writeFileSync(join(dir, 'opportunities.json'), JSON.stringify({ name, scouted: st.today(), from: meta.from || null, opportunities: opps.map(({ body, ...rest }) => rest) }, null, 2) + '\n');
  return opps;
}

export function opportunity(root, ref) {
  const m = ref.match(/^([a-z0-9][a-z0-9-]*)\/(O[0-9]+)$/);
  if (!m) throw new Error(`opportunity reference "${ref}" must look like <scout-name>/O2`);
  const f = join(scoutDir(root, m[1]), 'opportunities.md');
  if (!existsSync(f)) throw new Error(`no scout run named "${m[1]}" (bridgie scout --from <folder> --name ${m[1]})`);
  const o = parseOpportunities(readFileSync(f, 'utf8')).find(x => x.id === m[2]);
  if (!o) throw new Error(`no opportunity ${m[2]} in scout "${m[1]}"`);
  return { ...o, scout: m[1] };
}

// seedBetFromOpportunity: fill Who / Problem in their words / What they do today from the opportunity
// and keep a copy of it beside the bet (the framer's "opportunity" input).
export function seedBetFromOpportunity(root, slug, ref) {
  const o = opportunity(root, ref);
  const file = st.betPath(root, slug);
  let { data, body } = st.readFm(file);
  const put = (heading, text) => { body = replaceSection(body, heading, text); };
  put('Problem in their words', `${o.problem}\n\n${o.quote ? `> ${o.quote}\n\n` : ''}Sources: ${o.sources}${o.sources_note ? ` ${o.sources_note}` : ''}. Severity: ${o.severity}${o.severity_note ? ` — ${o.severity_note}` : ''}.\n\nFrom scout ${o.scout} (${o.id}); counts are the scout's reading, not evidence yet.`);
  if (o.today) put('What they do today', o.today);
  st.writeFm(file, data, body, 'bet');
  writeFileSync(join(betDir(root, slug), 'opportunity.md'), `# ${o.id} · ${o.problem}\n\nFrom scout ${o.scout}.\n\n${o.body}\n`);
  return o;
}

// replaceSection: replace the text under "## <heading>" (up to the next "## ") or append the section.
export function replaceSection(body, heading, text) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(l => l.trim() === `## ${heading}`);
  const block = ['', `## ${heading}`, '', ...text.replace(/\s+$/, '').split('\n'), ''];
  if (start < 0) return `${body.replace(/\s+$/, '')}\n${block.join('\n')}`;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^## /.test(lines[i])) { end = i; break; }
  lines.splice(start, end - start, ...block.slice(1));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
}

// ---------- frame ----------
export const FRAMED_SECTIONS = ['Who', 'Problem in their words', 'Why now', 'What they do today', 'Expected outcome'];
// applyFrame: the framer's artifact_md replaces the five framed sections of the bet body; every other
// section (open questions, evidence tasks, decision log) is kept. Returns the sections it replaced.
export function applyFrame(root, slug, outputFile) {
  const o = loadOutput(outputFile);
  if (!o.artifact_md) throw new Error('framer output has no artifact_md (the bet body)');
  const got = Object.fromEntries(sections(o.artifact_md).map(s => [s.title, s.body]));
  const present = FRAMED_SECTIONS.filter(h => got[h] && got[h].trim());
  if (present.length < 2) throw new Error(`framer output must contain the bet sections (${FRAMED_SECTIONS.join(', ')}); found: ${present.join(', ') || 'none'}`);
  const file = st.betPath(root, slug);
  let { data, body } = st.readFm(file);
  for (const h of present) body = replaceSection(body, h, got[h]);
  st.writeFm(file, data, body, 'bet');
  return present;
}

export function addIdeaLine(root, slug, idea) {
  const file = st.betPath(root, slug);
  const { data, body } = st.readFm(file);
  st.writeFm(file, data, replaceSection(body, 'Idea', idea.trim()), 'bet');
}

// ---------- CLI ----------
function flag(a, n) { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; }
const out = x => process.stdout.write((typeof x === 'string' ? x : JSON.stringify(x, null, 2)) + '\n');
export const OPS = {
  'collect-signals': a => out(collectSignals(a[0], a[1])),
  'write-opportunities': a => out(writeOpportunities(a[0], a[1], a[2], { from: flag(a, 'from'), files: flag(a, 'files') }).map(o => `${o.id} ${o.problem} (${o.sources} sources, ${o.severity})`).join('\n')),
  'opportunity': a => out(opportunity(a[0], a[1])),
  'seed-bet': a => out(seedBetFromOpportunity(a[0], a[1], a[2]).id),
  'apply-frame': a => out(applyFrame(a[0], a[1], a[2]).join(', ')),
  'add-idea': a => { addIdeaLine(a[0], a[1], a[2]); out('ok'); },
};
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [op, ...a] = process.argv.slice(2);
  try {
    if (!OPS[op]) throw new Error(`unknown op "${op}"`);
    OPS[op](a);
  } catch (e) { console.error(`decide.mjs: ${e.message}`); process.exit(1); }
}
