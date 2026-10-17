CREATE TABLE "delivery_envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"buyer_box_public_key" text NOT NULL,
	"envelope" text,
	"seller_box_public_key" text,
	"nonce" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "delivery_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_version_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"scheme" text NOT NULL,
	"params" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_keys_asset_version_id_unique" UNIQUE("asset_version_id")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "group_kind" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "group_index" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "designated_seller" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "arbitrator_wallet" text;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_envelopes_order" ON "delivery_envelopes" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_group" ON "orders" USING btree ("group_id");