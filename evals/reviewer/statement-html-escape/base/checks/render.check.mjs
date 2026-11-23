import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHeader } from '../src/render.mjs';

test('the customer name is shown as text', () => {
  assert.equal(renderHeader({ name: 'A & B <Ltd>' }), '<h1>Statement for A &amp; B &lt;Ltd&gt;</h1>');
});
