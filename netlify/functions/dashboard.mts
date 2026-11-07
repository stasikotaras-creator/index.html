import type { Config } from "@netlify/functions";
import { desc, asc } from "drizzle-orm";
import { db } from "../../db/index.js";
import { account, positions, trades, equitySnapshots, fetchRuns } from "../../db/schema.js";
import {
  STOCKS, START_CAPITAL, MAX_ALLOCATION, TARGET_ALLOCATION, MIN_CASH_RESERVE, BUY_HALT_EQUITY,
  REFRESH_INTERVAL_MIN, latestPrices,
} from "../../lib/simulation.js";

export default async (req: Request) => {
  const full = new URL(req.url).searchParams.get("full") === "1";
  const [acctRows, posRows, prices, tradeRows, history, runs] = await Promise.all([
    db.select().from(account).limit(1),
    db.select().from(positions),
    latestPrices(),
    db.select().from(trades).orderBy(desc(trades.executedAt), desc(trades.id)).limit(full ? 100000 : 300),
    db.select().from(equitySnapshots).orderBy(desc(equitySnapshots.recordedAt)).limit(full ? 100000 : 400),
    db.select().from(fetchRuns).orderBy(desc(fetchRuns.startedAt)).limit(1),
  ]);
  const acct = acctRows[0];
  const cash = acct?.cash ?? START_CAPITAL;
  const shares: Record<string, number> = {};
  for (const p of posRows) shares[p.symbol] = p.shares;
  const positionsValue = STOCKS.reduce((s, st) => s + (shares[st.symbol] ?? 0) * (prices[st.symbol]?.priceAud ?? 0), 0);
  const equity = cash + positionsValue;

  return Response.json({
    serverTime: new Date().toISOString(),
    initialized: Boolean(acct),
    providerConfigured: Boolean(process.env.TWELVE_DATA_API_KEY),
    rules: {
      startCapital: START_CAPITAL, maxAllocation: MAX_ALLOCATION, targetAllocation: TARGET_ALLOCATION,
      minCashReserve: MIN_CASH_RESERVE, buyHaltEquity: BUY_HALT_EQUITY, refreshIntervalMin: REFRESH_INTERVAL_MIN,
    },
    account: { cash, startingCapital: acct?.startingCapital ?? START_CAPITAL, equity, positionsValue,
      profitLoss: equity - (acct?.startingCapital ?? START_CAPITAL), buysHalted: equity <= BUY_HALT_EQUITY },
    stocks: STOCKS.map((s) => ({ ...s, shares: shares[s.symbol] ?? 0,
      costBasisAud: posRows.find((p) => p.symbol === s.symbol)?.costBasisAud ?? 0, price: prices[s.symbol] ?? null })),
    trades: tradeRows,
    equityHistory: history.reverse(),
    lastRun: runs[0] ?? null,
  }, { headers: { "cache-control": "no-store" } });
};

export const config: Config = { path: "/api/dashboard", method: "GET" };
