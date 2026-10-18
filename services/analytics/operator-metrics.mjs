const windows=[1,7,30];

/** Query only explicitly granted operator views. Each response documents its measurement limits. */

export async function operatorMetrics(pool,days=7) {

 if(!windows.includes(days))throw Error('Invalid window');

 const c=await pool.connect();

 try{

  await c.query('BEGIN READ ONLY'); await c.query("SET LOCAL statement_timeout='5000ms'");

  const q=async(sql,args=[]) => (await c.query(sql,args)).rows;

  const accounts=await q(`SELECT id,created_at,last_login_at,roles,buyer,seller,verifier FROM analytics_operator_accounts WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 2000`);

  const totals=(await q(`SELECT count(*)::text AS accounts FROM analytics_operator_accounts WHERE deleted_at IS NULL`))[0];

  const daily=await q(`SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day,count(*)::text AS registrations FROM analytics_operator_accounts WHERE created_at>=now()-interval '60 days' GROUP BY 1 ORDER BY 1`);

  const orders=await q(`SELECT chain_state AS state,kind,count(*)::text AS n,coalesce(sum(amount_micro),0)::text AS principal,coalesce(sum(verifier_fee_micro),0)::text AS verifier_fees FROM analytics_operator_orders GROUP BY 1,2 ORDER BY 1,2`);

  const settlements=await q(`SELECT to_timestamp((chain->>'closedAt')::numeric)::date::text AS day,count(*)::text AS orders,

   sum(floor(amount_micro*(chain->>'sellerBps')::numeric/10000))::text AS gross,
   sum(floor(floor(amount_micro*(chain->>'sellerBps')::numeric/10000)*(chain->>'feeBps')::numeric/10000))::text AS commission

   FROM analytics_operator_orders WHERE chain_state='settled' AND chain->>'closedAt' ~ '^[0-9]+$' AND chain->>'sellerBps' ~ '^[0-9]+$' AND chain->>'feeBps' ~ '^[0-9]+$' GROUP BY 1 ORDER BY 1`);

  const transactions=await q(`SELECT status,count(*)::text AS n FROM analytics_operator_transactions GROUP BY 1`);

  const jobs=await q(`SELECT level,status,count(*)::text AS n,coalesce(sum(quote_micro),0)::text AS quoted,coalesce(sum(actual_cost_micro),0)::text AS processing_estimate_raw,

   count(*) FILTER(WHERE cached)::text AS cached,count(*) FILTER(WHERE passed)::text AS passed,count(*) FILTER(WHERE passed=false)::text AS failed_quality,

   avg(extract(epoch FROM (completed_at-created_at))*1000)::text AS avg_ms,

   percentile_cont(0.5) WITHIN GROUP(ORDER BY extract(epoch FROM (completed_at-created_at))*1000)::text AS p50_ms,

   percentile_cont(0.95) WITHIN GROUP(ORDER BY extract(epoch FROM (completed_at-created_at))*1000)::text AS p95_ms,

   percentile_cont(0.99) WITHIN GROUP(ORDER BY extract(epoch FROM (completed_at-created_at))*1000)::text AS p99_ms

   FROM analytics_operator_jobs WHERE created_at>=now()-($1::int*interval '1 day') GROUP BY 1,2 ORDER BY 1,2`,[days]);

  const agents=await q(`SELECT mode,status,coalesce(model,'unknown_historical_model') AS model,coalesce(failure_reason,'unclassified') AS reason,count(*)::text AS n,

   coalesce(sum(input_tokens),0)::text AS input_tokens,coalesce(sum(output_tokens),0)::text AS output_tokens,

   avg(latency_ms)::text AS avg_ms,percentile_cont(0.95) WITHIN GROUP(ORDER BY latency_ms)::text AS p95_ms

   FROM analytics_operator_agents WHERE created_at>=now()-($1::int*interval '1 day') GROUP BY 1,2,3,4 ORDER BY 1,2`,[days]);

  const failures=await q(`SELECT coalesce(failure_reason,'unclassified') AS reason,count(*)::text AS n FROM analytics_operator_jobs WHERE status='failed' AND created_at>=now()-($1::int*interval '1 day') GROUP BY 1`,[days]);

  const receipts=await q(`SELECT kind,purpose,status,count(*)::text AS n,coalesce(sum(amount_micro),0)::text AS amount FROM analytics_operator_invoices GROUP BY 1,2,3 ORDER BY 1,2`);

  const costs=await q(`SELECT category,provider,unit,estimated,sum(quantity)::text AS quantity,sum(usd_micro)::text AS usd_micro FROM analytics_operator_costs WHERE created_at>=now()-($1::int*interval '1 day') GROUP BY 1,2,3,4 ORDER BY 1,2`,[days]);

  const monthlyCosts=await q(`SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM') AS month,provider,estimated,sum(usd_micro)::text AS usd_micro FROM analytics_operator_costs GROUP BY 1,2,3 ORDER BY 1 DESC LIMIT 120`);
  const storage=await q(`SELECT purpose,kind,count(*)::text AS versions,coalesce(sum(total_size),0)::text AS bytes,coalesce(sum(file_count),0)::text AS files FROM analytics_operator_versions WHERE deleted_at IS NULL AND status='finalized' GROUP BY 1,2 ORDER BY 1,2`);

  const hosting=(await q(`SELECT count(DISTINCT asset_version_id) FILTER(WHERE ends_at>now() AND starts_at<=now())::text AS active_versions,

   count(DISTINCT asset_version_id) FILTER(WHERE ends_at>now() AND ends_at<=now()+interval '7 days')::text AS expiring_7d,

   coalesce(sum(amount_micro),0)::text AS receipts,

   coalesce(sum(floor(amount_micro*least(1::numeric,greatest(0::numeric,extract(epoch FROM (now()-starts_at))/nullif(extract(epoch FROM (ends_at-starts_at)),0))))),0)::text AS delivered_service_allocation

   FROM analytics_operator_hosting`))[0];

  const uploads=await q(`SELECT status,count(*)::text AS n,coalesce(sum(size),0)::text AS bytes,count(*) FILTER(WHERE created_at<now()-interval '1 day')::text AS older_24h FROM analytics_operator_uploads GROUP BY 1`);

  const delivery=(await q(`SELECT coalesce(sum(bytes_served),0)::text AS accounted_bytes,coalesce(sum(greatest(0,allowance_bytes+extra_bytes-bytes_served)),0)::text AS remaining_metered_bytes,count(*) FILTER(WHERE allowance_bytes IS NULL)::text AS unmetered_entitlements FROM analytics_operator_delivery WHERE revoked_at IS NULL`))[0];

  const transfers=await q(`SELECT kind,count(*)::text AS n,coalesce(sum(bytes),0)::text AS bytes FROM analytics_operator_transfers WHERE created_at>=now()-($1::int*interval '1 day') GROUP BY 1`,[days]);

  const listings=await q(`SELECT kind,status,count(*)::text AS n,coalesce(sum(sales),0)::text AS sales FROM analytics_operator_listings GROUP BY 1,2`);

  const submissions=await q(`SELECT status,count(*)::text AS n FROM analytics_operator_submissions GROUP BY 1`);

  const providers=await q(`SELECT approved,count(*)::text AS n,coalesce(sum(jobs_completed),0)::text AS completed FROM analytics_operator_providers GROUP BY 1`);

  const failureBounties=await q(`SELECT status,count(*)::text AS n FROM analytics_operator_failure_bounties GROUP BY 1`);

  const stuck=(await q(`SELECT count(*)::text AS n FROM analytics_operator_jobs WHERE status='running' AND locked_at<now()-interval '10 minutes'`))[0];

  await c.query('COMMIT');return {accounts,totals,daily,orders,settlements,transactions,jobs,agents,failures,receipts,costs,monthlyCosts,storage,hosting,uploads,delivery,transfers,listings,submissions,providers,failureBounties,stuck};

 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}

}

const records={orders:'analytics_operator_orders',jobs:'analytics_operator_jobs',transactions:'analytics_operator_transactions',invoices:'analytics_operator_invoices',agents:'analytics_operator_agents'};

export async function operatorRecords(pool,{type,page=1,days=30,sort='desc',id}) {

 if(!records[type]||!Number.isInteger(page)||page<1||page>10000||!windows.includes(days)||!['asc','desc'].includes(sort))throw Error('Invalid records request');

 if(id&&!/^[a-f0-9-]{36}$/i.test(id))throw Error('Invalid record ID');

 const args=id?[id]:[days],where=id?'id=$1':"created_at>=now()-($1::int*interval '1 day')";

 const c=await pool.connect();try{

  await c.query('BEGIN READ ONLY');await c.query("SET LOCAL statement_timeout='5000ms'");

  const total=(await c.query(`SELECT count(*)::text AS n FROM ${records[type]} WHERE ${where}`,args)).rows[0].n;

  const rows=(await c.query(`SELECT * FROM ${records[type]} WHERE ${where} ORDER BY created_at ${sort},${type==='transactions'?'signature':'id'} ${sort} LIMIT 50 OFFSET $2`,[...args,(page-1)*50])).rows;

  if(type==='jobs')for(const row of rows){row.providerCosts=(await c.query('SELECT category,provider,quantity::text,unit,usd_micro::text,estimated,created_at FROM analytics_operator_costs WHERE subject_id=$1 ORDER BY created_at LIMIT 100',[row.id])).rows;}

  await c.query('COMMIT');return {type,page,total,rows};

 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}

}
