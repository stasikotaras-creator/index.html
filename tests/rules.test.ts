import { testScores } from "./evidence-fixture.js";
// Isolated paper-order tests for the REVEL TradeGuard risk rules.
// Uses TEST DATA ONLY: the prices below are synthetic round numbers chosen to exercise the rules.
// They are not market prices and are never written anywhere. No database or network access.
// Run with: node --test tests/rules.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planOrders, MAX_ALLOCATION, MIN_CASH_RESERVE, BUY_HALT_EQUITY, START_CAPITAL, type PlanInput,
} from "../lib/rules.ts";

const SYMBOLS = ["LMT", "RTX", "GD", "NOC", "BAE"] as const;
const TEST_PRICE = { LMT: 800, RTX: 250, GD: 500, NOC: 750, BAE: 150 }; // synthetic test values

const open = (prices: Record<string, number>) =>
  Object.fromEntries(Object.entries(prices).map(([s, p]) => [s, { priceAud: p }]));

function scenario(over: Partial<PlanInput>): PlanInput {
  return {
    scores: testScores, symbols: SYMBOLS, cash: START_CAPITAL, shares: {}, valuationPrices: TEST_PRICE,
    tradeable: open(TEST_PRICE), ...over,
  };
}

function checkLimits(input: PlanInput, r: ReturnType<typeof planOrders>) {
  const prices = input.valuationPrices as Record<string, number>;
  const eq = r.cash + SYMBOLS.reduce((s, k) => s + (r.shares[k] ?? 0) * prices[k], 0);
  for (const k of SYMBOLS) {
    const alloc = ((r.shares[k] ?? 0) * prices[k]) / eq;
    assert.ok(alloc <= MAX_ALLOCATION + 1e-9, `${k} allocation ${(alloc * 100).toFixed(3)}% exceeds 20%`);
  }
  assert.ok(r.cash / eq >= MIN_CASH_RESERVE - 1e-9, `cash ${(r.cash / eq * 100).toFixed(3)}% below 30%`);
  assert.ok(r.cash >= 0, "cash went negative");
  return eq;
}

test("fresh A$5,000 test account buys to 14% per stock and keeps >= 30% cash", () => {
  const input = scenario({});
  const r = planOrders(input);
  assert.equal(r.orders.length, 5);
  assert.ok(r.orders.every((o) => o.side === "BUY"));
  const eq = checkLimits(input, r);
  assert.ok(Math.abs(eq - START_CAPITAL) < 0.05, "valuation should be unchanged by buys at the same price");
  assert.ok(r.cash >= START_CAPITAL * MIN_CASH_RESERVE);
});

test("20% maximum allocation: an oversized position is trimmed", () => {
  // TEST DATA: 2 LMT at A$800 = A$1,600 of A$5,000 equity (32%).
  const input = scenario({ cash: 3400, shares: { LMT: 2 } });
  const r = planOrders(input);
  const sell = r.orders.find((o) => o.symbol === "LMT" && o.side === "SELL");
  assert.ok(sell, "expected a trim of LMT");
  checkLimits(input, r);
});

test("20% maximum allocation: a buy never takes a stock above 20%", () => {
  // TEST DATA: LMT already at 19.2%; target is 14%, so no buy should be placed.
  const input = scenario({ cash: 4040, shares: { LMT: 1.2 } });
  const r = planOrders(input);
  assert.ok(!r.orders.some((o) => o.symbol === "LMT" && o.side === "BUY"));
  checkLimits(input, r);
});

test("30% minimum cash reserve: buys stop when cash would fall below 30%", () => {
  // TEST DATA: cash is ~31.3% of A$5,275 equity; GD, NOC and BAE are below the 14% target.
  const input = scenario({
    cash: 1650,
    shares: { LMT: 1.0, RTX: 3.4, GD: 1.4, NOC: 0.9, BAE: 4.0 }, // A$3,625 invested
  });
  const r = planOrders(input);
  checkLimits(input, r);
  assert.ok(r.notes.some((n) => n.includes("30% cash reserve")), "expected a cash-reserve block note");
});

test("30% minimum cash reserve: cash already below 30% blocks every buy", () => {
  // TEST DATA: cash A$1,000 of A$4,750 equity (21%).
  const input = scenario({ cash: 1000, shares: { LMT: 1.5, RTX: 4, GD: 2, NOC: 1, BAE: 2 } });
  const r = planOrders(input);
  assert.ok(!r.orders.some((o) => o.side === "BUY"));
});

test("A$2,500 emergency halt: no buys at equity exactly A$2,500", () => {
  const input = scenario({ cash: 2500 });
  const r = planOrders(input);
  assert.equal(r.orders.length, 0);
  assert.equal(r.buysHalted, true);
  assert.ok(r.notes.some((n) => n.startsWith("BUYS HALTED")));
});

test("A$2,500 emergency halt: no buys below A$2,500, but trims above 20% still run", () => {
  // TEST DATA: equity A$2,400 with RTX at ~41.7%.
  const input = scenario({ cash: 1400, shares: { RTX: 4 } });
  const r = planOrders(input);
  assert.equal(r.buysHalted, true);
  assert.ok(!r.orders.some((o) => o.side === "BUY"), "no buys while halted");
  assert.ok(r.orders.some((o) => o.symbol === "RTX" && o.side === "SELL"), "trim still allowed");
  assert.ok(r.equity! <= BUY_HALT_EQUITY);
});

test("halt boundary: equity just above A$2,500 may still buy", () => {
  const input = scenario({ cash: 2600 });
  const r = planOrders(input);
  assert.equal(r.buysHalted, false);
  assert.ok(r.orders.some((o) => o.side === "BUY"));
  checkLimits(input, r);
});

test("market closed or stale quotes: no simulated orders", () => {
  const blocked = Object.fromEntries(SYMBOLS.map((s) => [s, { blocked: `${s}: market closed, no simulated trade.` }]));
  const r = planOrders(scenario({ tradeable: blocked }));
  assert.equal(r.orders.length, 0);
  assert.equal(r.notes.length, 5);
});

test("missing price for a held stock: trading is skipped entirely", () => {
  const r = planOrders(scenario({
    cash: 4000, shares: { NOC: 1 }, valuationPrices: { ...TEST_PRICE, NOC: undefined },
    tradeable: open({ LMT: 800 }),
  }));
  assert.equal(r.skipped, true);
  assert.equal(r.orders.length, 0);
});

test("repeated cycles at constant test prices stay within all limits", () => {
  let state = scenario({});
  for (let i = 0; i < 10; i++) {
    const r = planOrders(state);
    checkLimits(state, r);
    if (i > 0) assert.equal(r.orders.length, 0, "a balanced portfolio should not churn");
    state = { ...state, cash: r.cash, shares: r.shares, costBasis: r.costBasis };
  }
});
