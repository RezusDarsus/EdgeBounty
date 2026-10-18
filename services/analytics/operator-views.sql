-- Restricted operator views: no wallets, prompts, file paths, object keys or raw errors.
CREATE OR REPLACE VIEW analytics_operator_accounts AS
 SELECT id,created_at,last_login_at,deleted_at,roles,
 EXISTS(SELECT 1 FROM orders o WHERE o.buyer_id=a.id) AS buyer,
 EXISTS(SELECT 1 FROM listings l WHERE l.seller_id=a.id) AS seller,
 EXISTS(SELECT 1 FROM providers p WHERE p.account_id=a.id) AS verifier FROM accounts a;
CREATE OR REPLACE VIEW analytics_operator_orders AS SELECT id,kind,amount_micro,verifier_fee_micro,chain_state,onchain_address,group_id,group_kind,created_at,synced_at,
 jsonb_build_object('amount',chain->'amount','verifierFee',chain->'verifierFee','sellerBps',chain->'sellerBps','feeBps',chain->'feeBps','closedAt',chain->'closedAt','fundedAt',chain->'fundedAt','verificationsDone',chain->'verificationsDone') AS chain FROM orders;
CREATE OR REPLACE VIEW analytics_operator_transactions AS SELECT signature,kind,subject,status,created_at FROM onchain_transactions;
CREATE OR REPLACE VIEW analytics_operator_invoices AS SELECT id,kind,status,amount_micro,created_at,paid_at,
 coalesce(metadata->>'purpose',CASE WHEN metadata->>'credits'='true' THEN 'prepaid_credits' ELSE 'service' END) AS purpose FROM invoices;
CREATE OR REPLACE VIEW analytics_operator_jobs AS SELECT j.id,j.kind,j.level,j.status,j.quote_micro,j.actual_cost_micro,j.attempts,j.created_at,j.completed_at,j.locked_at,
 CASE WHEN j.error IS NULL THEN NULL WHEN j.error ILIKE '%timeout%' OR j.error ILIKE '%timed out%' THEN 'timeout'
 WHEN j.error ILIKE '%429%' OR j.error ILIKE '%rate limit%' THEN 'rate_limit'
 WHEN j.error ILIKE '%503%' OR j.error ILIKE '%502%' THEN 'provider_unavailable'
 WHEN j.error ILIKE '%budget%' THEN 'budget_exhausted' WHEN j.error ILIKE '%invalid%' THEN 'invalid_input_or_output' ELSE 'unclassified' END AS failure_reason,
 r.passed,r.reused_from_job_id IS NOT NULL AS cached FROM verification_jobs j LEFT JOIN verification_results r ON r.job_id=j.id;
CREATE OR REPLACE VIEW analytics_operator_agents AS SELECT id,mode,status,input_tokens,output_tokens,created_at,left(response->>'providerModel',120) AS model,
 CASE WHEN response->>'failureReason' IN ('ai_provider_busy','ai_provider_rate_limit','ai_provider_rejected','invalid_output','timeout','unknown') THEN response->>'failureReason' ELSE NULL END AS failure_reason,
 CASE WHEN response->>'latencyMs' ~ '^[0-9]+$' THEN (response->>'latencyMs')::bigint ELSE NULL END AS latency_ms FROM agent_requests;
CREATE OR REPLACE VIEW analytics_operator_costs AS SELECT category,provider,quantity,unit,usd_micro,estimated,subject_id,created_at FROM cost_events;
CREATE OR REPLACE VIEW analytics_operator_versions AS SELECT v.id,v.status,v.total_size,v.file_count,v.created_at,v.finalized_at,a.kind,a.purpose,a.deleted_at FROM asset_versions v JOIN assets a ON a.id=v.asset_id;
CREATE OR REPLACE VIEW analytics_operator_hosting AS SELECT asset_version_id,source,bytes,starts_at,ends_at,amount_micro,usd_micro FROM hosting_coverage;
CREATE OR REPLACE VIEW analytics_operator_uploads AS SELECT status,size,created_at FROM uploads;
CREATE OR REPLACE VIEW analytics_operator_delivery AS SELECT id,order_id,asset_version_id,allowance_bytes,extra_bytes,bytes_served,access_ends_at,revoked_at FROM delivery_entitlements;
CREATE OR REPLACE VIEW analytics_operator_transfers AS SELECT kind,bytes,created_at FROM delivery_events;
CREATE OR REPLACE VIEW analytics_operator_listings AS SELECT id,kind,status,sales,created_at FROM listings;
CREATE OR REPLACE VIEW analytics_operator_submissions AS SELECT status,created_at FROM submissions;
CREATE OR REPLACE VIEW analytics_operator_providers AS SELECT approved,jobs_completed,jobs_disputed,updated_at FROM providers;
CREATE OR REPLACE VIEW analytics_operator_failure_bounties AS SELECT chain_state AS status,created_at FROM failure_bounties;
GRANT SELECT ON analytics_operator_accounts,analytics_operator_orders,analytics_operator_transactions,analytics_operator_invoices,
 analytics_operator_jobs,analytics_operator_agents,analytics_operator_costs,analytics_operator_versions,analytics_operator_hosting,
 analytics_operator_uploads,analytics_operator_delivery,analytics_operator_transfers,analytics_operator_listings,
 analytics_operator_submissions,analytics_operator_providers,analytics_operator_failure_bounties TO edgebounty_analytics_reader;
