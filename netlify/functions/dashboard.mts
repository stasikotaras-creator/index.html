import type { Config, Context } from "@netlify/functions";
import { desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import { account, positions, trades, equitySnapshots, fetchRuns, riskState } from "../../db/schema.js";
import {
  STOCKS, START_CAPITAL, MAX_ALLOCATION, TARGET_ALLOCATION, MIN_CASH_RESERVE, BUY_HALT_EQUITY,
  REFRESH_INTERVAL_MIN, SCHEDULE_CRON, latestPrices, autoTradingEnabled, runtimeEnv,
} from "../../lib/simulation.js";

export default async (req: Request, context: Context) => {
  try {
    return await buildDashboard(req, (context as any)?.deploy?.context ?? null);
  } catch (err) {
    console.error("dashboard failed", err);
    return Response.json(
      { error: "unavailable", message: "Portfolio database is temporarily unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
};

async function buildDashboard(req: Request, deployContext: string | null) {
  const full = new URL(req.url).searchParams.get("full") === "1";
  const [acctRows, posRows, prices, tradeRows, history, runs, okRuns, schedRuns] = await Promise.all([
    db.select().from(account).limit(1),
    db.select().from(positions),
    latestPrices(),
    // Every simulated trade is returned so the ledger and per-stock P/L are complete.
    db.select().from(trades).orderBy(desc(trades.executedAt), desc(trades.id)),
    db.select().from(equitySnapshots).orderBy(desc(equitySnapshots.recordedAt)).limit(full ? 100000 : 400),
    db.select().from(fetchRuns).orderBy(desc(fetchRuns.startedAt)).limit(1),
    db.select().from(fetchRuns).where(inArray(fetchRuns.status, ["ok", "partial"]))
      .orderBy(desc(fetchRuns.startedAt)).limit(1),
    db.select().from(fetchRuns).where(eq(fetchRuns.trigger, "schedule")).orderBy(desc(fetchRuns.startedAt)).limit(1),
  ]);
  const [lastEvaluated] = await db.select().from(fetchRuns).where(isNotNull(fetchRuns.evaluation)).orderBy(desc(fetchRuns.startedAt)).limit(1);
  const [risk] = await db.select().from(riskState).where(eq(riskState.id, 1));
  const quoteTimes = Object.values(prices).map((p) => p.quoteTime).sort();
  const fetchTimes = Object.values(prices).map((p) => p.fetchedAt).sort();
  const acct = acctRows[0];
  const cash = acct?.cash ?? START_CAPITAL;
  const shares: Record<string, number> = {};
  for (const p of posRows) shares[p.symbol] = p.shares;
  const positionsValue = STOCKS.reduce((s, st) => s + (shares[st.symbol] ?? 0) * (prices[st.symbol]?.priceAud ?? 0), 0);
  const equity = cash + positionsValue;

  return Response.json({
    serverTime: new Date().toISOString(),
    initialized: Boolean(acct),
    providerConfigured: Boolean(runtimeEnv("TWELVE_DATA_API_KEY")),
    autoTrading: autoTradingEnabled(),
    deployContext,
    rules: {
      startCapital: START_CAPITAL, maxAllocation: MAX_ALLOCATION, targetAllocation: TARGET_ALLOCATION,
      minCashReserve: MIN_CASH_RESERVE, buyHaltEquity: BUY_HALT_EQUITY, refreshIntervalMin: REFRESH_INTERVAL_MIN,
    },
    account: { cash, startingCapital: acct?.startingCapital ?? START_CAPITAL, equity, positionsValue,
      profitLoss: equity - (acct?.startingCapital ?? START_CAPITAL), buysHalted: Boolean(risk?.halted) || equity <= BUY_HALT_EQUITY },
    stocks: STOCKS.map((s) => ({ ...s, shares: shares[s.symbol] ?? 0,
      costBasisAud: posRows.find((p) => p.symbol === s.symbol)?.costBasisAud ?? 0, price: prices[s.symbol] ?? null })),
    trades: tradeRows,
    equityHistory: history.reverse(),
    lastTradingEvaluation: lastEvaluated?.evaluation ?? null,
    evaluationRun: lastEvaluated ? { id: lastEvaluated.id, trigger: lastEvaluated.trigger } : null,
    evaluationUnavailableReason: runs[0]?.evaluation ? null : "This refresh has no persisted trading evaluation. Historical HOLD decisions were not recorded; the next completed trading cycle records all five decisions.",
    lastRun: runs[0] ?? null,
    lastSuccessfulRun: okRuns[0] ?? null,
    lastScheduledRun: schedRuns[0] ?? null,
    schedule: { cron: SCHEDULE_CRON, description: "Every 15 minutes, Monday to Friday (UTC)" },
    marketData: {
      source: Object.values(prices)[0]?.source ?? null,
      latestQuoteTime: quoteTimes.at(-1) ?? null,
      latestFetchedAt: fetchTimes.at(-1) ?? null,
      pricedSymbols: Object.keys(prices).length,
    },
    realMoneyTrading: false,
  }, { headers: { "cache-control": "no-store" } });
}

export const config: Config = { path: "/api/dashboard", method: "GET" };
