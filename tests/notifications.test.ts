import { evidence } from "./evidence-fixture.js";
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql, eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { enqueue, drain } from '../lib/notifications.js';
import { applyMarketData, STOCKS } from '../lib/simulation.js';
async function fixture() {
  const pg = new PGlite();
  for (const name of readdirSync('netlify/database/migrations').sort()) await pg.exec(readFileSync(`netlify/database/migrations/${name}/migration.sql`, 'utf8'));
  const db = drizzle({ client: pg, schema });
  await db.insert(schema.investmentEvidence).values(STOCKS.map(s => ({ symbol: s.symbol, evidence, recordedAt: new Date('2026-11-01') })));
  await db.insert(schema.pushSubscriptions).values({ id: 'device', ownerId: 'owner', endpoint: 'https://web.push.apple.com/test', subscription: { endpoint: 'https://web.push.apple.com/test', keys: {} } });
  return { db, pg };
}
test('isolated outbox test leaves portfolio empty; deduplicates events, retries failure and never resends sent delivery', async () => {
  const { db, pg } = await fixture();
  try {
    await assert.rejects(db.transaction(async tx => { await enqueue(tx, 'rolled-back', 'test', { title: 'TEST' }); throw Error('rollback'); }));
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 0);
    for (let i=0;i<2;i++) await db.transaction(tx => enqueue(tx, 'test:synthetic-buy', 'test', { title: 'TEST · BUY', body: 'TEST 2 @ A$123.45; A$246.90; equity A$5000; P/L A$0' }));
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 1);
    assert.equal((await db.select().from(schema.notificationDeliveries)).length, 1);
    let calls = 0;
    await drain(db, (async () => { calls++; throw { statusCode: 503 }; }) as any);
    assert.equal((await db.select().from(schema.notificationDeliveries))[0].status, 'retry');
    await drain(db, (async () => { calls++; }) as any);
    assert.equal(calls, 1, 'backoff prevents immediate resend');
    await db.execute(sql`update notification_deliveries set next_attempt=now()-interval '1 second'`);
    await drain(db, (async () => { calls++; return {}; }) as any);
    await drain(db, (async () => { calls++; return {}; }) as any);
    assert.equal(calls, 2);
    assert.equal((await db.select().from(schema.notificationDeliveries))[0].status, 'sent');
    assert.equal((await db.select().from(schema.trades)).length, 0);
    assert.equal((await db.select().from(schema.account)).length, 0);
    assert.equal((await db.select().from(schema.positions)).length, 0);
  } finally { await pg.close(); }
});
test('risk incident persists, alerts once, blocks buys and only resets with verified recovery', async () => {
  const { db, pg } = await fixture();
  try {
    await db.insert(schema.account).values({ id: 1, startingCapital: 5000, cash: 2500 });
    async function cycle(complete = true) {
      const now = new Date();
      await db.transaction(async tx => {
        const [run] = await tx.insert(schema.fetchRuns).values({ trigger: 'test', status: 'running' }).returning();
        await applyMarketData(tx, run.id, (complete ? STOCKS : STOCKS.slice(0,1)).map(s => ({ symbol:s.symbol, providerSymbol:s.providerSymbol, exchange:'TEST', currency:'AUD', priceNative:100, quoteTime:now, marketOpen:true })), { AUD:{rate:1,time:now,pair:'AUD/AUD'} }, [], now, 'ISOLATED TEST');
      });
    }
    await cycle(); await cycle();
    assert.equal((await db.select().from(schema.riskState))[0].halted, true);
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 1);
    assert.equal((await db.select().from(schema.trades)).length, 0);
    // Synthetic isolated recovery; never touches a deployed database.
    await db.update(schema.account).set({cash:2600}).where(eq(schema.account.id,1));
    await cycle(false);
    assert.equal((await db.select().from(schema.riskState))[0].halted, true);
    assert.equal((await db.select().from(schema.trades)).length, 0);
    await cycle();
    assert.equal((await db.select().from(schema.riskState))[0].halted, false);
    assert.ok((await db.select().from(schema.trades)).length > 0);
    const tradeEvents = (await db.select().from(schema.notificationOutbox)).filter(e => e.kind === 'trade');
    assert.equal(tradeEvents.length, (await db.select().from(schema.trades)).length);
    assert.ok(tradeEvents.every(e => e.id.startsWith('trade:')));
    await db.update(schema.account).set({cash:0}).where(eq(schema.account.id,1));
    await cycle(); await cycle();
    assert.equal((await db.select().from(schema.notificationOutbox)).filter(e => e.kind === 'risk').length, 2, 'recovery then new breach creates exactly one new incident');
    await drain(db, (async () => { throw {statusCode:410}; }) as any);
    assert.equal((await db.select().from(schema.pushSubscriptions)).length, 0, 'expired subscription revoked');
    assert.equal((await db.select().from(schema.notificationDeliveries)).length, 0, 'revocation cancels deliveries');
  } finally { await pg.close(); }
});
