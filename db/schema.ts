import {
  pgTable, serial, text, timestamp, integer, doublePrecision, boolean, jsonb, index, uniqueIndex,
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
  evaluation: jsonb().$type<import("../lib/evaluation.js").TradingEvaluation>(),
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
}, (t) => [
  index("price_snapshots_symbol_idx").on(t.symbol, t.fetchedAt),
  // One verified price per stock per run.
  uniqueIndex("price_snapshots_run_symbol_uq").on(t.runId, t.symbol),
]);

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
}, (t) => [
  // Duplicate-order guards enforced by the database itself:
  // at most one simulated order per stock per run, and each verified price fills at most one order.
  uniqueIndex("trades_run_symbol_uq").on(t.runId, t.symbol),
  uniqueIndex("trades_snapshot_uq").on(t.snapshotId),
  // ...and a given market quote can fill at most one order for that stock, even across concurrent runs.
  uniqueIndex("trades_symbol_quote_uq").on(t.symbol, t.quoteTime),
]);

export const equitySnapshots = pgTable("equity_snapshots", {
  id: serial().primaryKey(),
  runId: integer("run_id").references(() => fetchRuns.id),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  cash: doublePrecision().notNull(),
  positionsValue: doublePrecision("positions_value").notNull(),
  equity: doublePrecision().notNull(),
  profitLoss: doublePrecision("profit_loss").notNull(),
  buysHalted: boolean("buys_halted").notNull(),
}, (t) => [
  index("equity_snapshots_recorded_idx").on(t.recordedAt),
  uniqueIndex("equity_snapshots_run_uq").on(t.runId),
]);

// Server-only VAPID material; never returned by dashboard/history queries.
export const pushConfig = pgTable("push_config", {
  id: integer().primaryKey(), publicKey: text("public_key").notNull(), privateKey: text("private_key").notNull(),
});
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: text().primaryKey(), ownerId: text("owner_id").notNull(), endpoint: text().notNull().unique(),
  subscription: jsonb().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const notificationOutbox = pgTable("notification_outbox", {
  id: text().primaryKey(), kind: text().notNull(), payload: jsonb().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const notificationDeliveries = pgTable("notification_deliveries", {
  eventId: text("event_id").notNull().references(() => notificationOutbox.id),
  subscriptionId: text("subscription_id").notNull().references(() => pushSubscriptions.id, { onDelete: "cascade" }),
  attempts: integer().notNull().default(0), status: text().notNull().default("pending"),
  nextAttempt: timestamp("next_attempt", { withTimezone: true }).defaultNow().notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
}, t => [uniqueIndex("notification_delivery_uq").on(t.eventId, t.subscriptionId)]);
export const riskState = pgTable("risk_state", {
  id: integer().primaryKey(), incidentId: text("incident_id"), halted: boolean().notNull().default(false),
});

// Append-only, source-verified evidence captured before use; no fabricated defaults.
export const investmentEvidence = pgTable("investment_evidence", {
  id: serial().primaryKey(), symbol: text().notNull(),
  evidence: jsonb().$type<import("../lib/scoring.js").Evidence>().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
});
