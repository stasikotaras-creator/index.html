CREATE TABLE "investment_evidence" (
	"id" serial PRIMARY KEY,
	"symbol" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
