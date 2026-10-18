CREATE TABLE collaborative_bounties (
 bounty_id uuid PRIMARY KEY REFERENCES orders(id), target integer NOT NULL CHECK(target > 0),
 claim_ttl_seconds integer NOT NULL DEFAULT 86400 CHECK(claim_ttl_seconds BETWEEN 60 AND 604800),
 near_threshold integer NOT NULL DEFAULT 6 CHECK(near_threshold BETWEEN 0 AND 16),
 revision integer NOT NULL DEFAULT 0, manifest jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE bounty_collaborators (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bounty_id uuid NOT NULL REFERENCES collaborative_bounties(bounty_id),
 user_id uuid NOT NULL REFERENCES accounts(id), status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','left')),
 joined_at timestamptz NOT NULL DEFAULT now(), UNIQUE(bounty_id,user_id)
);
--> statement-breakpoint
CREATE TABLE seller_agents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bounty_id uuid NOT NULL REFERENCES collaborative_bounties(bounty_id),
 owner_user_id uuid NOT NULL REFERENCES accounts(id), status text NOT NULL DEFAULT 'observing',
 configuration jsonb NOT NULL DEFAULT '{"actions":["read_summary","propose_work","explain"],"provider":"deterministic"}',
 UNIQUE(bounty_id,owner_user_id)
);
--> statement-breakpoint
CREATE TABLE collaboration_events (
 sequence bigserial PRIMARY KEY, id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 bounty_id uuid NOT NULL REFERENCES collaborative_bounties(bounty_id), agent_id uuid REFERENCES seller_agents(id),
 actor_user_id uuid REFERENCES accounts(id), event_type text NOT NULL, payload jsonb NOT NULL,
 correlation_id uuid NOT NULL, idempotency_key text NOT NULL, processing_status text NOT NULL DEFAULT 'processed',
 visibility text NOT NULL DEFAULT 'workspace' CHECK(visibility IN ('workspace','owner')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(bounty_id,idempotency_key)
);
--> statement-breakpoint
CREATE INDEX collaboration_events_cursor ON collaboration_events(bounty_id,sequence);
--> statement-breakpoint
CREATE TABLE contribution_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bounty_id uuid NOT NULL REFERENCES collaborative_bounties(bounty_id),
 user_id uuid NOT NULL REFERENCES accounts(id), proposed_count integer NOT NULL CHECK(proposed_count>0),
 reserved_count integer NOT NULL CHECK(reserved_count>=0), accepted_count integer NOT NULL DEFAULT 0 CHECK(accepted_count>=0),
 status text NOT NULL CHECK(status IN ('active','released','expired','fulfilled')), expires_at timestamptz NOT NULL,
 idempotency_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(bounty_id,user_id,idempotency_key), CHECK(accepted_count<=reserved_count)
);
--> statement-breakpoint
CREATE INDEX contribution_claims_active ON contribution_claims(bounty_id,status,expires_at);
--> statement-breakpoint
CREATE TABLE agent_proposals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bounty_id uuid NOT NULL REFERENCES collaborative_bounties(bounty_id),
 agent_id uuid NOT NULL REFERENCES seller_agents(id), user_id uuid NOT NULL REFERENCES accounts(id),
 proposal_type text NOT NULL, proposed_count integer NOT NULL CHECK(proposed_count>0),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
 approved_by uuid REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
 source_key text NOT NULL, UNIQUE(bounty_id,agent_id,source_key)
);
--> statement-breakpoint
CREATE TABLE collaboration_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bounty_id uuid NOT NULL REFERENCES collaborative_bounties(bounty_id),
 contributor_id uuid NOT NULL REFERENCES accounts(id), asset_version_id uuid NOT NULL REFERENCES asset_versions(id),
 verification_job_id uuid NOT NULL REFERENCES verification_jobs(id), license_declaration text NOT NULL,
 status text NOT NULL DEFAULT 'pending', review_access_granted boolean NOT NULL DEFAULT false, review_access_updated_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(bounty_id,asset_version_id)
);
--> statement-breakpoint
CREATE TABLE submission_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bounty_id uuid NOT NULL REFERENCES collaborative_bounties(bounty_id),
 submission_id uuid NOT NULL REFERENCES collaboration_submissions(id), contributor_id uuid NOT NULL REFERENCES accounts(id),
 file_path text NOT NULL, exact_hash text NOT NULL CHECK(exact_hash ~ '^[0-9a-f]{64}$'), perceptual_hash text,
 verification_status text NOT NULL CHECK(verification_status IN ('pending','review','accepted','duplicate','rejected','invalidated')),
 duplicate_reference uuid REFERENCES submission_items(id), verification_version text NOT NULL, accepted_at timestamptz,
 UNIQUE(submission_id,file_path)
);
--> statement-breakpoint
CREATE UNIQUE INDEX submission_items_unique_accepted ON submission_items(bounty_id,exact_hash) WHERE verification_status='accepted';
--> statement-breakpoint
CREATE INDEX submission_items_progress ON submission_items(bounty_id,verification_status,contributor_id);
--> statement-breakpoint
CREATE TABLE collaboration_verifier_evidence (
 job_id uuid PRIMARY KEY REFERENCES verification_jobs(id), asset_version_id uuid NOT NULL REFERENCES asset_versions(id),
 evidence jsonb NOT NULL, complete boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX collaboration_evidence_version ON collaboration_verifier_evidence(asset_version_id);
--> statement-breakpoint
CREATE TABLE collaboration_invitations (
 bounty_id uuid NOT NULL REFERENCES collaborative_bounties(bounty_id), user_id uuid NOT NULL REFERENCES accounts(id),
 invited_by uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(bounty_id,user_id)
);
--> statement-breakpoint
CREATE TABLE collaboration_settlements (
 bounty_id uuid NOT NULL REFERENCES collaborative_bounties(bounty_id), contributor_id uuid NOT NULL REFERENCES accounts(id),
 order_id uuid NOT NULL UNIQUE REFERENCES orders(id), manifest_hash text NOT NULL,
 gross_micro bigint NOT NULL CHECK(gross_micro>0), expected_count integer NOT NULL CHECK(expected_count>0),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(bounty_id,contributor_id)
);
