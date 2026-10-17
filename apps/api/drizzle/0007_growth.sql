CREATE INDEX listings_search ON listings USING gin ((setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', description), 'B') || setweight(to_tsvector('english', category), 'C')));
--> statement-breakpoint
CREATE TABLE collections (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL, title text NOT NULL, description text NOT NULL DEFAULT '', public boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE INDEX collections_owner ON collections(owner_id);
--> statement-breakpoint
CREATE TABLE collection_items (collection_id uuid NOT NULL, listing_id uuid NOT NULL, note text NOT NULL DEFAULT '', added_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (collection_id, listing_id));
--> statement-breakpoint
CREATE TABLE listing_views (listing_id uuid NOT NULL, day date NOT NULL, views integer NOT NULL DEFAULT 0, PRIMARY KEY (listing_id, day));
