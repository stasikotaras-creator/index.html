import {
  pgTable, serial, text, timestamp, integer, doublePrecision, boolean, jsonb, index,
} from "drizzle-orm/pg-core";

// Single paper-trading account (id = 1). Cash is virtual AUD.
export const account = pgTable("account", {
  id: integer().primaryKey(),
  startingCapital: doublePrecision("starting_capital").notNull(),
  cash: doublePrecision().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const positions = pgTable("positions", {
  symbol: text().primaryKey(),
  shares: doublePrecision().notNull().default(0),
  costBasisAud: doublePrecision("cost_basis_aud").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// One row per scheduled / dashboard-triggered price refresh.
export const fetchRuns = pgTable("fetch_runs", {
  id: serial().primaryKey(),
  trigger: text().notNull(),
  status: text().notNull(),
  message: text(),
  notes: jsonb().$type<string[]>(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [index("fetch_runs_started_idx").on(t.startedAt)]);

// Verified quotes from the market data provider, converted to AUD.
export const priceSnapshots = pgTable("price_snapshots", {
  id: serial().primaryKey(),
  runId: integer("run_id").references(() => fetchRuns.id),
  symbol: text().notNull(),
  providerSymbol: text("provider_symbol").notNull(),
  exchange: text().notNull(),
  currency: text().notNull(),
  priceNative: doublePrecision("price_native").notNull(),
  fxPair: text("fx_pair").notNull(),
  fxRate: doublePrecision("fx_rate").notNull(),
  fxTime: timestamp("fx_time", { withTimezone: true }).notNull(),
  priceAud: doublePrecision("price_aud").notNull(),
  quoteTime: timestamp("quote_time", { withTimezone: true }).notNull(),
  marketOpen: boolean("market_open").notNull(),
  source: text().notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("price_snapshots_symbol_idx").on(t.symbol, t.fetchedAt)]);

export const trades = pgTable("trades", {
  id: serial().primaryKey(),
  runId: integer("run_id").references(() => fetchRuns.id),
  snapshotId: integer("snapshot_id").references(() => priceSnapshots.id),
  executedAt: timestamp("executed_at", { withTimezone: true }).defaultNow().notNull(),
  symbol: text().notNull(),
  side: text().notNull(),
  shares: doublePrecision().notNull(),
  priceAud: doublePrecision("price_aud").notNull(),
  valueAud: doublePrecision("value_aud").notNull(),
  priceNative: doublePrecision("price_native").notNull(),
  currency: text().notNull(),
  fxRate: doublePrecision("fx_rate").notNull(),
  quoteTime: timestamp("quote_time", { withTimezone: true }).notNull(),
  rule: text().notNull(),
  cashAfter: doublePrecision("cash_after").notNull(),
  equityAtTrade: doublePrecision("equity_at_trade").notNull(),
});

export const equitySnapshots = pgTable("equity_snapshots", {
  id: serial().primaryKey(),
  runId: integer("run_id").references(() => fetchRuns.id),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  cash: doublePrecision().notNull(),
  positionsValue: doublePrecision("positions_value").notNull(),
  equity: doublePrecision().notNull(),
  profitLoss: doublePrecision("profit_loss").notNull(),
  buysHalted: boolean("buys_halted").notNull(),
}, (t) => [index("equity_snapshots_recorded_idx").on(t.recordedAt)]);
