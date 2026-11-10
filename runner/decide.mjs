// Decide-loop writers: scout opportunities, framing a bet, research, the lens board, the buyer
// panel summary and evidence synthesis. Every write goes through state.mjs's writers, and every
// verdict here is computed from the artifact, never copied from a model's claim.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, extname, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as st from './state.mjs';
import { assertValid } from './schema.mjs';

export const betDir = (root, slug) => join(root, '.bridgie', 'bets', slug);

// stopped: a seat that hit one of its stop conditions returns no artifact, only the question(s) the
// owner must answer first. That is a valid outcome, not a malformed output: the questions are raised
// and the command waits for the owner (exit 3) instead of rejecting the run.
export function stopped(outputFile) {
  const o = JSON.parse(readFileSync(outputFile, 'utf8'));
  return !(o.artifact_md || '').trim() && (o.questions || []).length > 0;
}
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

// ---------- research ----------
export const RESEARCH_SECTIONS = ['Direct competitors', 'Indirect and substitutes', 'Prices', 'What their customers complain about', 'Not found', 'Sources'];
const LINK = /https?:\/\/[^\s)>\]]+/g;
const linksIn = md => [...new Set([...md.matchAll(LINK)].map(m => m[0]))];

// researchLinks: every distinct link in the researcher's artifact.
export const researchLinks = outputFile => linksIn(loadOutput(outputFile).artifact_md || '');

// checkLinks: ask each link once. 404 and 410 mean the page does not exist (dead); any other
// answer below 400 is live; a refusal, a timeout or no network means it could not be checked,
// which is never held against the research (many sites refuse scripts; some networks block them).
export async function checkLinks(links, fetcher = fetchStatus, parallel = 8) {
  const res = { live: [], dead: [], unchecked: [] };
  const verdicts = new Array(links.length);
  let next = 0;
  const worker = async () => {
    while (next < links.length) {
      const i = next++;
      try { const r = await fetcher(links[i]); verdicts[i] = r.status === 404 || r.status === 410 ? 'dead' : r.ok ? 'live' : 'unchecked'; }
      catch { verdicts[i] = 'unchecked'; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, links.length) }, worker));
  links.forEach((l, i) => res[verdicts[i]].push(l));
  return res;
}
async function fetchStatus(url) {
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; link-check)' } });
  r.body?.cancel().catch(() => {});
  return { status: r.status, ok: r.ok };
}

// unlinkedFacts: the two sections whose every entry is a claim about someone else's product.
// A competitor row or a complaint with no link is the model's memory, not research.
function unlinkedFacts(md) {
  const bad = [];
  for (const s of sections(md)) {
    const lines = s.body.split('\n').map(l => l.trim());
    let facts = [];
    if (s.title === 'Direct competitors') facts = lines.filter(l => l.startsWith('|') && !/^\|[\s:|-]+\|?$/.test(l)).slice(1);   // table rows after the header
    if (s.title === 'What their customers complain about') facts = lines.filter(l => /^([-*]|\d+\.)\s/.test(l));
    for (const l of facts) if (!l.match(LINK)) bad.push(`${s.title}: no link on "${l.slice(0, 80)}"`);
  }
  return bad;
}

// writeResearch: the researcher's artifact must have every section and carry links; a report with
// fewer than three distinct links is a memory dump, not research, and is rejected. `linkCheck`
// (from checkLinks) is the runner's own finding: dead links do not count and are listed on the page.
export function writeResearch(root, slug, outputFile, linkCheck = null) {
  const o = loadOutput(outputFile);
  if (!o.artifact_md) throw new Error('researcher output has no artifact_md');
  const titles = sections(o.artifact_md).map(s => s.title);
  const missing = RESEARCH_SECTIONS.filter(h => !titles.includes(h));
  if (missing.length) throw new Error(`research is missing sections: ${missing.join(', ')}`);
  const unlinked = unlinkedFacts(o.artifact_md);
  if (unlinked.length) throw new Error(`research has facts with no source:\n  ${unlinked.join('\n  ')}`);
  const links = linksIn(o.artifact_md);
  const dead = linkCheck ? links.filter(l => linkCheck.dead.includes(l)) : [];
  const usable = links.length - dead.length;
  if (usable < 3) throw new Error(dead.length
    ? `research cites ${usable} link(s) that answer; every fact needs a source (at least 3 distinct links). dead: ${dead.join(', ')}`
    : `research cites ${links.length} link(s); every fact needs a source (at least 3 distinct links)`);
  let check = '';
  if (linkCheck) {
    const unchecked = links.filter(l => linkCheck.unchecked.includes(l));
    check = [`\n## Link check`, '', `Checked by Bridgie, not by the model: ${links.length - dead.length - unchecked.length} answered, ${dead.length} dead, ${unchecked.length} could not be checked.`,
      ...(dead.length ? ['', 'Dead (the page does not exist; treat what cites it as unproven):', ...dead.map(l => `- ${l}`)] : []),
      ...(unchecked.length ? ['', 'Could not be checked (refused, timed out or no network):', ...unchecked.map(l => `- ${l}`)] : []), ''].join('\n');
  }
  const f = join(betDir(root, slug), 'research.md');
  writeFileSync(f, `# Research — ${slug}\n\nResearched ${st.today()}. ${o.summary_md.trim()}\n\n${o.artifact_md.trim()}\n${check}`);
  return { file: f, links: links.length, dead: dead.length };
}

// ---------- board (lenses + chair) ----------
export const LENSES = ['offer', 'moat', 'product'];
const VOTES = { FUND: 'fund', 'FUND IF': 'fund if', PASS: 'pass' };
// parseMemo: first line "Score: n | Vote: FUND|FUND IF|PASS"; the runner reads these, never the chair.
export function parseMemo(md, lens) {
  const first = (md.trim().split('\n')[0] || '');
  const m = first.match(/^Score:\s*(10|[1-9])\s*\|\s*Vote:\s*(FUND IF|FUND|PASS)\s*$/i);
  if (!m) throw new Error(`${lens} memo must start with "Score: <1-10> | Vote: FUND | FUND IF | PASS" (got "${first.slice(0, 60)}")`);
  const got = Object.fromEntries(sections(md).map(s => [s.title, s.body]));
  for (const h of ['What is strong', 'What would kill it', 'Conditions']) if (!(h in got)) throw new Error(`${lens} memo is missing "## ${h}"`);
  return { lens, score: Number(m[1]), vote: VOTES[m[2].toUpperCase()], kill: got['What would kill it'], conditions: got['Conditions'], md };
}

export function writeMemo(runDir, lens, outputFile) {
  const o = loadOutput(outputFile);
  const memo = parseMemo(o.artifact_md || '', lens);
  mkdirSync(join(runDir, 'memos'), { recursive: true });
  writeFileSync(join(runDir, 'memos', `${lens}.md`), memo.md.trim() + '\n');
  return memo;
}

// writeBoard: vote line and average computed from the memos; the chair's text follows.
export function writeBoard(root, slug, memos, chairOutputFile) {
  const o = loadOutput(chairOutputFile);
  const tally = {}; for (const m of memos) tally[m.vote] = (tally[m.vote] || 0) + 1;
  const voteLine = ['fund', 'fund if', 'pass'].filter(v => tally[v]).map(v => `${tally[v]} ${v}`).join(', ');
  const avg = Math.round(memos.reduce((n, m) => n + m.score, 0) / memos.length * 10) / 10;
  const board = {
    bet: slug, date: st.today(), vote: voteLine, average_score: avg,
    members: memos.map(m => ({ lens: m.lens, score: m.score, vote: m.vote })),
    chair_summary: o.summary_md.trim(),
  };
  const md = [`# Board — ${slug}`, '', `**Vote:** ${voteLine} · **average score:** ${avg}/10 · ${st.today()}`, '',
    '| Lens | Score | Vote |', '|---|---|---|', ...memos.map(m => `| ${m.lens} | ${m.score} | ${m.vote} |`), '',
    '## Chair', '', o.summary_md.trim(), '', (o.artifact_md || '').trim(), '',
    ...memos.flatMap(m => [`## Memo · ${m.lens} lens`, '', m.md.trim(), ''])].join('\n');
  writeFileSync(join(betDir(root, slug), 'board.md'), md);
  writeFileSync(join(betDir(root, slug), 'board.json'), JSON.stringify(board, null, 2) + '\n');
  return board;
}

// ---------- evidence ----------
export function openEvidenceTasks(root, slug) {
  const { body } = st.readFm(st.betPath(root, slug));
  const sec = sections(body).find(s => s.title === 'Evidence tasks');
  if (!sec) return [];
  return [...sec.body.matchAll(/^- \[ \] (E[-\w]+):\s*(.*)$/gm)].map(m => ({ id: m[1], text: m[2].trim() }));
}

// writeEvidence: plan mode → evidence-plan.md with one section per open task; synthesis mode →
// evidence-synthesis.md and the confidence proposal text (the caller turns it into a decision).
export function writeEvidence(root, slug, outputFile, mode) {
  const o = loadOutput(outputFile);
  if (!o.artifact_md) throw new Error('evidence output has no artifact_md');
  const dir = betDir(root, slug);
  if (mode === 'plan') {
    const open = openEvidenceTasks(root, slug);
    const got = o.artifact_md.match(/^### (E[-\w]+)\b/gm)?.map(h => h.replace(/^### /, '')) || [];
    const missing = open.filter(t => !got.includes(t.id)).map(t => t.id);
    if (missing.length) throw new Error(`evidence plan has no section for: ${missing.join(', ')}`);
    writeFileSync(join(dir, 'evidence-plan.md'), `# Evidence plan — ${slug}\n\n${st.today()}. ${o.summary_md.trim()}\n\n${o.artifact_md.trim()}\n`);
    return { file: 'evidence-plan.md', tasks: open.length, proposal: null };
  }
  const titles = sections(o.artifact_md).map(s => s.title);
  for (const h of ['What the material shows', 'What it does not show', 'Sources']) if (!titles.includes(h)) throw new Error(`evidence synthesis is missing "## ${h}"`);
  writeFileSync(join(dir, 'evidence-synthesis.md'), `# Evidence synthesis — ${slug}\n\n${st.today()}. ${o.summary_md.trim()}\n\n${o.artifact_md.trim()}\n`);
  const prop = (o.proposals || []).find(p => p.kind === 'confidence');
  return { file: 'evidence-synthesis.md', tasks: 0, proposal: prop ? prop.text : null };
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
  'open-evidence-tasks': a => out(openEvidenceTasks(a[0], a[1])),
  'write-evidence': a => out(writeEvidence(a[0], a[1], a[2], a[3])),
  'write-research': a => out(writeResearch(a[0], a[1], a[2])),
  'write-memo': a => out(writeMemo(a[0], a[1], a[2])),
  'write-board': a => { const memos = LENSES.map(l => parseMemo(readFileSync(join(a[2], 'memos', `${l}.md`), 'utf8'), l)); out(writeBoard(a[0], a[1], memos, a[3])); },
};
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [op, ...a] = process.argv.slice(2);
  try {
    if (!OPS[op]) throw new Error(`unknown op "${op}"`);
    OPS[op](a);
  } catch (e) { console.error(`decide.mjs: ${e.message}`); process.exit(1); }
}
