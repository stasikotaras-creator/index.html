// REVEL TradeGuard paper-trading engine.
// Simulated fills only. There is no broker integration and no real orders are ever sent.
import { sql, eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  account, positions, fetchRuns, priceSnapshots, trades, equitySnapshots,
} from "../db/schema.js";

export const START_CAPITAL = 5000;
export const MAX_ALLOCATION = 0.2; // max 20% of equity per stock
export const TARGET_ALLOCATION = 0.14; // equal weight: 5 x 14% = 70% invested
export const MIN_CASH_RESERVE = 0.3; // keep at least 30% of equity in cash
export const BUY_HALT_EQUITY = 2500; // no new buys at or below A$2,500
export const MIN_TRADE_AUD = 25; // ignore rebalancing differences smaller than this
export const MAX_TRADE_QUOTE_AGE_MIN = 20; // only trade on quotes newer than this
export const MAX_TRADE_FX_AGE_MIN = 120;
export const REFRESH_INTERVAL_MIN = 14; // throttle between provider calls

export const STOCKS = [
  { symbol: "LMT", providerSymbol: "LMT", name: "Lockheed Martin", note: "NYSE" },
  { symbol: "RTX", providerSymbol: "RTX", name: "RTX Corporation", note: "NYSE" },
  { symbol: "GD", providerSymbol: "GD", name: "General Dynamics", note: "NYSE" },
  { symbol: "NOC", providerSymbol: "NOC", name: "Northrop Grumman", note: "NYSE" },
  {
    symbol: "BAE",
    providerSymbol: "BAESY",
    name: "BAE Systems",
    note: "US-listed ADR BAESY (1 ADR = 4 ordinary shares). London listing BA. is not included in the current data plan.",
  },
] as const;

const SOURCE = "Twelve Data";
const API = "https://api.twelvedata.com";
const LOCK_KEY = 7271001;

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const floorShares = (n: number) => Math.floor(n * 10000) / 10000;
const ageMin = (d: Date, now: Date) => (now.getTime() - d.getTime()) / 60000;

type Quote = {
  symbol: string; providerSymbol: string; exchange: string; currency: string;
  priceNative: number; quoteTime: Date; marketOpen: boolean;
};

async function getJson(url: string) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(`Provider HTTP ${res.status}`);
  if (body.status === "error") throw new Error(`Provider: ${body.message ?? "error"}`);
  return body;
}

async function fetchQuotes(key: string, notes: string[]): Promise<Quote[]> {
  const symbols = STOCKS.map((s) => s.providerSymbol).join(",");
  const body = await getJson(`${API}/quote?symbol=${encodeURIComponent(symbols)}&apikey=${encodeURIComponent(key)}`);
  const out: Quote[] = [];
  for (const s of STOCKS) {
    const q = body[s.providerSymbol];
    if (!q || q.status === "error") {
      notes.push(`${s.symbol}: no verified quote (${q?.message ?? "missing from response"}).`);
      continue;
    }
    const price = Number(q.close);
    const ts = Number(q.last_quote_at ?? q.timestamp);
    let currency = String(q.currency || "");
    let priceNative = price;
    if (currency === "GBp" || currency === "GBX") { priceNative = price / 100; currency = "GBP"; }
    if (!Number.isFinite(priceNative) || priceNative <= 0 || !Number.isFinite(ts) || ts <= 0 || !currency) {
      notes.push(`${s.symbol}: quote rejected (invalid price, currency or timestamp).`);
      continue;
    }
    out.push({
      symbol: s.symbol,
      providerSymbol: s.providerSymbol,
      exchange: String(q.exchange || ""),
      currency,
      priceNative,
      quoteTime: new Date(ts * 1000),
      marketOpen: q.is_market_open === true,
    });
  }
  return out;
}

async function fetchFx(key: string, currencies: string[]) {
  const pairs = currencies.filter((c) => c !== "AUD").map((c) => `${c}/AUD`);
  const rates: Record<string, { rate: number; time: Date; pair: string }> = {
    AUD: { rate: 1, time: new Date(), pair: "AUD/AUD" },
  };
  if (!pairs.length) return rates;
  const body = await getJson(`${API}/exchange_rate?symbol=${encodeURIComponent(pairs.join(","))}&apikey=${encodeURIComponent(key)}`);
  for (const pair of pairs) {
    const r = pairs.length === 1 ? body : body[pair];
    const rate = Number(r?.rate);
    const ts = Number(r?.timestamp);
    if (r && r.status !== "error" && Number.isFinite(rate) && rate > 0 && Number.isFinite(ts) && ts > 0) {
      rates[pair.split("/")[0]] = { rate, time: new Date(ts * 1000), pair };
    }
  }
  return rates;
}

export type RunResult = { ran: boolean; reason?: string; runId?: number; status?: string; notes?: string[] };

export async function runCycle(trigger: "schedule" | "dashboard" | "manual"): Promise<RunResult> {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) return { ran: false, reason: "Market data provider is not configured." };

  return db.transaction(async (tx) => {
    // One refresh at a time across all function instances.
    const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(${LOCK_KEY}) as ok`);
    const lockRows = ((lock as any).rows ?? lock) as Array<{ ok: boolean }>;
    if (!lockRows[0]?.ok) return { ran: false, reason: "Another refresh is in progress." };

    const [last] = await tx.select().from(fetchRuns).orderBy(desc(fetchRuns.startedAt)).limit(1);
    const now = new Date();
    if (last && ageMin(last.startedAt, now) < REFRESH_INTERVAL_MIN) {
      return { ran: false, reason: "Prices were refreshed recently.", runId: last.id };
    }

    await tx.insert(account).values({ id: 1, startingCapital: START_CAPITAL, cash: START_CAPITAL }).onConflictDoNothing();
    const [run] = await tx.insert(fetchRuns).values({ trigger, status: "running" }).returning();
    const notes: string[] = [];

    let quotes: Quote[] = [];
    let fx: Awaited<ReturnType<typeof fetchFx>> = {};
    try {
      quotes = await fetchQuotes(key, notes);
      fx = await fetchFx(key, [...new Set(quotes.map((q) => q.currency))]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await tx.update(fetchRuns).set({ status: "error", message: msg, notes, finishedAt: new Date() }).where(eq(fetchRuns.id, run.id));
      return { ran: true, runId: run.id, status: "error", notes: [msg, ...notes] };
    }

    // Store verified, AUD-converted prices.
    type Priced = Quote & { snapshotId: number; priceAud: number; fxRate: number; fxTime: Date; fxPair: string };
    const priced: Record<string, Priced> = {};
    for (const q of quotes) {
      const r = fx[q.currency];
      if (!r) { notes.push(`${q.symbol}: no ${q.currency}/AUD rate, price not recorded.`); continue; }
      const priceAud = q.priceNative * r.rate;
      const [snap] = await tx.insert(priceSnapshots).values({
        runId: run.id, symbol: q.symbol, providerSymbol: q.providerSymbol, exchange: q.exchange,
        currency: q.currency, priceNative: q.priceNative, fxPair: r.pair, fxRate: r.rate, fxTime: r.time,
        priceAud, quoteTime: q.quoteTime, marketOpen: q.marketOpen, source: SOURCE, fetchedAt: now,
      }).returning({ id: priceSnapshots.id });
      priced[q.symbol] = { ...q, snapshotId: snap.id, priceAud, fxRate: r.rate, fxTime: r.time, fxPair: r.pair };
    }

    // Latest known AUD price per stock (this run, else the last stored verified price).
    const latest = await latestPrices(tx);
    const [acct] = await tx.select().from(account).where(eq(account.id, 1));
    const posRows = await tx.select().from(positions);
    const holdings: Record<string, { shares: number; cost: number }> = {};
    for (const p of posRows) holdings[p.symbol] = { shares: p.shares, cost: p.costBasisAud };
    let cash = acct.cash;

    const sharesOf = (s: string) => holdings[s]?.shares ?? 0;
    const valueOf = (s: string) => sharesOf(s) * (latest[s]?.priceAud ?? 0);
    const unpriced = STOCKS.filter((s) => sharesOf(s.symbol) > 0 && !latest[s.symbol]);
    const equity = () => cash + STOCKS.reduce((sum, s) => sum + valueOf(s.symbol), 0);

    const tradable = (s: string) => {
      const p = priced[s];
      if (!p) return `${s}: no fresh verified price this run.`;
      if (!p.marketOpen) return `${s}: market closed, no simulated trade.`;
      if (ageMin(p.quoteTime, now) > MAX_TRADE_QUOTE_AGE_MIN) return `${s}: quote is ${Math.round(ageMin(p.quoteTime, now))} min old, no simulated trade.`;
      if (p.currency !== "AUD" && ageMin(p.fxTime, now) > MAX_TRADE_FX_AGE_MIN) return `${s}: FX rate is stale, no simulated trade.`;
      return null;
    };

    const record = async (s: string, side: "BUY" | "SELL", qty: number, rule: string) => {
      const p = priced[s];
      const eqBefore = equity();
      const value = round(qty * p.priceAud, 2);
      const h = (holdings[s] ??= { shares: 0, cost: 0 });
      if (side === "BUY") {
        cash = round(cash - value, 2);
        h.cost += value;
        h.shares = round(h.shares + qty, 6);
      } else {
        const frac = h.shares > 0 ? qty / h.shares : 0;
        h.cost = Math.max(0, h.cost * (1 - frac));
        cash = round(cash + value, 2);
        h.shares = Math.max(0, round(h.shares - qty, 6));
      }
      await tx.insert(trades).values({
        runId: run.id, snapshotId: p.snapshotId, executedAt: now, symbol: s, side, shares: qty,
        priceAud: p.priceAud, valueAud: value, priceNative: p.priceNative, currency: p.currency,
        fxRate: p.fxRate, quoteTime: p.quoteTime, rule, cashAfter: cash, equityAtTrade: eqBefore,
      });
      await tx.insert(positions).values({ symbol: s, shares: h.shares, costBasisAud: h.cost, updatedAt: now })
        .onConflictDoUpdate({ target: positions.symbol, set: { shares: h.shares, costBasisAud: h.cost, updatedAt: now } });
    };

    if (unpriced.length) {
      notes.push(`Equity cannot be valued (no price for ${unpriced.map((s) => s.symbol).join(", ")}); simulated trading skipped.`);
    } else {
      // 1) Trim positions above the 20% limit back to the 14% target (sells are allowed even when buys are halted).
      for (const s of STOCKS) {
        const e = equity();
        if (valueOf(s.symbol) <= e * MAX_ALLOCATION + 0.005) continue;
        const why = tradable(s.symbol);
        if (why) { notes.push(`${why} (position above 20% limit)`); continue; }
        const excess = valueOf(s.symbol) - e * TARGET_ALLOCATION;
        const qty = Math.min(sharesOf(s.symbol), floorShares(excess / priced[s.symbol].priceAud));
        if (qty > 0) await record(s.symbol, "SELL", qty, `Trim: position above ${MAX_ALLOCATION * 100}% limit, rebalanced to ${TARGET_ALLOCATION * 100}% target`);
      }

      // 2) Buy towards the equal-weight 14% target within the risk limits.
      for (const s of STOCKS) {
        const e = equity();
        if (e <= BUY_HALT_EQUITY) { notes.push(`BUYS HALTED: equity A$${e.toFixed(2)} is at or below A$${BUY_HALT_EQUITY.toFixed(2)}.`); break; }
        const shortfall = e * TARGET_ALLOCATION - valueOf(s.symbol);
        if (shortfall < MIN_TRADE_AUD) continue;
        const why = tradable(s.symbol);
        if (why) { notes.push(why); continue; }
        const capRoom = e * MAX_ALLOCATION - valueOf(s.symbol);
        const cashRoom = cash - e * MIN_CASH_RESERVE;
        const budget = Math.min(shortfall, capRoom, cashRoom);
        if (budget < MIN_TRADE_AUD) {
          notes.push(`${s.symbol}: buy blocked by ${cashRoom <= capRoom ? "30% cash reserve" : "20% stock limit"}.`);
          continue;
        }
        const qty = floorShares(budget / priced[s.symbol].priceAud);
        if (qty > 0) await record(s.symbol, "BUY", qty, `Equal-weight buy towards ${TARGET_ALLOCATION * 100}% target`);
      }
    }

    await tx.update(account).set({ cash, updatedAt: now }).where(eq(account.id, 1));

    if (!unpriced.length) {
      const e = equity();
      await tx.insert(equitySnapshots).values({
        runId: run.id, recordedAt: now, cash, positionsValue: round(e - cash, 2), equity: round(e, 2),
        profitLoss: round(e - acct.startingCapital, 2), buysHalted: e <= BUY_HALT_EQUITY,
      });
    }

    const status = Object.keys(priced).length === STOCKS.length ? "ok" : Object.keys(priced).length ? "partial" : "error";
    await tx.update(fetchRuns).set({
      status, message: `${Object.keys(priced).length}/${STOCKS.length} verified prices recorded.`, notes, finishedAt: new Date(),
    }).where(eq(fetchRuns.id, run.id));
    return { ran: true, runId: run.id, status, notes };
  });
}

export async function latestPrices(conn: any = db) {
  const rows = await conn.execute(sql`
    select distinct on (symbol) id, symbol, provider_symbol, exchange, currency, price_native, fx_pair, fx_rate,
      fx_time, price_aud, quote_time, market_open, source, fetched_at
    from price_snapshots order by symbol, fetched_at desc, id desc`);
  const list = ((rows as any).rows ?? rows) as any[];
  const out: Record<string, {
    priceAud: number; priceNative: number; currency: string; exchange: string; providerSymbol: string;
    fxPair: string; fxRate: number; fxTime: string; quoteTime: string; marketOpen: boolean; source: string; fetchedAt: string;
  }> = {};
  for (const r of list) {
    out[r.symbol] = {
      priceAud: Number(r.price_aud), priceNative: Number(r.price_native), currency: r.currency, exchange: r.exchange,
      providerSymbol: r.provider_symbol, fxPair: r.fx_pair, fxRate: Number(r.fx_rate),
      fxTime: new Date(r.fx_time).toISOString(), quoteTime: new Date(r.quote_time).toISOString(),
      marketOpen: Boolean(r.market_open), source: r.source, fetchedAt: new Date(r.fetched_at).toISOString(),
    };
  }
  return out;
}
