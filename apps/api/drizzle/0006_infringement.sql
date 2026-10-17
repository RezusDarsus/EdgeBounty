CREATE TABLE infringement_reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid NOT NULL, listing_id uuid NOT NULL, reason text NOT NULL, evidence_url text NOT NULL, status text NOT NULL DEFAULT 'open', resolution text, created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz);
--> statement-breakpoint
CREATE INDEX infringement_reports_listing ON infringement_reports(listing_id);
