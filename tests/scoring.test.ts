import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreEvidence } from '../lib/scoring.js';
import { planOrders } from '../lib/rules.js';
import { evidence, testScores } from './evidence-fixture.js';
const now = new Date('2026-11-10T15:00:00Z');
test('60/40 rubric uses documented behaviour and four independent checks', () => {
  assert.equal(scoreEvidence(evidence, now).total, 100);
  const e = structuredClone(evidence);
  e.institutional.holdingChangePct = 0;
  e.financial.revenueGrowthPct = -2;
  assert.equal(scoreEvidence(e, now).total, 60); // .6*50 + .4*75
});
test('missing, future, expired and unqualified investor evidence fails closed', () => {
  assert.equal(scoreEvidence(undefined, now).total, null);
  for (const mutate of [
    (e: typeof evidence) => { e.publishedAt = '2026-11-11'; },
    (e: typeof evidence) => { e.capturedAt = '2026-11-11'; },
    (e: typeof evidence) => { e.expiresAt = '2026-11-09'; },
    (e: typeof evidence) => { e.institutional.years = 2; },
    (e: typeof evidence) => { e.institutional.annualReturn = 7; },
    (e: typeof evidence) => { e.financial.sourceUrl = ''; },
  ]) {
    const e = structuredClone(evidence); mutate(e);
    assert.equal(scoreEvidence(e, now).complete, false);
  }
});
test('incomplete model preserves holdings and cash instead of falling back to equal weights', () => {
  const input = { symbols: ['LMT','RTX'], cash: 4000, shares: { LMT: 1 }, costBasis: { LMT: 800 },
    valuationPrices: { LMT: 800, RTX: 100 }, tradeable: { LMT: { priceAud: 800 }, RTX: { priceAud: 100 } } };
  const plan = planOrders(input);
  assert.equal(plan.orders.length, 0);
  assert.equal(plan.cash, 4000);
  assert.deepEqual(plan.costBasis, input.costBasis);
  assert.ok(plan.decisions.every(d => d.decision === 'HOLD' && d.reason.includes('Incomplete')));
});
test('profit exits require evidence; stops remain independent and never repurchase in the same cycle', () => {
  for (const price of [920, 736]) {
    const input = { symbols: ['LMT'], cash: 4000, shares: { LMT: 1 }, costBasis: { LMT: 800 },
      valuationPrices: { LMT: price }, tradeable: { LMT: { priceAud: price } } };
    assert.equal(planOrders(input).orders.length, price <= 736 ? 1 : 0);
    const plan = planOrders({ ...input, scores: testScores });
    assert.equal(plan.orders.length, 1);
    assert.equal(plan.orders[0].side, 'SELL');
  }
});

test('all five protective stops exit independently of an investor failing its sector benchmark', () => {
  // Synthetic positions and prices; the performance comparison follows the verification finding.
  const symbols = ['LMT', 'RTX', 'GD', 'NOC', 'BAE'];
  const rejected = structuredClone(evidence);
  rejected.institutional.annualReturn = 15.70;
  rejected.institutional.benchmarkReturn = 17.11;
  const score = scoreEvidence(rejected, now);
  assert.equal(score.complete, false);
  const input = { symbols, cash: 4000,
    shares: Object.fromEntries(symbols.map(s => [s, 1])),
    costBasis: Object.fromEntries(symbols.map(s => [s, 100])),
    valuationPrices: Object.fromEntries(symbols.map(s => [s, 92])),
    tradeable: Object.fromEntries(symbols.map(s => [s, { priceAud: 92 }])),
    scores: Object.fromEntries(symbols.map(s => [s, score])) };
  const plan = planOrders(input);
  assert.equal(plan.orders.length, 5);
  assert.ok(plan.orders.every(o => o.side === 'SELL' && /Risk stop/.test(o.rule)));
  assert.ok(symbols.every(s => plan.shares[s] === 0));
  assert.equal(plan.cash, 4460);
  const recovered = planOrders({ ...input, valuationPrices: Object.fromEntries(symbols.map(s => [s, 100])),
    tradeable: Object.fromEntries(symbols.map(s => [s, { priceAud: 100 }])) });
  assert.equal(recovered.orders.length, 0);
  assert.ok(recovered.decisions.every(d => d.decision === 'HOLD' && !d.buyEligible));
});
