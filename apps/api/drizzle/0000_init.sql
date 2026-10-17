CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet" text NOT NULL,
	"alias" text NOT NULL,
	"mode" text DEFAULT 'pseudonymous' NOT NULL,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "accounts_wallet_unique" UNIQUE("wallet")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "asset_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"path" text NOT NULL,
	"size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"media_type" text NOT NULL,
	"object_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"manifest" jsonb,
	"salt" text,
	"commitment" text,
	"total_size" bigint DEFAULT 0 NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preview_status" text DEFAULT 'none' NOT NULL,
	"preview" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"purpose" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attestations" (
	"address" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"verifier" text NOT NULL,
	"asset_commitment" text NOT NULL,
	"spec_hash" text NOT NULL,
	"result_hash" text NOT NULL,
	"passed" boolean NOT NULL,
	"revoked" boolean NOT NULL,
	"issued_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_wallet" text,
	"action" text NOT NULL,
	"target" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "benchmarks" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"task" text NOT NULL,
	"description" text NOT NULL,
	"license" text NOT NULL,
	"methodology" text NOT NULL,
	"asset_version_id" uuid,
	"owner_id" uuid,
	"private" boolean DEFAULT false NOT NULL,
	"input_spec" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_micro" bigint NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"buyer_wallet" text NOT NULL,
	"asset_version_id" uuid NOT NULL,
	"license_receipt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "delivery_entitlements_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "delivery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"opened_by_wallet" text NOT NULL,
	"reason" text NOT NULL,
	"reason_hash" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"resolution" text,
	"seller_bps" integer,
	"resolver_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "failure_bounties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"creator_wallet" text NOT NULL,
	"bounty_id_onchain" bigint NOT NULL,
	"onchain_address" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"spec" jsonb NOT NULL,
	"spec_hash" text NOT NULL,
	"terms_hash" text NOT NULL,
	"model_asset_version_id" uuid,
	"model_commitment" text NOT NULL,
	"reward_micro" bigint NOT NULL,
	"verifier_fee_micro" bigint NOT NULL,
	"max_examples" integer NOT NULL,
	"max_evaluations" integer NOT NULL,
	"verifier_wallet" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"chain" jsonb,
	"chain_state" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "failure_bounties_onchain_address_unique" UNIQUE("onchain_address")
);
--> statement-breakpoint
CREATE TABLE "failure_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bounty_id" uuid NOT NULL,
	"contributor_id" uuid NOT NULL,
	"contributor_wallet" text NOT NULL,
	"asset_version_id" uuid NOT NULL,
	"commitment" text NOT NULL,
	"onchain_address" text NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"report" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "failure_examples_onchain_address_unique" UNIQUE("onchain_address")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reference" text NOT NULL,
	"amount_micro" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"receipt_address" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "invoices_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "licenses" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"text" text NOT NULL,
	"hash" text NOT NULL,
	"commercial" boolean NOT NULL,
	"redistribution" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"seller_wallet" text NOT NULL,
	"asset_id" uuid NOT NULL,
	"asset_version_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"formats" text[] DEFAULT '{}'::text[] NOT NULL,
	"record_count" integer,
	"language" text,
	"labeling" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"license_id" text NOT NULL,
	"license_hash" text NOT NULL,
	"terms" jsonb NOT NULL,
	"terms_hash" text NOT NULL,
	"price_micro" bigint NOT NULL,
	"listing_id_onchain" bigint NOT NULL,
	"onchain_address" text NOT NULL,
	"onchain_version" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"certificate_attestation" text,
	"sales" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "listings_onchain_address_unique" UNIQUE("onchain_address")
);
--> statement-breakpoint
CREATE TABLE "onchain_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signature" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text,
	"wallet" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onchain_transactions_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"buyer_id" uuid NOT NULL,
	"buyer_wallet" text NOT NULL,
	"seller_id" uuid,
	"seller_wallet" text,
	"listing_id" uuid,
	"order_id_onchain" bigint NOT NULL,
	"onchain_address" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text,
	"terms" jsonb NOT NULL,
	"terms_hash" text NOT NULL,
	"criteria" jsonb,
	"criteria_hash" text NOT NULL,
	"license_id" text NOT NULL,
	"license_hash" text NOT NULL,
	"amount_micro" bigint NOT NULL,
	"verifier_wallet" text,
	"verifier_fee_micro" bigint DEFAULT 0 NOT NULL,
	"deadline" timestamp with time zone,
	"max_corrections" integer DEFAULT 0 NOT NULL,
	"public" boolean DEFAULT true NOT NULL,
	"chain_state" text DEFAULT 'draft' NOT NULL,
	"chain" jsonb,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_onchain_address_unique" UNIQUE("onchain_address")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"organization" text,
	"bio" text,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verified_business" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "provider_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"requester_wallet" text NOT NULL,
	"job_id_onchain" bigint NOT NULL,
	"onchain_address" text NOT NULL,
	"asset_version_id" uuid NOT NULL,
	"spec" jsonb NOT NULL,
	"spec_hash" text NOT NULL,
	"price_micro" bigint NOT NULL,
	"provider_wallet" text,
	"required_capability" integer NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"report" jsonb,
	"report_hash" text,
	"chain_state" text DEFAULT 'draft' NOT NULL,
	"chain" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_jobs_onchain_address_unique" UNIQUE("onchain_address")
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"wallet" text PRIMARY KEY NOT NULL,
	"account_id" uuid,
	"profile" jsonb,
	"metadata_hash" text,
	"approved" boolean DEFAULT false NOT NULL,
	"capabilities" integer DEFAULT 0 NOT NULL,
	"requested_capabilities" integer DEFAULT 0 NOT NULL,
	"jobs_completed" integer DEFAULT 0 NOT NULL,
	"jobs_disputed" integer DEFAULT 0 NOT NULL,
	"onchain_address" text,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"gb" integer NOT NULL,
	"term_days" integer NOT NULL,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"invoice_id" uuid,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"grace_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"asset_version_id" uuid NOT NULL,
	"commitment" text NOT NULL,
	"onchain_address" text,
	"status" text DEFAULT 'prepared' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"path" text NOT NULL,
	"size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"media_type" text NOT NULL,
	"part_size" integer NOT NULL,
	"parts_total" integer NOT NULL,
	"parts_received" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"object_key" text NOT NULL,
	"s3_upload_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"order_id" uuid,
	"submission_index" integer,
	"asset_version_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"provider_wallet" text,
	"level" text NOT NULL,
	"criteria" jsonb,
	"benchmark_id" text,
	"spec_hash" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"quote_micro" bigint DEFAULT 0 NOT NULL,
	"budget" jsonb NOT NULL,
	"actual_cost_micro" bigint DEFAULT 0 NOT NULL,
	"onchain_job_address" text,
	"invoice_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"error" text,
	"publish_onchain" boolean DEFAULT false NOT NULL,
	"audit_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "verification_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"report" jsonb NOT NULL,
	"report_hash" text NOT NULL,
	"passed" boolean NOT NULL,
	"attestation_address" text,
	"tx_signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_results_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_files_version_path" ON "asset_files" USING btree ("version_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_versions_asset_version" ON "asset_versions" USING btree ("asset_id","version");--> statement-breakpoint
CREATE INDEX "listings_status_kind" ON "listings" USING btree ("status","kind");--> statement-breakpoint
CREATE INDEX "orders_chain_state" ON "orders" USING btree ("chain_state");--> statement-breakpoint
CREATE INDEX "orders_buyer" ON "orders" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "orders_seller" ON "orders" USING btree ("seller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_order_reviewer" ON "reviews" USING btree ("order_id","reviewer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_order_index" ON "submissions" USING btree ("order_id","index");--> statement-breakpoint
CREATE INDEX "verification_jobs_status" ON "verification_jobs" USING btree ("status");