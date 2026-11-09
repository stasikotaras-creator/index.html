// OPTIONAL isolated live check: calls the REAL market-data provider (Twelve Data) with the configured key and
// runs one full autonomous cycle against a throwaway in-memory database (PGlite). Nothing is written to the
// Netlify production or preview database, and no order is sent anywhere (there is no broker integration).
// Uses provider credits, so it only runs when LIVE_PROVIDER_TEST=1 and TWELVE_DATA_API_KEY are set:
//   LIVE_PROVIDER_TEST=1 npx tsx --test tests/live-provider.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../db/schema.js";
import { runCycle, START_CAPITAL, MIN_CASH_RESERVE } from "../lib/simulation.js";

const enabled = process.env.LIVE_PROVIDER_TEST === "1" && Boolean(process.env.TWELVE_DATA_API_KEY);

test("live provider -> isolated database: one autonomous cycle", { skip: enabled ? false : "set LIVE_PROVIDER_TEST=1" }, async () => {
  const pg = new PGlite();
  const dir = "netlify/database/migrations";
  for (const m of readdirSync(dir).sort()) {
    for (const stmt of readFileSync(`${dir}/${m}/migration.sql`, "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await pg.exec(stmt);
    }
  }
  const db = drizzle({ client: pg, schema });
  const res = await runCycle("test", { conn: db });
  const runs = await db.select().from(schema.fetchRuns);
  const snaps = await db.select().from(schema.priceSnapshots);
  const tr = await db.select().from(schema.trades);
  const [acct] = await db.select().from(schema.account);
  const [eq] = await db.select().from(schema.equitySnapshots);
  console.log(JSON.stringify({
    status: res.status, notes: res.notes,
    prices: snaps.map((s) => ({ symbol: s.symbol, native: `${s.currency} ${s.priceNative}`, aud: +s.priceAud.toFixed(2),
      marketOpen: s.marketOpen, quoteTime: s.quoteTime, fx: `${s.fxPair} ${s.fxRate}` })),
    trades: tr.map((t) => `${t.side} ${t.shares} ${t.symbol} @ A$${t.priceAud.toFixed(2)}`),
    cash: acct.cash, equity: eq?.equity,
  }, null, 2));
  assert.equal(runs.length, 1);
  assert.ok(["ok", "partial"].includes(res.status!), `provider run status ${res.status}`);
  assert.equal(new Set(snaps.map((s) => s.symbol)).size, snaps.length);
  assert.ok(snaps.every((s) => s.source === "Twelve Data" && s.priceNative > 0 && s.fxRate > 0));
  for (const t of tr) {
    const s = snaps.find((x) => x.id === t.snapshotId)!;
    assert.ok(s.marketOpen, "trades only while market open");
    assert.equal(t.priceAud, s.priceAud, "fill price equals verified quote");
  }
  assert.equal(new Set(tr.map((t) => t.symbol)).size, tr.length, "no duplicate orders");
  if (eq) {
    assert.ok(acct.cash / eq.equity >= MIN_CASH_RESERVE - 1e-9);
    assert.ok(Math.abs(eq.equity - START_CAPITAL) < 1, "fills at quote price leave equity unchanged");
  }
});
