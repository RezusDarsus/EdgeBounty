/** Aggregates only; never return account identifiers, wallet addresses, prompts or invoice references. */
export async function marketplaceMetrics(pool) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='5000ms'");
    const accounts=await client.query(`SELECT count(*) FILTER(WHERE deleted_at IS NULL)::text AS registered,
      count(*)::text AS ever_registered,count(*) FILTER(WHERE deleted_at IS NOT NULL)::text AS deleted,
      count(*) FILTER(WHERE deleted_at IS NULL AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::text AS registered_today,
      count(*) FILTER(WHERE deleted_at IS NULL AND last_login_at>=now()-interval '24 hours')::text AS signed_in_24h FROM analytics_accounts`);
    const finance=await client.query(`WITH settled AS (
      SELECT amount_micro,
        CASE WHEN chain->>'sellerBps' ~ '^[0-9]+$' AND chain->>'feeBps' ~ '^[0-9]+$'
          THEN floor(amount_micro*(chain->>'sellerBps')::numeric/10000) END AS gross,
        CASE WHEN chain->>'feeBps' ~ '^[0-9]+$' THEN (chain->>'feeBps')::numeric END AS fee_bps
      FROM analytics_orders WHERE chain_state='settled'
    ) SELECT count(*)::text AS settled_orders,coalesce(sum(gross),0)::text AS settled_volume,
      coalesce(sum(floor(gross*fee_bps/10000)),0)::text AS commission,
      coalesce(sum(gross-floor(gross*fee_bps/10000)),0)::text AS seller_proceeds,
      count(*) FILTER(WHERE gross IS NULL OR fee_bps IS NULL)::text AS unknown_splits FROM settled`);
    const invoices=await client.query(`SELECT kind,coalesce(metadata->>'purpose',CASE WHEN metadata->>'credits'='true' THEN 'prepaid_credits' ELSE 'service' END) AS purpose,
      count(*)::text AS paid_invoices,coalesce(sum(amount_micro),0)::text AS receipts FROM analytics_invoices WHERE status='paid' GROUP BY 1,2 ORDER BY 1,2`);
    const orders=await client.query('SELECT chain_state AS state,count(*)::text AS n FROM analytics_orders GROUP BY chain_state ORDER BY chain_state');
    const ai=await client.query(`SELECT status,count(*)::text AS n FROM analytics_agent_requests WHERE created_at>=now()-interval '24 hours' GROUP BY status ORDER BY status`);
    const downloads=await client.query('SELECT coalesce(sum(bytes_served),0)::text AS accounted_bytes FROM analytics_delivery_entitlements');
    await client.query('COMMIT');
    return { accounts:accounts.rows[0],finance:finance.rows[0],invoices:invoices.rows,orders:orders.rows,ai:ai.rows,downloads:downloads.rows[0] };
  } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
  finally { client.release(); }
}
