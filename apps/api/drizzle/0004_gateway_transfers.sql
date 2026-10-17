CREATE TABLE "gateway_transfers" (
  "id" uuid PRIMARY KEY NOT NULL,
  "entitlement_id" uuid,
  "bytes" bigint NOT NULL,
  "status" text DEFAULT 'reserved' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
