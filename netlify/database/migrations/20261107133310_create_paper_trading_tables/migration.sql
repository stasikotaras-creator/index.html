CREATE TABLE "account" (
	"id" integer PRIMARY KEY,
	"starting_capital" double precision NOT NULL,
	"cash" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equity_snapshots" (
	"id" serial PRIMARY KEY,
	"run_id" integer,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cash" double precision NOT NULL,
	"positions_value" double precision NOT NULL,
	"equity" double precision NOT NULL,
	"profit_loss" double precision NOT NULL,
	"buys_halted" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fetch_runs" (
	"id" serial PRIMARY KEY,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"message" text,
	"notes" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"symbol" text PRIMARY KEY,
	"shares" double precision DEFAULT 0 NOT NULL,
	"cost_basis_aud" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" serial PRIMARY KEY,
	"run_id" integer,
	"symbol" text NOT NULL,
	"provider_symbol" text NOT NULL,
	"exchange" text NOT NULL,
	"currency" text NOT NULL,
	"price_native" double precision NOT NULL,
	"fx_pair" text NOT NULL,
	"fx_rate" double precision NOT NULL,
	"fx_time" timestamp with time zone NOT NULL,
	"price_aud" double precision NOT NULL,
	"quote_time" timestamp with time zone NOT NULL,
	"market_open" boolean NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY,
	"run_id" integer,
	"snapshot_id" integer,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"shares" double precision NOT NULL,
	"price_aud" double precision NOT NULL,
	"value_aud" double precision NOT NULL,
	"price_native" double precision NOT NULL,
	"currency" text NOT NULL,
	"fx_rate" double precision NOT NULL,
	"quote_time" timestamp with time zone NOT NULL,
	"rule" text NOT NULL,
	"cash_after" double precision NOT NULL,
	"equity_at_trade" double precision NOT NULL
);
--> statement-breakpoint
CREATE INDEX "equity_snapshots_recorded_idx" ON "equity_snapshots" ("recorded_at");--> statement-breakpoint
CREATE INDEX "fetch_runs_started_idx" ON "fetch_runs" ("started_at");--> statement-breakpoint
CREATE INDEX "price_snapshots_symbol_idx" ON "price_snapshots" ("symbol","fetched_at");--> statement-breakpoint
ALTER TABLE "equity_snapshots" ADD CONSTRAINT "equity_snapshots_run_id_fetch_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "fetch_runs"("id");--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_run_id_fetch_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "fetch_runs"("id");--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_run_id_fetch_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "fetch_runs"("id");--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_snapshot_id_price_snapshots_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "price_snapshots"("id");