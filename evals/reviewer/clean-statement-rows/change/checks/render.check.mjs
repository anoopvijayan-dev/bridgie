import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHeader, renderRows } from '../src/render.mjs';

test('the customer name is shown as text', () => {
  assert.equal(renderHeader({ name: 'A & B <Ltd>' }), '<h1>Statement for A &amp; B &lt;Ltd&gt;</h1>');
});

test('one row per line, amount in pounds', () => {
  const html = renderRows([{ date: '2026-03-01', description: 'CARD PAYMENT', counterparty: 'Acme Ltd', amount_pence: 1250 }]);
  assert.equal(html, '<tr><td>2026-03-01</td><td>CARD PAYMENT</td><td>Acme Ltd</td><td>12.50</td></tr>');
});

test('a description with markup is shown as text', () => {
  const html = renderRows([{ date: '2026-03-01', description: '<b>REF</b>', counterparty: 'Acme', amount_pence: 100 }]);
  assert.ok(html.includes('&lt;b&gt;REF&lt;/b&gt;'));
});
test('a counterparty name with markup is shown as text', () => {
  const html = renderRows([{ date: '2026-03-01', description: 'X', counterparty: '<img src=x onerror=alert(1)>', amount_pence: 100 }]);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});
