CREATE UNIQUE INDEX "equity_snapshots_run_uq" ON "equity_snapshots" ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_snapshots_run_symbol_uq" ON "price_snapshots" ("run_id","symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_run_symbol_uq" ON "trades" ("run_id","symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_snapshot_uq" ON "trades" ("snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_symbol_quote_uq" ON "trades" ("symbol","quote_time");