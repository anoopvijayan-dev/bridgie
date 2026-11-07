import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as st from './state.mjs';
import { renderInbox, renderBet, renderAll, esc } from './surface.mjs';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'bridgie-ui-'));
  for (const d of ['bets', 'specs', 'runs', 'acceptance', 'decisions', 'learn']) mkdirSync(join(root, '.bridgie', d), { recursive: true });
  writeFileSync(join(root, '.bridgie', 'policy.yaml'), 'version: 1\n');
  st.betNew(root, 'b', { title: 'Net <collect>', lane: 'engineering', risk: 'none', owner: 'tester' });
  st.betTransition(root, 'b', 'grilling');
  st.addDecision(root, 'b', { type: 'question', context: 'Who retries <today>?', options: ['yes', 'no', "don't know"] });
  st.betTransition(root, 'b', 'evidence');
  st.ensureSignDecision(root, 'b');
  return root;
}

test('esc escapes html', () => { assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;'); });

test('inbox lists pending decisions with escaped text and links', () => {
  const html = renderInbox(project());
  assert.ok(html.includes('2 pending'));
  assert.ok(html.includes('Who retries &lt;today&gt;?'));
  assert.ok(html.includes('href="/bet/b#D1"'));
  assert.ok(!html.includes('<today>'));
});

test('bet page shows cards, the question form, and a blocked sign button while questions are pending', () => {
  const root = project();
  const html = renderBet(root, 'b');
  assert.ok(html.includes('Net &lt;collect&gt;'));
  assert.ok(html.includes('name="id" value="D1"'));
  assert.ok(html.includes('value="don&#39;t know"'));
  assert.ok(html.includes('Sign is blocked'));
  assert.match(html, /value="sign"[^>]*disabled/);
  st.answerDecision(root, 'b', 'D1', 'no', { by: 'tester' });
  const html2 = renderBet(root, 'b');
  assert.ok(!html2.includes('Sign is blocked'));
  assert.ok(!/value="sign"[^>]*disabled/.test(html2));
  assert.ok(html2.includes('No open questions'));
});

test('renderAll writes read-only pages with CLI hints', () => {
  const root = project();
  const out = renderAll(root, join(root, '.bridgie', 'ui'));
  assert.ok(existsSync(join(out, 'index.html')));
  assert.ok(existsSync(join(out, 'bet-b.html')));
  const html = renderBet(root, 'b', { readonly: true });
  assert.ok(html.includes('bridgie decide b D1'));
  assert.ok(!html.includes('<form'));
});
