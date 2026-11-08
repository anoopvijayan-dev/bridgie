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
