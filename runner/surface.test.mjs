import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as st from './state.mjs';
import { renderInbox, renderBet, renderAll, esc } from './surface.mjs';
import * as fl from './flow.mjs';

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

test('a public page publishes only the named bets, with no file paths, command hints or forms', () => {
  const root = project();
  assert.throws(() => renderAll(root, join(root, 'pub'), { public: true }), /add --bet/);
  assert.throws(() => renderAll(root, join(root, 'pub'), { public: true, bets: ['nope'] }), /no such bet: nope/);
  const out = renderAll(root, join(root, 'pub'), { public: true, bets: ['b'] });
  const bet = readFileSync(join(out, 'bet-b.html'), 'utf8'), index = readFileSync(join(out, 'index.html'), 'utf8');
  for (const html of [bet, index]) {
    assert.ok(!html.includes(root), 'no local paths');
    assert.ok(!html.includes('bridgie decide') && !html.includes('bridgie sign') && !html.includes('bridgie grill'), 'no command hints');
    assert.ok(!html.includes('<form'), 'no forms');
    assert.match(html, /progress page · updated \d{4}-\d\d-\d\d/);
  }
  assert.ok(bet.includes('Who retries &lt;today&gt;?'));
  assert.ok(index.includes('<h1>Progress'));
});

test('bet page blocks sign when confidence is below the policy minimum for the risk', () => {
  const root = mkdtempSync(join(tmpdir(), 'bridgie-ui-'));
  for (const d of ['bets', 'specs', 'runs', 'acceptance', 'decisions', 'learn']) mkdirSync(join(root, '.bridgie', d), { recursive: true });
  writeFileSync(join(root, '.bridgie', 'policy.yaml'), 'version: 1\n');
  st.betNew(root, 'm', { title: 'Money bet', lane: 'engineering', risk: 'money', owner: 'tester' });
  st.betTransition(root, 'm', 'grilling'); st.betTransition(root, 'm', 'evidence');
  st.ensureSignDecision(root, 'm');
  const html = renderBet(root, 'm');
  assert.ok(html.includes('confidence &quot;opinion&quot; is below &quot;data&quot;'));
  assert.match(html, /value="sign"[^>]*disabled/);
  st.setFm(st.betPath(root, 'm'), { confidence: 'data' });
  assert.ok(renderBet(root, 'm').includes('requires unit economics'));          // money also needs numbers
  writeFileSync(join(root, '.bridgie', 'bets', 'm', 'numbers.json'), JSON.stringify({ contribution_per_unit: 3, checks: { unit_positive: true } }));
  assert.ok(!/value="sign"[^>]*disabled/.test(renderBet(root, 'm')));
});

function shapedProject() {
  const root = project();
  st.answerDecision(root, 'b', 'D1', 'no', { by: 'tester' });
  st.answerDecision(root, 'b', 'D2', 'sign', { by: 'tester' });
  const spec = join(root, '.bridgie', 'specs', 'b');
  mkdirSync(spec, { recursive: true });
  writeFileSync(join(spec, 'requirements.md'), '# Requirements\n\n## R1 · event\nWHEN a THE SYSTEM SHALL b\n');
  writeFileSync(join(spec, 'design.md'), '# Design\n\n## Decision\nUse an <idempotency> key.\n\n| Option | Verdict |\n|---|---|\n| A | lost |\n');
  return root;
}

test('design approval card shows the design and requirements with its options', () => {
  const root = shapedProject();
  fl.ensureDecision(root, 'b', 'approve_design', 'Approve the design?', ['approve', 'request changes']);
  const html = renderBet(root, 'b');
  assert.ok(html.includes('Approve design'));
  assert.ok(html.includes('Use an &lt;idempotency&gt; key.'));
  assert.ok(html.includes('<table>'));
  assert.ok(html.includes('WHEN a THE SYSTEM SHALL b'));
  assert.match(html, /name="answer" value="request changes"/);
  assert.ok(html.indexOf('Waiting for you') < html.indexOf('The bet'));
});

test('tasks table, blocked task card and acceptance card render; read-only shows CLI', () => {
  const root = shapedProject();
  st.writeJsonAtomic(st.tasksPath(root, 'b'), { bet: 'b', tasks: [
    { id: 'T1', title: 'First', requirements: ['R1'], depends_on: [], status: 'blocked', attempts: 3, max_attempts: 3, branch: null, evidence: null, escalation: 'blocked after 3 attempts. Last verdict fail: R1 fail' },
  ] }, 'tasks');
  fl.ensureDecision(root, 'b', 'unblock', 'Task T1 is blocked', ['retry with guidance', 'take over manually', 'kill task'], { task: 'T1' });
  let html = renderBet(root, 'b');
  assert.ok(html.includes('Unblock T1'));
  assert.ok(html.includes('blocked after 3 attempts'));
  assert.match(html, /<td>T1<\/td>\s*<td>First<\/td>\s*<td>blocked<\/td>\s*<td>3 \/ 3<\/td>/);
  st.writeJsonAtomic(st.tasksPath(root, 'b'), { bet: 'b', tasks: [
    { id: 'T1', title: 'First', requirements: ['R1'], depends_on: [], status: 'passed', attempts: 1, max_attempts: 3, branch: null, evidence: null, escalation: null },
  ] }, 'tasks');
  fl.writeAcceptance(root, 'b', { body: '## Residual uncertainty\n- No load test.\n', residual: ['No load test.'], cost: {} });
  html = renderBet(root, 'b');
  assert.ok(html.includes('Accept'));
  assert.ok(html.includes('No load test.'));
  assert.match(html, /value="approve with conditions"/);
  const ro = renderBet(root, 'b', { readonly: true });
  assert.ok(ro.includes('bridgie accept b --approve'));
  assert.ok(!ro.includes('<form'));
});

test('bet page, inbox, and public page render usage / cost card and per-seat breakdown safely', () => {
  const root = shapedProject();
  const before = renderBet(root, 'b');
  assert.ok(before.includes('no runs yet'));
  assert.ok(!before.includes('<h2>Cost and token usage</h2>'), 'no cost table before the first run');

  st.writeJsonAtomic(st.tasksPath(root, 'b'), { bet: 'b', tasks: [
    { id: 'T1', title: 'First', requirements: ['R1'], depends_on: [], status: 'passed', attempts: 1, max_attempts: 3, branch: null, evidence: null, escalation: null },
  ] }, 'tasks');
  const r1 = join(root, '.bridgie', 'runs', 'b', 'implementer-01');
  mkdirSync(r1, { recursive: true });
  st.costAdd(r1, { seat: 'implementer', task: 'T1', adapter: 'copilot', model: 'claude-sonnet-4.6', started_at: '2026-11-27T10:00:00Z', duration_s: 90, attempt: 1, exit_code: 0, tokens_in: 5000, tokens_out: 1000, tokens_cache_read: 14000, tokens_total: 20000, usd: 0.25 });

  const betHtml = renderBet(root, 'b');
  assert.ok(betHtml.includes('usage / cost'));
  assert.ok(betHtml.includes('1 run · 2m · 20k tokens · $0.25'));
  assert.ok(betHtml.includes('<h2>Cost and token usage</h2>'));
  assert.ok(betHtml.includes('Per-seat run breakdown (1 run)'));

  const inboxHtml = renderInbox(root);
  assert.ok(inboxHtml.includes('1 run · 2m · 20k tokens · $0.25'));

  const pubOut = renderAll(root, join(root, 'pub-cost'), { public: true, bets: ['b'] });
  const pubBet = readFileSync(join(pubOut, 'bet-b.html'), 'utf8');
  assert.ok(!pubBet.includes(root), 'public page must leak no local paths');
  assert.ok(pubBet.includes('<h2>Cost and token usage</h2>'));
});
