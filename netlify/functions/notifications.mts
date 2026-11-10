import { getUser } from '@netlify/identity';
import { eq, desc, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { pushSubscriptions, notificationOutbox, notificationDeliveries } from '../../db/schema.js';
import { vapid, enqueue, drain, randomUUID, tradePayload } from '../../lib/notifications.js';

export default async (req: Request) => {
  const reply = (body: any, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
  try {
    const user = await getUser();
    const owner = Netlify.env.get('NOTIFICATION_OWNER_EMAIL')?.trim().toLowerCase();
    if (!owner) return reply({ error: 'Owner email is not configured.' }, 503);
    if (!user || user.email?.toLowerCase() !== owner || !user.confirmedAt) return reply({ error: 'Sign in with the verified owner email.' }, 403);
    if (req.method !== 'GET' && req.headers.get('origin') !== new URL(req.url).origin) return reply({ error: 'Invalid request origin.' }, 403);
    if (req.method === 'GET') {
      // Preview schedules do not execute: opening this section also processes due retries.
      await drain();
      const subscriptions = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.ownerId, user.id));
      const history = await db.select({ id: notificationOutbox.id, kind: notificationOutbox.kind, payload: notificationOutbox.payload,
        createdAt: notificationOutbox.createdAt, status: notificationDeliveries.status, attempts: notificationDeliveries.attempts })
        .from(notificationOutbox).leftJoin(notificationDeliveries, eq(notificationOutbox.id, notificationDeliveries.eventId))
        .orderBy(desc(notificationOutbox.createdAt)).limit(100);
      return reply({ publicKey: (await vapid()).publicKey, subscriptions, history });
    }
    if (req.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
    if (Number(req.headers.get('content-length')) > 8192) return reply({ error: 'Request too large.' }, 413);
    const body = await req.json();
    if (body.action === 'subscribe') {
      const s = body.subscription;
      const url = new URL(s?.endpoint);
      // Explicit push-service allowlist prevents subscription endpoints becoming an SSRF proxy.
      if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash ||
        !['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com'].some(h => url.hostname === h || (h === 'web.push.apple.com' && url.hostname.endsWith('.web.push.apple.com'))) ||
        !/^[A-Za-z0-9_-]{87}$/.test(s.keys?.p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(s.keys?.auth)) return reply({ error: 'Invalid push subscription.' }, 400);
      const [existing] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, s.endpoint));
      if (existing && existing.ownerId !== user.id) return reply({ error: 'Subscription belongs to another account.' }, 403);
      const id = existing?.id ?? randomUUID();
      await db.insert(pushSubscriptions).values({ id, ownerId: user.id, endpoint: s.endpoint, subscription: s }).onConflictDoNothing();
      return reply({ id });
    }
    if (body.action === 'disable') {
      // Revoking all devices deletes their queued deliveries too.
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.ownerId, user.id));
      return reply({ disabled: true });
    }
    if (body.action === 'test') {
      const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.ownerId, user.id));
      const sub = subs.find(s => s.id === body.subscriptionId);
      if (!sub) return reply({ error: 'Enable notifications on this device first.' }, 400);
      const id = `test:${randomUUID()}`;
      await db.transaction(async tx => {
        // Serialize test requests and limit to one per minute. No account/ledger writes.
        await tx.execute(sql`select pg_advisory_xact_lock(7271003)`);
        const recent: any = await tx.execute(sql`select id from notification_outbox where kind='test' and created_at > now()-interval '1 minute' limit 1`);
        if ((recent.rows ?? recent).length) throw new Error('test-rate-limit');
        await enqueue(tx, id, 'test', { ...tradePayload({ id, side: 'BUY', symbol: 'TEST', shares: 2, priceAud: 123.45, valueAud: 246.9, executedAt: new Date(), equityAtTrade: 5000 }, 5000), title: 'TEST ONLY · Simulated BUY · TEST', body: 'Isolated test; no portfolio changes.\n' + tradePayload({ id, side: 'BUY', symbol: 'TEST', shares: 2, priceAud: 123.45, valueAud: 246.9, executedAt: new Date(), equityAtTrade: 5000 }, 5000).body }, sub.id);
      });
      await drain();
      return reply({ queued: true, id });
    }
    return reply({ error: 'Unknown action.' }, 400);
  } catch (error: any) {
    return reply({ error: error.message === 'test-rate-limit' ? 'Wait one minute before another test.' : 'Notification request failed. Please try again.' }, error.message === 'test-rate-limit' ? 429 : 503);
  }
};
export const config = { path: '/api/notifications' };
