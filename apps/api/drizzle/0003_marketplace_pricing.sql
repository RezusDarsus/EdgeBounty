CREATE TABLE "checkout_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"listing_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"asset_version_id" uuid NOT NULL,
	"months" integer NOT NULL,
	"pricing_version" text NOT NULL,
	"sol_usd_micro" bigint NOT NULL,
	"object_bytes" bigint NOT NULL,
	"access_starts_at" timestamp with time zone NOT NULL,
	"access_ends_at" timestamp with time zone NOT NULL,
	"hosting_gaps" jsonb NOT NULL,
	"allowance_bytes" bigint NOT NULL,
	"price_micro" bigint NOT NULL,
	"hosting_micro" bigint NOT NULL,
	"downloads_micro" bigint NOT NULL,
	"minimum_fee_micro" bigint NOT NULL,
	"extras_micro" bigint NOT NULL,
	"hosting_usd_micro" bigint NOT NULL,
	"invoice_id" uuid,
	"status" text DEFAULT 'awaiting_payment' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "checkout_quotes_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "cost_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"provider" text NOT NULL,
	"quantity" bigint NOT NULL,
	"unit" text NOT NULL,
	"usd_micro" bigint NOT NULL,
	"estimated" boolean NOT NULL,
	"note" text,
	"subject_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hosting_coverage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_version_id" uuid NOT NULL,
	"source" text NOT NULL,
	"payer_id" uuid NOT NULL,
	"bytes" bigint NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"amount_micro" bigint DEFAULT 0 NOT NULL,
	"usd_micro" bigint DEFAULT 0 NOT NULL,
	"invoice_id" uuid,
	"checkout_quote_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_version_id" uuid NOT NULL,
	"spec_hash" text NOT NULL,
	"policy_version" text NOT NULL,
	"job_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"result_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "delivery_entitlements" ADD COLUMN "access_starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_entitlements" ADD COLUMN "access_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_entitlements" ADD COLUMN "allowance_bytes" bigint;--> statement-breakpoint
ALTER TABLE "delivery_entitlements" ADD COLUMN "extra_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_entitlements" ADD COLUMN "bytes_served" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_entitlements" ADD COLUMN "checkout_quote_id" uuid;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD COLUMN "bytes" bigint;--> statement-breakpoint
ALTER TABLE "verification_jobs" ADD COLUMN "policy_version" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_results" ADD COLUMN "reused_from_job_id" uuid;--> statement-breakpoint
CREATE INDEX "cost_events_category_time" ON "cost_events" USING btree ("category","created_at");--> statement-breakpoint
CREATE INDEX "hosting_coverage_version" ON "hosting_coverage" USING btree ("asset_version_id","ends_at");--> statement-breakpoint
CREATE INDEX "hosting_coverage_payer" ON "hosting_coverage" USING btree ("payer_id","source");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_runs_key" ON "verification_runs" USING btree ("asset_version_id","spec_hash","policy_version");