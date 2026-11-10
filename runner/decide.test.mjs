import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as d from './decide.mjs';

test('replaceSection replaces one section, keeps the others, appends when missing', () => {
  const body = '# T\n\n## A\n\nold a\n\n## B\n\nkeep b\n';
  const r = d.replaceSection(body, 'A', 'new a\nline 2');
  assert.match(r, /## A\n\nnew a\nline 2\n\n## B\n\nkeep b\n$/);
  assert.match(d.replaceSection(body, 'C', 'c'), /keep b\n\n## C\n\nc\n$/);
});

test('parseOpportunities needs Sources and Severity on every section', () => {
  const md = '## O1 · slow refunds\nSources: 3 (a, b, c)\nSeverity: high — lost deals\nQuote: "x" (a)\nToday: spreadsheets\n\n## O2 · fees\nSources: 1 (d)\nSeverity: low';
  const o = d.parseOpportunities(md);
  assert.equal(o.length, 2); assert.equal(o[0].sources, 3); assert.equal(o[0].severity, 'high'); assert.equal(o[0].today, 'spreadsheets');
  assert.throws(() => d.parseOpportunities('## O1 · x\nSeverity: high'), /missing "Sources/);
  assert.throws(() => d.parseOpportunities('## Intro\nnothing'), /no "## O<n>/);
});

// ---------- research: every fact linked, links checked ----------
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as st from './state.mjs';

const RESEARCH = ({ competitor = '| Acme | parsing | £9 | https://a.example/acme |', complaint = '- "too slow" https://r.example/acme' } = {}) =>
  `## Direct competitors\n| Name | What | Price | Link |\n|---|---|---|---|\n${competitor}\n| Beta | reports | £5 | https://b.example/beta |\n\n## Indirect and substitutes\n- A spreadsheet\n\n## Prices\n- Nothing today (no public figure).\n\n## What their customers complain about\n${complaint}\n\n## Not found\n- Nothing.\n\n## Sources\n- https://a.example/acme\n- https://b.example/beta\n- https://r.example/acme\n`;
function researchProject(artifact_md) {
  const root = mkdtempSync(join(tmpdir(), 'bridgie-research-'));
  mkdirSync(join(root, '.bridgie', 'bets'), { recursive: true });
  writeFileSync(join(root, '.bridgie', 'policy.yaml'), 'version: 1\n');
  st.betNew(root, 'b', { title: 'B', lane: 'product', risk: 'none', owner: 'tester' });
  const out = join(root, 'out.json');
  writeFileSync(out, JSON.stringify({ seat: 'researcher', summary_md: 's', artifact_md }));
  return { root, out };
}

test('writeResearch: a competitor row or a complaint without a link is rejected; unlinked substitutes and prices are allowed', () => {
  let p = researchProject(RESEARCH());
  assert.equal(d.writeResearch(p.root, 'b', p.out).links, 3);
  p = researchProject(RESEARCH({ competitor: '| Acme | parsing | £9 | their site |' }));
  assert.throws(() => d.writeResearch(p.root, 'b', p.out), /Direct competitors.*no link.*Acme/s);
  p = researchProject(RESEARCH({ complaint: '- "too slow", say reviewers' }));
  assert.throws(() => d.writeResearch(p.root, 'b', p.out), /What their customers complain about.*no link.*too slow/s);
});

test('checkLinks: 404 and 410 are dead, other answers are live, anything else could not be checked', async () => {
  const answers = { 'https://ok.example/': 200, 'https://gone.example/': 404, 'https://gone2.example/': 410, 'https://bot.example/': 403 };
  const fetcher = async url => { if (!(url in answers)) throw new Error('no network'); return { status: answers[url], ok: answers[url] < 400 }; };
  const res = await d.checkLinks([...Object.keys(answers), 'https://down.example/'], fetcher);
  assert.deepEqual(res.live, ['https://ok.example/']);
  assert.deepEqual(res.dead, ['https://gone.example/', 'https://gone2.example/']);
  assert.deepEqual(res.unchecked, ['https://bot.example/', 'https://down.example/']);
});

test('writeResearch: dead links do not count as sources, and the page says what the runner found', () => {
  let p = researchProject(RESEARCH());
  assert.deepEqual(d.researchLinks(p.out).sort(), ['https://a.example/acme', 'https://b.example/beta', 'https://r.example/acme']);
  const check = { live: ['https://a.example/acme', 'https://b.example/beta'], dead: ['https://r.example/acme'], unchecked: [] };
  assert.throws(() => d.writeResearch(p.root, 'b', p.out, check), /2 link\(s\) that answer.*dead: https:\/\/r\.example\/acme/s);
  p = researchProject(RESEARCH() + '- https://extra.example/x\n- https://dead.example/y\n');
  const res = d.writeResearch(p.root, 'b', p.out, { live: ['https://a.example/acme', 'https://b.example/beta', 'https://r.example/acme'], dead: ['https://dead.example/y'], unchecked: ['https://extra.example/x'] });
  assert.equal(res.dead, 1);
  const md = readFileSync(res.file, 'utf8');
  assert.match(md, /## Link check[\s\S]*3 answered, 1 dead, 1 could not be checked[\s\S]*https:\/\/dead\.example\/y/);
  p = researchProject(RESEARCH());
  assert.doesNotMatch(readFileSync(d.writeResearch(p.root, 'b', p.out).file, 'utf8'), /Link check/, 'no section when links were not checked');
});
