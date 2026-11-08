// Simulated buyer panel: the runner deals persona cards from the owner's customer profile, one
// fresh agent plays each buyer, and the runner checks and tallies the answers. Nothing here ever
// answers for a buyer, and a tally is a reading of simulated opinions, never evidence.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as yparse } from './yaml.mjs';
import * as st from './state.mjs';
import { validate } from './schema.mjs';

export const REASON_CODES = ['price', 'trust', 'habit', 'need', 'access', 'other'];
const NAMES = ['Alex', 'Sam', 'Jordan', 'Priya', 'Chen', 'Fatima', 'Luca', 'Nia', 'Tom', 'Grace', 'Omar', 'Ingrid', 'Kofi', 'Maya', 'Ravi', 'Zoe', 'Hugo', 'Leila', 'Ben', 'Sofia'];

// mulberry32: small seeded PRNG so the same seed always deals the same cards.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, items) => { let x = r(); for (const it of items) { if (x < it.share) return it; x -= it.share; } return items[items.length - 1]; };

export function loadCustomer(file) {
  const c = yparse(readFileSync(file, 'utf8'));
  const errs = validate(st.loadSchema('customer'), c);
  if (errs.length) throw new Error(`${file}: ${errs.join('; ')}`);
  for (const k of ['segments', 'behaviours']) {
    const sum = c[k].reduce((n, x) => n + x.share, 0);
    if (Math.abs(sum - 1) > 0.01) throw new Error(`${file}: ${k} shares sum to ${sum.toFixed(2)}, not 1`);
  }
  return c;
}

// deal: n persona cards from the customer profile. Deterministic for a seed.
export function deal(customer, n, seed = 1) {
  const r = rng(seed);
  const cards = [];
  for (let i = 0; i < n; i++) {
    const seg = pick(r, customer.segments), beh = pick(r, customer.behaviours);
    const [lo, hi] = seg.income;
    cards.push({
      id: `B${String(i + 1).padStart(2, '0')}`,
      name: NAMES[Math.floor(r() * NAMES.length)],
      age: 22 + Math.floor(r() * 43),
      segment: seg.name, income: Math.round((lo + r() * (hi - lo)) / 100) * 100,
      behaviour: beh.name, how: beh.how,
      habit: customer.habits?.length ? customer.habits[Math.floor(r() * customer.habits.length)] : null,
      objection: customer.objections[i % customer.objections.length],
    });
  }
  return { seed, n, business: customer.business, target: customer.target, cards };
}

// checkAnswer: schema plus the one rule a schema cannot say: the four prices must rise.
export function checkAnswer(a) {
  const errs = validate(st.loadSchema('buyer-answer'), a);
  if (errs.length) return errs;
  const p = a.prices;
  if (!(p.too_cheap < p.bargain && p.bargain < p.getting_expensive && p.getting_expensive < p.too_expensive)) return ['prices must rise: too_cheap < bargain < getting_expensive < too_expensive'];
  return [];
}

// collectAnswers: read every buyer run's answer; return { answers, excluded } with reasons.
export function collectAnswers(cards, buyersDir) {
  const answers = [], excluded = [];
  for (const c of cards) {
    const f = join(buyersDir, c.id, 'buyer-answer.json');
    if (!existsSync(f)) { excluded.push({ id: c.id, why: 'no answer' }); continue; }
    let a; try { a = st.readJson(f); } catch (e) { excluded.push({ id: c.id, why: `invalid json: ${e.message}` }); continue; }
    const errs = checkAnswer(a);
    if (errs.length) { excluded.push({ id: c.id, why: errs.join('; ') }); continue; }
    if (a.card !== c.id) { excluded.push({ id: c.id, why: `answer names card ${a.card}` }); continue; }
    answers.push({ ...a, segment: c.segment, behaviour: c.behaviour });
  }
  return { answers, excluded };
}

const rate = (xs, f) => (xs.length ? Math.round(xs.filter(f).length / xs.length * 1000) / 1000 : null);
const groups = (answers, key) => {
  const by = {};
  for (const a of answers) (by[a[key]] ||= []).push(a);
  return Object.entries(by).map(([name, xs]) => ({ name, n: xs.length, buy_rate: rate(xs, x => x.buys) })).sort((a, b) => b.buy_rate - a.buy_rate);
};
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

export function tally(cards, answers, excluded = []) {
  const buyers = answers.filter(a => a.buys), passers = answers.filter(a => !a.buys);
  const reasons = REASON_CODES.map(code => {
    const xs = passers.filter(a => a.reason_code === code);
    return xs.length ? { code, count: xs.length, quote: xs[0].reason, card: xs[0].card } : null;
  }).filter(Boolean).sort((a, b) => b.count - a.count);
  const flipCounts = {};
  for (const a of passers) { const k = norm(a.would_flip); if (k) (flipCounts[k] ||= { text: a.would_flip, count: 0 }).count++; }
  const flips = Object.values(flipCounts).sort((a, b) => b.count - a.count).slice(0, 5);
  const objCounts = {};
  for (const a of answers) { const k = norm(a.objection); if (k) (objCounts[k] ||= { text: a.objection, count: 0 }).count++; }
  return {
    n: cards.length, answered: answers.length, excluded,
    buy: buyers.length, pass: passers.length, buy_rate: rate(answers, a => a.buys),
    purchases_first_month: buyers.reduce((n, a) => n + a.purchases_first_month, 0),
    by_segment: groups(answers, 'segment'), by_behaviour: groups(answers, 'behaviour'),
    reasons, flips, objections: Object.values(objCounts).sort((a, b) => b.count - a.count).slice(0, 5),
    price_range: priceRange(answers),
  };
}

// priceRange: Van Westendorp price-sensitivity points from the four answers per buyer.
// Cumulative shares at price p: tooCheap(p) = share with too_cheap >= p (falls as p rises),
// bargain(p) = share with bargain >= p, expensive(p) = share with getting_expensive <= p (rises),
// tooExpensive(p) = share with too_expensive <= p. Crossings by linear interpolation:
//   OPP = tooCheap ∩ tooExpensive, IPP = bargain ∩ expensive, PMC = tooCheap ∩ (1 − bargain), PME = tooExpensive ∩ (1 − expensive).
export function priceRange(answers) {
  const ps = answers.map(a => a.prices).filter(Boolean);
  if (ps.length < 3) return null;
  const n = ps.length;
  const tooCheap = p => ps.filter(x => x.too_cheap >= p).length / n;
  const bargain = p => ps.filter(x => x.bargain >= p).length / n;
  const expensive = p => ps.filter(x => x.getting_expensive <= p).length / n;
  const tooExpensive = p => ps.filter(x => x.too_expensive <= p).length / n;
  const grid = [...new Set(ps.flatMap(x => [x.too_cheap, x.bargain, x.getting_expensive, x.too_expensive]))].sort((a, b) => a - b);
  const cross = (f, g) => {   // first price where f − g changes sign; interpolate between grid points
    let prev = null;
    for (const p of grid) {
      const d = f(p) - g(p);
      if (prev && Math.sign(prev.d) !== Math.sign(d)) {
        if (d === prev.d) return p;
        return Math.round((prev.p + (p - prev.p) * (prev.d / (prev.d - d))) * 100) / 100;
      }
      if (d === 0) return p;
      prev = { p, d };
    }
    return null;
  };
  const r = { pmc: cross(tooCheap, p => 1 - bargain(p)), opp: cross(tooCheap, tooExpensive), ipp: cross(bargain, expensive), pme: cross(tooExpensive, p => 1 - expensive(p)) };
  r.acceptable = r.pmc !== null && r.pme !== null ? [r.pmc, r.pme] : null;
  return r;
}

export function renderPanel(slug, t, meta) {
  const pct = x => (x === null ? '—' : `${Math.round(x * 100)}%`);
  const L = [`# Panel — ${slug}`, '', `${t.n} simulated buyers dealt from \`customer.yaml\` (seed ${meta.seed}); ${t.answered} answered, ${t.excluded.length} excluded. ${st.today()}.`, '',
    `## Headline`, '', `**${t.buy} buy · ${t.pass} pass** — buy rate ${pct(t.buy_rate)}; ${t.purchases_first_month} purchases in the first month across the buyers.`, '',
    '## By segment', '', '| Segment | n | Buy rate |', '|---|---|---|', ...t.by_segment.map(g => `| ${g.name} | ${g.n} | ${pct(g.buy_rate)} |`), '',
    '## By behaviour', '', '| Behaviour | n | Buy rate |', '|---|---|---|', ...t.by_behaviour.map(g => `| ${g.name} | ${g.n} | ${pct(g.buy_rate)} |`), '',
    '## Why they pass', '', ...(t.reasons.length ? t.reasons.map(r => `- ${r.code} (${r.count}): "${r.quote}" (${r.card})`) : ['- nobody passed']), '',
    '## What would flip a no', '', ...(t.flips.length ? t.flips.map(f => `- ${f.text} (${f.count})`) : ['- —']), '',
    '## Most common objection', '', ...(t.objections.length ? t.objections.map(o => `- ${o.text} (${o.count})`) : ['- —']), ''];
  if (t.price_range) {
    const p = t.price_range, f = x => (x === null ? '—' : String(x));
    L.push('## Price range (Van Westendorp)', '', `| Point of marginal cheapness | Optimal | Indifference | Point of marginal expensiveness |`, '|---|---|---|---|', `| ${f(p.pmc)} | ${f(p.opp)} | ${f(p.ipp)} | ${f(p.pme)} |`, '',
      p.acceptable ? `Acceptable range ${p.acceptable[0]}–${p.acceptable[1]}.` : 'The curves did not all cross; the range is undefined for this panel.', '');
  }
  if (t.excluded.length) L.push('## Excluded buyers', '', ...t.excluded.map(e => `- ${e.id}: ${e.why}`), '');
  L.push('## Limits', '', 'These are simulated buyers, not customers. The panel is good at surfacing objections, segments and wording, and bad at predicting conversion: language models lean agreeable, so read the buy rate as an upper bound. It changes nothing about this bet\'s confidence. Confirm the big calls with real people before signing; the evidence task below is that test. Never present panel quotes as testimonials.', '');
  return L.join('\n');
}

// writePanel: panel.md + panel.json beside the bet, and one evidence task on the bet asking for real buyers.
export function writePanel(root, slug, cardsFile, buyersDir) {
  const dealt = st.readJson(cardsFile);
  const { answers, excluded } = collectAnswers(dealt.cards, buyersDir);
  if (!answers.length) throw new Error('no valid buyer answers; the panel has nothing to tally');
  const t = tally(dealt.cards, answers, excluded);
  const dir = join(root, '.bridgie', 'bets', slug);
  writeFileSync(join(dir, 'panel.json'), JSON.stringify({ bet: slug, date: st.today(), seed: dealt.seed, ...t }, null, 2) + '\n');
  writeFileSync(join(dir, 'panel.md'), renderPanel(slug, t, dealt));
  const file = st.betPath(root, slug);
  const { data, body } = st.readFm(file);
  const line = `- [ ] E-panel: confirm the panel's top reason to pass ("${t.reasons[0]?.quote || 'none'}") and the price range with at least 5 real buyers (interviews or a priced landing page)`;
  if (!body.includes('E-panel:')) st.writeFm(file, data, st.appendToSection(body, 'Evidence tasks', line), 'bet');
  return t;
}

function flag(a, n) { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; }
const out = x => process.stdout.write((typeof x === 'string' ? x : JSON.stringify(x, null, 2)) + '\n');
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [op, ...a] = process.argv.slice(2);
  try {
    if (op === 'deal') { const d = deal(loadCustomer(a[0]), Number(flag(a, 'n') || 20), Number(flag(a, 'seed') || 1)); mkdirSync(resolve(a[1], '..'), { recursive: true }); writeFileSync(a[1], JSON.stringify(d, null, 2) + '\n'); out(d.cards.map(c => c.id).join(' ')); }
    else if (op === 'check') out(checkAnswer(st.readJson(a[0])).join('; ') || 'ok');
    else if (op === 'write') { const t = writePanel(a[0], a[1], a[2], a[3]); out({ buy_rate: t.buy_rate, answered: t.answered, excluded: t.excluded.length }); }
    else throw new Error(`unknown op "${op}"`);
  } catch (e) { console.error(`panel.mjs: ${e.message}`); process.exit(1); }
}
