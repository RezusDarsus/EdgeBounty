CREATE TABLE agent_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL,
 request_hash text NOT NULL, mode text NOT NULL, status text NOT NULL DEFAULT 'running',
 response jsonb, input_tokens integer, output_tokens integer,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX agent_requests_account_hash ON agent_requests(account_id, request_hash);
--> statement-breakpoint
CREATE INDEX agent_requests_created ON agent_requests(created_at);
