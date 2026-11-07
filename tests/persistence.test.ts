// Isolated persistence test for the paper-trading engine.
// Runs the real engine write path (applyMarketData) against a throwaway in-memory Postgres (PGlite)
// built from this repo's migration SQL. It never connects to the Netlify production or preview
// database, so the real A$5,000 portfolio cannot be touched.
// All quotes below are synthetic TEST DATA (not market prices) and are labelled as such in the rows.
// Run with: npx tsx --test tests/persistence.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { applyMarketData, latestPrices, START_CAPITAL, STOCKS, type Quote } from "../lib/simulation.js";

const { account, positions, trades, priceSnapshots, equitySnapshots, fetchRuns } = schema;
const TEST_SOURCE = "TEST DATA - isolated test";
const TEST_PRICES: Record<string, number> = { LMT: 500, RTX: 150, GD: 300, NOC: 450, BAE: 90 }; // synthetic USD
const FX_RATE = 1.5; // synthetic

async function freshDb() {
  const pg = new PGlite();
  const dir = "netlify/database/migrations";
  for (const m of readdirSync(dir).sort()) {
    const sqlText = readFileSync(`${dir}/${m}/migration.sql`, "utf8");
    for (const stmt of sqlText.split("--> statement-breakpoint")) if (stmt.trim()) await pg.exec(stmt);
  }
  const db = drizzle({ client: pg, schema });
  await db.insert(account).values({ id: 1, startingCapital: START_CAPITAL, cash: START_CAPITAL });
  return db;
}

function testQuotes(now: Date, scale = 1, marketOpen = true): Quote[] {
  return STOCKS.map((s) => ({
    symbol: s.symbol, providerSymbol: s.providerSymbol, exchange: "TEST", currency: "USD",
    priceNative: TEST_PRICES[s.symbol] * scale, quoteTime: now, marketOpen,
  }));
}

async function cycle(db: any, now: Date, scale = 1, marketOpen = true) {
  return db.transaction(async (tx: any) => {
    const [run] = await tx.insert(fetchRuns).values({ trigger: "test", status: "running" }).returning();
    const fx = { USD: { rate: FX_RATE, time: now, pair: "USD/AUD" } };
    const res = await applyMarketData(tx, run.id, testQuotes(now, scale, marketOpen), fx, [], now, TEST_SOURCE);
    return { ...res, runId: run.id };
  });
}

test("engine persists cash, positions, trades and equity within the risk limits", async () => {
  const db = await freshDb();
  const res = await cycle(db, new Date());
  assert.equal(res.status, "ok");

  const [acct] = await db.select().from(account).where(eq(account.id, 1));
  const pos = await db.select().from(positions);
  const tr = await db.select().from(trades);
  const snaps = await db.select().from(priceSnapshots);
  const [eqRow] = await db.select().from(equitySnapshots);

  assert.ok(acct.cash < START_CAPITAL, "cash was debited");
  assert.equal(pos.length, 5, "five positions stored");
  assert.equal(tr.length, 5, "five simulated buy fills stored");
  assert.ok(tr.every((t) => t.side === "BUY" && t.runId === res.runId));
  assert.ok(Math.abs(tr.at(-1)!.cashAfter - acct.cash) < 0.005, "trade ledger matches account cash");
  assert.ok(snaps.every((s) => s.source === TEST_SOURCE), "test prices are labelled as test data");
  assert.ok(Math.abs(eqRow.equity - START_CAPITAL) < 0.05);

  for (const p of pos) {
    const value = p.shares * TEST_PRICES[p.symbol] * FX_RATE;
    assert.ok(value / eqRow.equity <= 0.2 + 1e-9, `${p.symbol} above 20%`);
  }
  assert.ok(acct.cash / eqRow.equity >= 0.3 - 1e-9, "cash reserve below 30%");

  const latest = await latestPrices(db);
  assert.equal(Object.keys(latest).length, 5, "latest prices readable");
});

test("data survives across runs: second cycle reads the stored state and does not churn", async () => {
  const db = await freshDb();
  await cycle(db, new Date());
  const res2 = await cycle(db, new Date());
  const tr = await db.select().from(trades);
  assert.equal(tr.length, 5, "no extra trades on an already balanced portfolio");
  assert.equal(res2.status, "ok");
  assert.equal((await db.select().from(equitySnapshots)).length, 2);
});

test("A$2,500 emergency halt is persisted and blocks buys", async () => {
  const db = await freshDb();
  await cycle(db, new Date());
  const crash = await cycle(db, new Date(), 0.05); // synthetic crash to push equity below A$2,500
  const tr = await db.select().from(trades).where(eq(trades.runId, crash.runId));
  const [eqRow] = await db.select().from(equitySnapshots).where(eq(equitySnapshots.runId, crash.runId));
  assert.ok(eqRow.equity <= 2500);
  assert.equal(eqRow.buysHalted, true);
  assert.ok(!tr.some((t) => t.side === "BUY"), "no buys while halted");
  assert.ok((crash.notes ?? []).some((n: string) => n.startsWith("BUYS HALTED")));
});

test("market closed: prices are stored but no simulated order is placed", async () => {
  const db = await freshDb();
  const res = await cycle(db, new Date(), 1, false);
  assert.equal((await db.select().from(trades)).length, 0);
  assert.equal((await db.select().from(priceSnapshots)).length, 5);
  const [acct] = await db.select().from(account);
  assert.equal(acct.cash, START_CAPITAL);
  assert.ok((res.notes ?? []).every((n: string) => n.includes("market closed")));
});
