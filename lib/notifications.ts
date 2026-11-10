import * as webpush from 'web-push';
import { randomUUID, createHash } from 'node:crypto';
import { sql, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { pushConfig, pushSubscriptions, notificationOutbox, notificationDeliveries } from '../db/schema.js';

export async function vapid(conn: any = db) {
  const keys = webpush.generateVAPIDKeys();
  await conn.insert(pushConfig).values({ id: 1, publicKey: keys.publicKey, privateKey: keys.privateKey }).onConflictDoNothing();
  const [config] = await conn.select().from(pushConfig).where(eq(pushConfig.id, 1));
  return config;
}
export async function enqueue(tx: any, id: string, kind: string, payload: any, onlySubscription?: string) {
  await tx.insert(notificationOutbox).values({ id, kind, payload }).onConflictDoNothing();
  const subscriptions = await tx.select().from(pushSubscriptions);
  for (const s of subscriptions) {
    if (onlySubscription && s.id !== onlySubscription) continue;
    await tx.insert(notificationDeliveries).values({ eventId: id, subscriptionId: s.id }).onConflictDoNothing();
  }
}
export function tradePayload(t: any, startingCapital: number) {
  const aud = (n: number) => 'A$' + n.toFixed(2);
  return { title: `Simulated ${t.side} · ${t.symbol}`, body: `${t.shares} shares @ ${aud(t.priceAud)}\nTotal ${aud(t.valueAud)} · ${new Date(t.executedAt).toISOString()}\nEquity ${aud(t.equityAtTrade)} · P/L ${aud(t.equityAtTrade - startingCapital)}`, transactionId: String(t.id) };
}
// Network send occurs after the claim transaction commits. Expiring leases recover crashed workers.
export async function drain(conn: any = db, send: typeof webpush.sendNotification = webpush.sendNotification) {
  const config = await vapid(conn);
  const deadline = Date.now() + 20000;
  for (let i = 0; i < 30 && Date.now() < deadline; i++) {
    const result = await conn.execute(sql`
      with candidate as (
        select event_id, subscription_id from notification_deliveries
        where status in ('pending','retry','sending') and next_attempt <= now()
        order by next_attempt for update skip locked limit 1
      ) update notification_deliveries d set status='sending', attempts=d.attempts+1,
        next_attempt=now()+interval '2 minutes'
      from candidate c where d.event_id=c.event_id and d.subscription_id=c.subscription_id returning d.*`);
    const claim = (result.rows ?? result)[0];
    if (!claim) break;
    const [sub] = await conn.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, claim.subscription_id));
    const [event] = await conn.select().from(notificationOutbox).where(eq(notificationOutbox.id, claim.event_id));
    if (!sub || !event) continue;
    try {
      await send(sub.subscription as any, JSON.stringify({ ...(event.payload as object), id: event.id, url: '/#notifications' }), {
        vapidDetails: { subject: 'https://revel-tradeguard.netlify.app', publicKey: config.publicKey, privateKey: config.privateKey },
        timeout: 5000, TTL: 86400, urgency: event.kind === 'risk' ? 'high' : 'normal',
        topic: createHash('sha256').update(event.id).digest('base64url').slice(0, 32),
      });
      await conn.execute(sql`update notification_deliveries set status='sent', sent_at=now() where event_id=${event.id} and subscription_id=${sub.id}`);
    } catch (error: any) {
      if (error.statusCode === 404 || error.statusCode === 410) await conn.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
      else await conn.execute(sql`update notification_deliveries set status='retry', next_attempt=now()+make_interval(secs => ${Math.min(3600, 15 * 2 ** Math.min(claim.attempts, 8))}) where event_id=${event.id} and subscription_id=${sub.id}`);
    }
  }
}
export { randomUUID };
