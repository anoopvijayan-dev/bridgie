import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as p from './panel.mjs';

const customer = {
  business: 'Pack builder', target: 'UK commercial finance broker, 2–5 staff',
  segments: [{ name: 'solo', share: 0.5, income: [40000, 60000] }, { name: 'small firm', share: 0.5, income: [60000, 120000] }],
  behaviours: [{ name: 'deadline buyer', share: 0.7, how: 'buys when a deal is stuck' }, { name: 'tool sceptic', share: 0.3, how: 'has been burned by software before' }],
  objections: ['lenders will not accept it', 'my junior is cheaper'],
};
const ans = (card, buys, prices, extra = {}) => ({ card, buys, purchases_first_month: buys ? 1 : 0, reason_code: buys ? 'need' : 'price', reason: buys ? 'saves my Tuesday' : 'too dear per deal', objection: 'lenders', would_flip: 'a lender logo', prices, ...extra });

test('deal is deterministic for a seed and follows the shares', () => {
  const a = p.deal(customer, 200, 7), b = p.deal(customer, 200, 7);
  assert.deepEqual(a.cards, b.cards);
  assert.notDeepEqual(p.deal(customer, 200, 8).cards[0], a.cards[0]);
  const solo = a.cards.filter(c => c.segment === 'solo').length / 200;
  assert.ok(Math.abs(solo - 0.5) < 0.1, `solo share ${solo}`);
  const deadline = a.cards.filter(c => c.behaviour === 'deadline buyer').length / 200;
  assert.ok(Math.abs(deadline - 0.7) < 0.1, `deadline share ${deadline}`);
  assert.ok(a.cards.every(c => c.income >= 40000 && c.income <= 120000 && c.age >= 22 && c.age <= 64));
  assert.equal(a.cards[0].id, 'B01'); assert.equal(a.cards[199].id, 'B200');
});

test('checkAnswer rejects bad shapes and non-rising prices', () => {
  assert.deepEqual(p.checkAnswer(ans('B01', true, { too_cheap: 10, bargain: 20, getting_expensive: 40, too_expensive: 80 })), []);
  assert.ok(p.checkAnswer(ans('B01', true, { too_cheap: 10, bargain: 40, getting_expensive: 40, too_expensive: 80 })).join().includes('must rise'));
  assert.ok(p.checkAnswer(ans('B01', true, { too_cheap: 10, bargain: 20, getting_expensive: 40, too_expensive: 80 }, { reason_code: 'vibes' })).length > 0);
});

test('tally counts buyers, segments, reasons with one quote, and flips', () => {
  const cards = [{ id: 'B01', segment: 'solo', behaviour: 'x' }, { id: 'B02', segment: 'solo', behaviour: 'x' }, { id: 'B03', segment: 'small firm', behaviour: 'y' }];
  const answers = [
    { ...ans('B01', true, {}), segment: 'solo', behaviour: 'x' },
    { ...ans('B02', false, {}), segment: 'solo', behaviour: 'x' },
    { ...ans('B03', false, {}), segment: 'small firm', behaviour: 'y', reason_code: 'trust', reason: 'never heard of you' },
  ];
  const t = p.tally(cards, answers, [{ id: 'B04', why: 'no answer' }]);
  assert.equal(t.buy, 1); assert.equal(t.pass, 2); assert.equal(t.buy_rate, 0.333);
  assert.equal(t.by_segment.find(g => g.name === 'solo').buy_rate, 0.5);
  assert.deepEqual(t.reasons.map(r => r.code), ['price', 'trust']);
  assert.equal(t.reasons[1].quote, 'never heard of you');
  assert.equal(t.flips[0].count, 2);
  assert.equal(t.excluded.length, 1);
});

test('priceRange: hand-checked Van Westendorp on five buyers', () => {
  // five buyers with the same four answers scaled: crossings land where the curves meet
  const prices = [[10, 20, 40, 80], [12, 22, 42, 82], [14, 24, 44, 84], [16, 26, 46, 86], [18, 28, 48, 88]]
    .map(([a, b, c, d]) => ({ prices: { too_cheap: a, bargain: b, getting_expensive: c, too_expensive: d } }));
  const r = p.priceRange(prices);
  // tooCheap(p) falls from 1 (p ≤ 10) to 0 (p > 18); tooExpensive rises from 0 to 1 over 80–88: OPP is between, where both are 0 → first grid point with sign change
  assert.ok(r.opp > 18 && r.opp <= 80, `opp ${r.opp}`);
  // bargain falls 1→0 over 20–28, expensive rises over 40–48: IPP between 28 and 40
  assert.ok(r.ipp > 28 && r.ipp <= 40, `ipp ${r.ipp}`);
  // PMC: tooCheap vs 1 − bargain: tooCheap=0.6 at 14 (>=14: 14,16,18), 1−bargain(14)=0 → crosses when tooCheap falls below 1−bargain, around 18–20
  assert.ok(r.pmc >= 16 && r.pmc <= 20, `pmc ${r.pmc}`);
  assert.ok(r.pme >= 46 && r.pme <= 82, `pme ${r.pme}`);
  assert.deepEqual(r.acceptable, [r.pmc, r.pme]);
  assert.equal(p.priceRange(prices.slice(0, 2)), null);
});
