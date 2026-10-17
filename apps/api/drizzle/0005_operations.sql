CREATE TABLE notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL,
 dedupe_key text NOT NULL UNIQUE, title text NOT NULL, message text NOT NULL, href text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz
);
--> statement-breakpoint
CREATE INDEX notifications_account_created ON notifications(account_id, created_at);
--> statement-breakpoint
CREATE TABLE operation_counters (key text PRIMARY KEY, count bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());
