// Isolated END-TO-END test of the autonomous paper-trading cycle.
// Runs the real runCycle() path (lock, throttle, provider parsing, FX conversion, risk rules, simulated
// fills, ledger) against a throwaway in-memory Postgres (PGlite) built from this repo's migrations.
// The market-data provider is replaced by a stub that returns synthetic TEST DATA in the provider's
// response format. It never touches the Netlify production or preview database, never calls the real
// provider, and never sends any order anywhere (there is no broker integration at all).
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import {
  runCycle, START_CAPITAL, STOCKS, MAX_ALLOCATION, MIN_CASH_RESERVE, applyMarketData,
} from "../lib/simulation.js";

const { account, positions, trades, priceSnapshots, equitySnapshots, fetchRuns } = schema;
const TEST_SOURCE = "TEST DATA - isolated e2e";
const BASE_USD: Record<string, number> = { LMT: 500, RTX: 150, GD: 300, NOC: 450, BAESY: 90 }; // synthetic
const FX = 1.5; // synthetic USD/AUD

async function freshDb() {
  const pg = new PGlite();
  const dir = "netlify/database/migrations";
  for (const m of readdirSync(dir).sort()) {
    const sqlText = readFileSync(`${dir}/${m}/migration.sql`, "utf8");
    for (const stmt of sqlText.split("--> statement-breakpoint")) if (stmt.trim()) await pg.exec(stmt);
  }
  return drizzle({ client: pg, schema });
}

type Market = { quoteTime: Date; open?: boolean; scale?: number; fail?: boolean };

// Stub of the provider's HTTP API. Counts calls so tests can confirm throttling.
function stubProvider(market: () => Market) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(String(url));
    const m = market();
    if (m.fail) return new Response(JSON.stringify({ status: "error", message: "test outage" }), { status: 500 });
    const ts = Math.floor(m.quoteTime.getTime() / 1000);
    if (String(url).includes("/quote")) {
      const body: Record<string, unknown> = {};
      for (const [sym, px] of Object.entries(BASE_USD)) {
        body[sym] = { symbol: sym, exchange: "TEST", currency: "USD", close: String(px * (m.scale ?? 1)),
          is_market_open: m.open ?? true, timestamp: ts, last_quote_at: ts };
      }
      return Response.json(body);
    }
    return Response.json({ symbol: "USD/AUD", rate: FX, timestamp: ts });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const deps = (db: any, fetchImpl: typeof fetch, now: Date) =>
  ({ conn: db, fetchImpl, apiKey: "test-key", now: () => now, source: TEST_SOURCE });

const min = (n: number) => n * 60000;

async function assertLimits(db: any) {
  const [acct] = await db.select().from(account);
  const pos = await db.select().from(positions);
  const [last] = await db.select().from(equitySnapshots).orderBy(equitySnapshots.id).limit(1000).then((r: any[]) => r.slice(-1));
  const prices = await db.select().from(priceSnapshots);
  const latest: Record<string, number> = {};
  for (const p of prices) latest[p.symbol] = p.priceAud; // ordered by insert
  for (const p of pos) assert.ok((p.shares * latest[p.symbol]) / last.equity <= MAX_ALLOCATION + 1e-9, `${p.symbol} > 20%`);
  assert.ok(acct.cash / last.equity >= MIN_CASH_RESERVE - 1e-9, "cash < 30%");
  assert.ok(acct.cash >= 0);
}

test("e2e: first autonomous cycle initialises A$5,000 and records simulated buys", async () => {
  const db = await freshDb();
  const t0 = new Date("2026-11-09T15:00:00Z");
  const p = stubProvider(() => ({ quoteTime: t0 }));
  const res = await runCycle("test", deps(db, p.fetchImpl, t0));
  assert.equal(res.ran, true);
  assert.equal(res.status, "ok");

  const [acct] = await db.select().from(account);
  const tr = await db.select().from(trades);
  const snaps = await db.select().from(priceSnapshots);
  assert.equal(acct.startingCapital, START_CAPITAL);
  assert.equal(tr.length, STOCKS.length, "one buy per stock");
  assert.ok(tr.every((t) => t.side === "BUY" && t.runId === res.runId && t.snapshotId));
  assert.ok(snaps.every((s) => s.source === TEST_SOURCE), "test prices labelled as test data");
  // Each trade is priced exactly from its recorded snapshot (no invented prices).
  for (const t of tr) {
    const s = snaps.find((x) => x.id === t.snapshotId)!;
    assert.equal(t.priceAud, s.priceAud);
    assert.equal(t.priceAud, BASE_USD[s.providerSymbol] * FX);
    assert.ok(Math.abs(t.valueAud - t.shares * t.priceAud) < 0.01);
  }
  // Ledger reconciles: start cash minus buys equals account cash and the last trade's cash_after.
  const spent = tr.reduce((a, t) => a + t.valueAud, 0);
  assert.ok(Math.abs(START_CAPITAL - spent - acct.cash) < 0.01);
  assert.ok(Math.abs(tr.at(-1)!.cashAfter - acct.cash) < 0.005);
  await assertLimits(db);
});

test("e2e: repeated and concurrent triggers never create duplicate orders", async () => {
  const db = await freshDb();
  const t0 = new Date("2026-11-09T15:00:00Z");
  const p = stubProvider(() => ({ quoteTime: t0 }));
  // Schedule, dashboard and manual triggers fire at the same moment.
  const results = await Promise.all([
    runCycle("schedule", deps(db, p.fetchImpl, t0)),
    runCycle("dashboard", deps(db, p.fetchImpl, t0)),
    runCycle("manual", deps(db, p.fetchImpl, t0)),
  ]);
  assert.equal(results.filter((r) => r.ran).length, 1, "exactly one cycle ran");
  // Immediate retry is throttled.
  const again = await runCycle("dashboard", deps(db, p.fetchImpl, new Date(t0.getTime() + min(2))));
  assert.equal(again.ran, false);
  assert.equal((await db.select().from(fetchRuns)).length, 1);
  assert.equal((await db.select().from(trades)).length, STOCKS.length);
  assert.equal(p.calls.length, 2, "provider called once for quotes and once for FX");
});

test("e2e: a quote that already filled an order is never traded twice", async () => {
  const db = await freshDb();
  const t0 = new Date("2026-11-09T15:00:00Z");
  let quoteTime = t0;
  const p = stubProvider(() => ({ quoteTime }));
  await runCycle("schedule", deps(db, p.fetchImpl, t0));
  // Make the engine want to buy more (test-only cash adjustment), but the provider returns the SAME quote.
  const [acct] = await db.select().from(account);
  await db.update(account).set({ cash: acct.cash + 1000 }).where(eq(account.id, 1));
  const r2 = await runCycle("schedule", deps(db, p.fetchImpl, new Date(t0.getTime() + min(15))));
  assert.equal(r2.ran, true);
  assert.equal((await db.select().from(trades).where(eq(trades.runId, r2.runId!))).length, 0);
  assert.ok(r2.notes!.some((n) => n.includes("quote already used")));
  // A genuinely new quote may trade.
  quoteTime = new Date(t0.getTime() + min(29));
  const r3 = await runCycle("schedule", deps(db, p.fetchImpl, new Date(t0.getTime() + min(30))));
  assert.ok((await db.select().from(trades).where(eq(trades.runId, r3.runId!))).length > 0);
  await assertLimits(db);
});

test("e2e: database rejects a duplicate order for the same stock in the same run", async () => {
  const db = await freshDb();
  const t0 = new Date("2026-11-09T15:00:00Z");
  const p = stubProvider(() => ({ quoteTime: t0 }));
  const res = await runCycle("test", deps(db, p.fetchImpl, t0));
  const [t] = await db.select().from(trades).limit(1);
  const { id, ...copy } = t;
  await assert.rejects(db.insert(trades).values({ ...copy, runId: res.runId, snapshotId: null }));
  await assert.rejects(db.insert(trades).values({ ...copy, runId: null, snapshotId: t.snapshotId }));
  // Different run, same stock and same market quote (e.g. two overlapping runs): rejected.
  const [other] = await db.insert(fetchRuns).values({ trigger: "test", status: "running" }).returning();
  await assert.rejects(db.insert(trades).values({ ...copy, runId: other.id, snapshotId: null }));
  assert.equal((await db.select().from(trades)).length, STOCKS.length);
});

test("e2e: provider outage records an error and places no orders", async () => {
  const db = await freshDb();
  const t0 = new Date("2026-11-09T15:00:00Z");
  const p = stubProvider(() => ({ quoteTime: t0, fail: true }));
  const res = await runCycle("schedule", deps(db, p.fetchImpl, t0));
  assert.equal(res.status, "error");
  const [run] = await db.select().from(fetchRuns);
  assert.equal(run.status, "error");
  assert.equal((await db.select().from(trades)).length, 0);
  assert.equal((await db.select().from(priceSnapshots)).length, 0);
  const [acct] = await db.select().from(account);
  assert.equal(acct.cash, START_CAPITAL);
});

test("e2e: closed market or stale quote records prices but places no orders", async () => {
  const db = await freshDb();
  const t0 = new Date("2026-11-09T15:00:00Z");
  let m: Market = { quoteTime: t0, open: false };
  const p = stubProvider(() => m);
  await runCycle("schedule", deps(db, p.fetchImpl, t0));
  m = { quoteTime: t0, open: true }; // open, but quote is 45 minutes old at run time
  const r2 = await runCycle("schedule", deps(db, p.fetchImpl, new Date(t0.getTime() + min(45))));
  assert.equal((await db.select().from(trades)).length, 0);
  assert.equal((await db.select().from(priceSnapshots)).length, 2 * STOCKS.length);
  assert.ok(r2.notes!.every((n) => n.includes("min old")));
});

test("e2e: sells happen automatically, buys halt at A$2,500 and the halt is recorded", async () => {
  const db = await freshDb();
  const t0 = new Date("2026-11-09T15:00:00Z");
  let m: Market = { quoteTime: t0 };
  const p = stubProvider(() => m);
  await runCycle("schedule", deps(db, p.fetchImpl, t0));
  // Synthetic rally in one stock pushes it above 20% -> automatic trim (sell).
  const rallyQuote = new Date(t0.getTime() + min(15));
  const rally = stubProvider(() => ({ quoteTime: rallyQuote }));
  const rallyFetch = (async (url: string) => {
    const res = await rally.fetchImpl(url as any);
    if (!String(url).includes("/quote")) return res;
    const body = await res.json();
    body.LMT.close = String(BASE_USD.LMT * 2.5);
    return Response.json(body);
  }) as typeof fetch;
  const r2 = await runCycle("schedule", deps(db, rallyFetch, new Date(t0.getTime() + min(16))));
  const sells = (await db.select().from(trades).where(eq(trades.runId, r2.runId!))).filter((t) => t.side === "SELL");
  assert.ok(sells.some((t) => t.symbol === "LMT"), "LMT trimmed automatically");
  await assertLimits(db);
  // Synthetic crash -> equity at or below A$2,500 -> buys halted.
  m = { quoteTime: new Date(t0.getTime() + min(31)), scale: 0.05 };
  const r3 = await runCycle("schedule", deps(db, p.fetchImpl, new Date(t0.getTime() + min(32))));
  const [eqRow] = await db.select().from(equitySnapshots).where(eq(equitySnapshots.runId, r3.runId!));
  assert.ok(eqRow.equity <= 2500);
  assert.equal(eqRow.buysHalted, true);
  assert.ok(!(await db.select().from(trades).where(eq(trades.runId, r3.runId!))).some((t) => t.side === "BUY"));
});

test("e2e: pause switch records prices but places no orders", async () => {
  const db = await freshDb();
  const now = new Date("2026-11-09T15:00:00Z");
  await db.insert(account).values({ id: 1, startingCapital: START_CAPITAL, cash: START_CAPITAL });
  const res = await db.transaction(async (tx: any) => {
    const [run] = await tx.insert(fetchRuns).values({ trigger: "test", status: "running" }).returning();
    const quotes = STOCKS.map((s) => ({ symbol: s.symbol, providerSymbol: s.providerSymbol, exchange: "TEST",
      currency: "USD", priceNative: BASE_USD[s.providerSymbol], quoteTime: now, marketOpen: true }));
    return applyMarketData(tx, run.id, quotes, { USD: { rate: FX, time: now, pair: "USD/AUD" } }, [], now,
      TEST_SOURCE, { tradingEnabled: false });
  });
  assert.equal((await db.select().from(trades)).length, 0);
  assert.ok(res.notes!.every((n) => n.includes("paused")));
});
