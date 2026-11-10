// REVEL TradeGuard paper-trading engine.
// Simulated fills only. There is no broker integration and no real orders are ever sent.
import { sql, eq, desc, and, gte, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  account, positions, fetchRuns, priceSnapshots, trades, equitySnapshots, riskState, investmentEvidence,
} from "../db/schema.js";

import { scoreEvidence } from "./scoring.js";
import { describeEvaluation } from "./evaluation.js";
import { enqueue, tradePayload, randomUUID } from "./notifications.js";
import {
  planOrders, START_CAPITAL, BUY_HALT_EQUITY, round,
} from "./rules.js";
export {
  START_CAPITAL, MAX_ALLOCATION, TARGET_ALLOCATION, MIN_CASH_RESERVE, BUY_HALT_EQUITY, MIN_TRADE_AUD,
} from "./rules.js";
export const MAX_TRADE_QUOTE_AGE_MIN = 20; // only trade on quotes newer than this
export const MAX_TRADE_FX_AGE_MIN = 120;
export const REFRESH_INTERVAL_MIN = 14; // throttle between provider calls
export const SCHEDULED_MIN_GAP_MIN = 10;
export const SCHEDULE_CRON = "*/15 * * * 1-5"; // keep in sync with netlify/functions/scheduled-prices.mts

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

// Autonomous simulated trading is ON unless PAPER_TRADING_ENABLED is explicitly "false" (emergency pause:
// prices are still recorded, but no simulated orders are placed). Real-money trading does not exist here.
// Netlify runtime environment; process fallback supports isolated Node tests.
export const runtimeEnv = (name: string): string | undefined =>
  (globalThis as any).Netlify?.env?.get(name) ?? process.env[name];
export const autoTradingEnabled = () => runtimeEnv('PAPER_TRADING_ENABLED')?.trim().toLowerCase() !== "false";
export const REAL_MONEY_TRADING = false as const;

const SOURCE = "Twelve Data";
const API = "https://api.twelvedata.com";
const LOCK_KEY = 7271001;

const ageMin = (d: Date, now: Date) => (now.getTime() - d.getTime()) / 60000;

export type Quote = {
  symbol: string; providerSymbol: string; exchange: string; currency: string;
  priceNative: number; quoteTime: Date; marketOpen: boolean;
};

type FetchFn = typeof fetch;

async function getJson(url: string, fetchImpl: FetchFn = fetch) {
  const res = await fetchImpl(url, { headers: { accept: "application/json" } });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(`Provider HTTP ${res.status}`);
  if (body.status === "error") throw new Error("Market data provider rejected the request.");
  return body;
}

async function fetchQuotes(key: string, notes: string[], fetchImpl: FetchFn): Promise<Quote[]> {
  const symbols = STOCKS.map((s) => s.providerSymbol).join(",");
  const body = await getJson(`${API}/quote?symbol=${encodeURIComponent(symbols)}&apikey=${encodeURIComponent(key)}`, fetchImpl);
  const out: Quote[] = [];
  for (const s of STOCKS) {
    const q = body[s.providerSymbol];
    if (!q || q.status === "error") {
      notes.push(`${s.symbol}: no verified quote (${q ? "provider rejected quote" : "missing from response"}).`);
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

export type FxRates = Record<string, { rate: number; time: Date; pair: string }>;

async function fetchFx(key: string, currencies: string[], fetchImpl: FetchFn) {
  const pairs = currencies.filter((c) => c !== "AUD").map((c) => `${c}/AUD`);
  const rates: FxRates = {
    AUD: { rate: 1, time: new Date(), pair: "AUD/AUD" },
  };
  if (!pairs.length) return rates;
  const body = await getJson(`${API}/exchange_rate?symbol=${encodeURIComponent(pairs.join(","))}&apikey=${encodeURIComponent(key)}`, fetchImpl);
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

// Dependencies are injectable so the isolated end-to-end test can run this exact code path against a
// throwaway database. In production they default to the Netlify database and the real provider.
export type CycleDeps = { conn?: any; fetchImpl?: FetchFn; apiKey?: string; now?: () => Date; source?: string };

export async function runCycle(trigger: "schedule" | "dashboard" | "manual" | "test", deps: CycleDeps = {}): Promise<RunResult> {
  const conn = deps.conn ?? db;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const key = deps.apiKey ?? runtimeEnv("TWELVE_DATA_API_KEY");

  return conn.transaction(async (tx: any) => {
    // One refresh at a time across all function instances.
    const lock = trigger === "schedule"
      ? await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY}), true as ok`)
      : await tx.execute(sql`select pg_try_advisory_xact_lock(${LOCK_KEY}) as ok`);
    const lockRows = ((lock as any).rows ?? lock) as Array<{ ok: boolean }>;
    if (!lockRows[0]?.ok) return { ran: false, reason: "Another refresh is in progress." };

    const [last] = await tx.select().from(fetchRuns).orderBy(desc(fetchRuns.startedAt)).limit(1);
    const now = deps.now?.() ?? new Date();
    // Scheduled runs use a shorter throttle so a dashboard-triggered refresh a few minutes earlier
    // never causes the 15-minute schedule to skip a cycle.
    const minGap = trigger === "schedule" ? SCHEDULED_MIN_GAP_MIN : REFRESH_INTERVAL_MIN;
    if (trigger !== "schedule" && last && ageMin(last.startedAt, now) < minGap) {
      return { ran: false, reason: "Prices were refreshed recently.", runId: last.id };
    }

    await tx.insert(account).values({ id: 1, startingCapital: START_CAPITAL, cash: START_CAPITAL }).onConflictDoNothing();
    const [run] = await tx.insert(fetchRuns).values({ trigger, status: "running", startedAt: now }).returning();
    const notes: string[] = [];

    let quotes: Quote[] = [];
    let fx: Awaited<ReturnType<typeof fetchFx>> = {};
    try {
      if (!key) throw new Error("Market data provider is not configured.");
      quotes = await fetchQuotes(key, notes, fetchImpl);
      fx = await fetchFx(key, [...new Set(quotes.map((q) => q.currency))], fetchImpl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const evaluated = await applyMarketData(tx, run.id, [], {}, [msg, ...notes], now, deps.source ?? SOURCE);
      await tx.update(fetchRuns).set({ status: "error", message: msg }).where(eq(fetchRuns.id, run.id));
      return { ...evaluated, status: "error" };
    }

    return applyMarketData(tx, run.id, quotes, fx, notes, deps.now?.() ?? new Date(), deps.source ?? SOURCE);
  });
}

// Stores verified prices, applies the risk rules and persists simulated fills, cash, positions and
// equity for one run. Must be called inside a transaction. The isolated test calls this with test
// quotes inside a transaction that is always rolled back.
export async function applyMarketData(
  tx: any, runId: number, quotes: Quote[], fx: FxRates, notes: string[], now: Date, source: string,
  opts: { tradingEnabled?: boolean } = {},
): Promise<RunResult> {
  const tradingEnabled = opts.tradingEnabled ?? autoTradingEnabled();
  type Priced = Quote & { snapshotId: number; priceAud: number; fxRate: number; fxTime: Date; fxPair: string };
  const priced: Record<string, Priced> = {};
  for (const q of quotes) {
    const r = fx[q.currency];
    if (!r || !Number.isFinite(r.rate) || r.rate <= 0 || !Number.isFinite(q.priceNative) || q.priceNative <= 0 || !Number.isFinite(q.quoteTime.getTime()) || !Number.isFinite(r.time.getTime())) { notes.push(`${q.symbol}: no ${q.currency}/AUD rate, price not recorded.`); continue; }
    const priceAud = q.priceNative * r.rate;
    const [snap] = await tx.insert(priceSnapshots).values({
      runId, symbol: q.symbol, providerSymbol: q.providerSymbol, exchange: q.exchange,
      currency: q.currency, priceNative: q.priceNative, fxPair: r.pair, fxRate: r.rate, fxTime: r.time,
      priceAud, quoteTime: q.quoteTime, marketOpen: q.marketOpen, source, fetchedAt: now,
    }).returning({ id: priceSnapshots.id });
    priced[q.symbol] = { ...q, snapshotId: snap.id, priceAud, fxRate: r.rate, fxTime: r.time, fxPair: r.pair };
  }

  // Latest known AUD price per stock (this run, else the last stored verified price).
  const latest = await latestPrices(tx);
  const [acct] = await tx.select().from(account).where(eq(account.id, 1));
  const posRows = await tx.select().from(positions);
  const shares: Record<string, number> = {};
  const costBasis: Record<string, number> = {};
  for (const p of posRows) { shares[p.symbol] = p.shares; costBasis[p.symbol] = p.costBasisAud; }

  // Duplicate-order guard: a quote that already filled a simulated order (e.g. the provider returns the
  // same quote on two runs) is never traded again. The database also enforces one order per stock per run.
  const usedQuote = new Set<string>();
  const pricedSymbols = Object.keys(priced);
  if (pricedSymbols.length) {
    const minQuote = new Date(Math.min(...pricedSymbols.map((k) => priced[k].quoteTime.getTime())));
    const prior = await tx.select({ symbol: trades.symbol, quoteTime: trades.quoteTime }).from(trades)
      .where(and(inArray(trades.symbol, pricedSymbols), gte(trades.quoteTime, minQuote)));
    for (const t of prior) {
      if (new Date(t.quoteTime).getTime() >= priced[t.symbol].quoteTime.getTime()) usedQuote.add(t.symbol);
    }
  }

  const tradeable: Record<string, { priceAud: number } | { blocked: string }> = {};
  for (const s of STOCKS) {
    const p = priced[s.symbol];
    if (!p) continue;
    const quoteAge = ageMin(p.quoteTime, now);
    tradeable[s.symbol] =
      !tradingEnabled ? { blocked: `${s.symbol}: autonomous paper trading is paused, no simulated trade.` }
      : usedQuote.has(s.symbol) ? { blocked: `${s.symbol}: quote already used for a simulated order, no duplicate trade.` }
      : !p.marketOpen ? { blocked: `${s.symbol}: market closed, no simulated trade.` }
      : quoteAge < -1 || ageMin(p.fxTime, now) < -1 ? { blocked: `${s.symbol}: future-dated quote or FX, no simulated trade.` }
      : quoteAge > MAX_TRADE_QUOTE_AGE_MIN ? { blocked: `${s.symbol}: quote is ${Math.round(quoteAge)} min old, no simulated trade.` }
      : p.currency !== "AUD" && ageMin(p.fxTime, now) > MAX_TRADE_FX_AGE_MIN ? { blocked: `${s.symbol}: FX rate is stale, no simulated trade.` }
      : { priceAud: p.priceAud };
  }

  await tx.insert(riskState).values({ id: 1 }).onConflictDoNothing();
  const [risk] = await tx.select().from(riskState).where(eq(riskState.id, 1));
  // Only current, complete, fresh provider valuations can create or clear an incident.
  const verified = STOCKS.every(s => priced[s.symbol] &&
    ageMin(priced[s.symbol].quoteTime, now) >= -1 &&
    ageMin(priced[s.symbol].quoteTime, now) <= MAX_TRADE_QUOTE_AGE_MIN &&
    ageMin(priced[s.symbol].fxTime, now) >= -1 && ageMin(priced[s.symbol].fxTime, now) <= MAX_TRADE_FX_AGE_MIN);
  const verifiedEquity = acct.cash + STOCKS.reduce((v, s) => v + (shares[s.symbol] ?? 0) * (priced[s.symbol]?.priceAud ?? 0), 0);
  let halted = risk.halted;
  if (verified) {
    halted = verifiedEquity <= BUY_HALT_EQUITY;
    if (halted && !risk.halted) {
      const incidentId = randomUUID();
      await enqueue(tx, `risk:${incidentId}`, 'risk', { title: 'URGENT · Simulated purchases halted', body: `Verified equity A$${verifiedEquity.toFixed(2)} is at or below A$2,500. New simulated BUY orders are halted. ${now.toISOString()}` });
      await tx.update(riskState).set({ halted: true, incidentId }).where(eq(riskState.id, 1));
    } else if (!halted && risk.halted) await tx.update(riskState).set({ halted: false, incidentId: null }).where(eq(riskState.id, 1));
  }
  // Missing/stale held valuations cannot safely authorize any new purchase.
  const heldValuationsFresh = STOCKS.every(s => !(shares[s.symbol] > 0) ||
    (priced[s.symbol] && ageMin(priced[s.symbol].quoteTime, now) >= -1 &&
      ageMin(priced[s.symbol].quoteTime, now) <= MAX_TRADE_QUOTE_AGE_MIN &&
      ageMin(priced[s.symbol].fxTime, now) >= -1 && ageMin(priced[s.symbol].fxTime, now) <= MAX_TRADE_FX_AGE_MIN));
  const evidenceRows = await tx.select().from(investmentEvidence).orderBy(desc(investmentEvidence.id));
  const scores = Object.fromEntries(STOCKS.map(s => [s.symbol, scoreEvidence(
    evidenceRows.find((r: any) => r.symbol === s.symbol && new Date(r.recordedAt) <= now)?.evidence, now)]));
  const planInput = {
    scores,
    symbols: STOCKS.map((s) => s.symbol),
    cash: acct.cash,
    shares,
    costBasis,
    valuationPrices: Object.fromEntries(STOCKS.map((s) => [s.symbol, latest[s.symbol]?.priceAud])),
    tradeable,
    forceBuyHalt: halted || !heldValuationsFresh,
  };
  const plan = planOrders(planInput);
  const evaluation = describeEvaluation(planInput, plan, now,
    Object.fromEntries(STOCKS.map(s => [s.symbol, latest[s.symbol]?.quoteTime ?? null])));
  notes.push(...plan.notes);

  for (const o of plan.orders) {
    const p = priced[o.symbol];
    const [committedTrade] = await tx.insert(trades).values({
      runId, snapshotId: p.snapshotId, executedAt: now, symbol: o.symbol, side: o.side, shares: o.shares,
      priceAud: o.priceAud, valueAud: o.valueAud, priceNative: p.priceNative, currency: p.currency,
      fxRate: p.fxRate, quoteTime: p.quoteTime, rule: o.rule, cashAfter: o.cashAfter, equityAtTrade: o.equityBefore,
    }).returning();
    await enqueue(tx, `trade:${committedTrade.id}`, "trade", tradePayload(committedTrade, acct.startingCapital));
    await tx.insert(positions).values({ symbol: o.symbol, shares: o.sharesAfter, costBasisAud: o.costBasisAfter, updatedAt: now })
      .onConflictDoUpdate({ target: positions.symbol, set: { shares: o.sharesAfter, costBasisAud: o.costBasisAfter, updatedAt: now } });
  }

  await tx.update(account).set({ cash: plan.cash, updatedAt: now }).where(eq(account.id, 1));

  if (!plan.skipped && plan.equity !== null) {
    const e = plan.equity;
    await tx.insert(equitySnapshots).values({
      runId, recordedAt: now, cash: plan.cash, positionsValue: round(e - plan.cash, 2), equity: round(e, 2),
      profitLoss: round(e - acct.startingCapital, 2), buysHalted: halted || e <= BUY_HALT_EQUITY,
    });
  }

  const n = Object.keys(priced).length;
  const status = n === STOCKS.length ? "ok" : n ? "partial" : "error";
  await tx.update(fetchRuns).set({
    status, message: `${n}/${STOCKS.length} verified prices recorded.`, notes, evaluation, finishedAt: new Date(),
  }).where(eq(fetchRuns.id, runId));
  return { ran: true, runId, status, notes };
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
