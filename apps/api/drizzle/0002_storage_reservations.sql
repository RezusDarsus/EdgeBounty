ALTER TABLE "uploads" ADD COLUMN "category" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
CREATE INDEX "uploads_account_open" ON "uploads" USING btree ("account_id","status");--> statement-breakpoint
-- backfill: uploads into bounty submissions / evidence / failure examples / verification inputs are escrow-funded workflow storage
UPDATE "uploads" SET "category" = 'workflow' FROM "asset_versions" v JOIN "assets" a ON a."id" = v."asset_id" WHERE v."id" = "uploads"."version_id" AND a."purpose" IN ('submission', 'evidence', 'failure_example', 'verification');
