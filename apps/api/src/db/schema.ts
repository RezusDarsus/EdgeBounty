import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });
/** lamports (SOL base units; legacy Micro field names), exact integers (never floats) */
const micro = (name: string) => bigint(name, { mode: 'bigint' });

export const notifications = pgTable('notifications', {
  id: id(), accountId: uuid('account_id').notNull(), dedupeKey: text('dedupe_key').notNull().unique(),
  title: text('title').notNull(), message: text('message').notNull(), href: text('href').notNull(),
  createdAt: created(), readAt: ts('read_at'),
}, t => [index('notifications_account_created').on(t.accountId, t.createdAt)]);

export const operationCounters = pgTable('operation_counters', {
  key: text('key').primaryKey(), count: micro('count').notNull().default(sql`0`), updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Each gateway HTTP request reserves its range once; failed storage reads can refund once. */
export const gatewayTransfers = pgTable('gateway_transfers', {
  id: uuid('id').primaryKey(),
  entitlementId: uuid('entitlement_id'),
  bytes: micro('bytes').notNull(),
  status: text('status', { enum: ['reserved', 'failed'] }).notNull().default('reserved'),
  createdAt: created(),
});

// ------------------------------------------------------------------ identity

export const accounts = pgTable('accounts', {
  id: id(),
  wallet: text('wallet').notNull().unique(),
  alias: text('alias').notNull(),
  mode: text('mode', { enum: ['pseudonymous', 'public'] }).notNull().default('pseudonymous'),
  roles: text('roles').array().notNull().default(sql`'{}'::text[]`),
  organizationId: uuid('organization_id'),
  createdAt: created(),
  lastLoginAt: ts('last_login_at'),
  deletedAt: ts('deleted_at'),
});

export const profiles = pgTable('profiles', {
  accountId: uuid('account_id').primaryKey().references(() => accounts.id),
  displayName: text('display_name'),
  organization: text('organization'),
  bio: text('bio'),
  links: jsonb('links').$type<string[]>().notNull().default([]),
  verifiedBusiness: boolean('verified_business').notNull().default(false),
  updatedAt: ts('updated_at').defaultNow(),
});

export const authNonces = pgTable('auth_nonces', {
  nonce: text('nonce').primaryKey(),
  wallet: text('wallet').notNull(),
  message: text('message').notNull(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
});

export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  ownerId: uuid('owner_id').notNull(),
  createdAt: created(),
});

export const apiKeys = pgTable('api_keys', {
  id: id(),
  accountId: uuid('account_id').notNull(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  scopes: text('scopes').array().notNull(),
  lastUsedAt: ts('last_used_at'),
  revokedAt: ts('revoked_at'),
  createdAt: created(),
});

// ------------------------------------------------------------------ assets & storage

export const assets = pgTable('assets', {
  id: id(),
  ownerId: uuid('owner_id').notNull(),
  kind: text('kind', { enum: ['dataset', 'model', 'code', 'other'] }).notNull(),
  name: text('name').notNull(),
  category: text('category'),
  purpose: text('purpose', { enum: ['listing', 'submission', 'verification', 'evidence', 'failure_example', 'benchmark', 'storage'] }).notNull(),
  createdAt: created(),
  deletedAt: ts('deleted_at'),
});

export const assetVersions = pgTable(
  'asset_versions',
  {
    id: id(),
    assetId: uuid('asset_id').notNull(),
    version: integer('version').notNull(),
    status: text('status', { enum: ['draft', 'finalized'] }).notNull().default('draft'),
    manifest: jsonb('manifest'),
    /** private salt (hex) — never exposed on-chain or to non-owners */
    salt: text('salt'),
    commitment: text('commitment'),
    totalSize: bigint('total_size', { mode: 'number' }).notNull().default(0),
    fileCount: integer('file_count').notNull().default(0),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    previewStatus: text('preview_status', { enum: ['none', 'pending', 'ready', 'failed'] }).notNull().default('none'),
    preview: jsonb('preview'),
    createdAt: created(),
    finalizedAt: ts('finalized_at'),
  },
  (t) => [uniqueIndex('asset_versions_asset_version').on(t.assetId, t.version)],
);

export const assetFiles = pgTable(
  'asset_files',
  {
    id: id(),
    versionId: uuid('version_id').notNull(),
    path: text('path').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    mediaType: text('media_type').notNull(),
    objectKey: text('object_key').notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex('asset_files_version_path').on(t.versionId, t.path)],
);

export const uploads = pgTable(
  'uploads',
  {
  id: id(),
  versionId: uuid('version_id').notNull(),
  accountId: uuid('account_id').notNull(),
  path: text('path').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  mediaType: text('media_type').notNull(),
  partSize: integer('part_size').notNull(),
  partsTotal: integer('parts_total').notNull(),
  partsReceived: jsonb('parts_received').$type<Record<string, string>>().notNull().default({}),
  objectKey: text('object_key').notNull(),
  s3UploadId: text('s3_upload_id'),
  /** storage category: 'customer' uploads reserve quota while open; 'workflow' (submissions, evidence) do not */
  category: text('category', { enum: ['workflow', 'customer'] }).notNull().default('customer'),
  status: text('status', { enum: ['open', 'complete', 'aborted'] }).notNull().default('open'),
  expiresAt: ts('expires_at').notNull(),
  createdAt: created(),
},
  (t) => [index('uploads_account_open').on(t.accountId, t.status)],
);

export const storageAllocations = pgTable('storage_allocations', {
  id: id(),
  accountId: uuid('account_id').notNull(),
  gb: integer('gb').notNull(),
  termDays: integer('term_days').notNull(),
  status: text('status', { enum: ['pending_payment', 'active', 'grace', 'expired', 'deleted'] }).notNull().default('pending_payment'),
  invoiceId: uuid('invoice_id'),
  startsAt: ts('starts_at'),
  expiresAt: ts('expires_at'),
  graceUntil: ts('grace_until'),
  createdAt: created(),
});

export const invoices = pgTable('invoices', {
  id: id(),
  accountId: uuid('account_id').notNull(),
  kind: text('kind', { enum: ['storage', 'verification', 'other'] }).notNull(),
  reference: text('reference').notNull().unique(),
  amountMicro: micro('amount_micro').notNull(),
  status: text('status', { enum: ['open', 'paid', 'expired', 'credited'] }).notNull().default('open'),
  receiptAddress: text('receipt_address'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: ts('expires_at').notNull(),
  createdAt: created(),
  paidAt: ts('paid_at'),
});

export const credits = pgTable('credits', {
  id: id(),
  accountId: uuid('account_id').notNull(),
  amountMicro: micro('amount_micro').notNull(),
  reason: text('reason').notNull(),
  createdAt: created(),
});

// ------------------------------------------------------------------ marketplace

export const licenses = pgTable('licenses', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  text: text('text').notNull(),
  hash: text('hash').notNull(),
  commercial: boolean('commercial').notNull(),
  redistribution: boolean('redistribution').notNull(),
});

export const listings = pgTable(
  'listings',
  {
    id: id(),
    sellerId: uuid('seller_id').notNull(),
    sellerWallet: text('seller_wallet').notNull(),
    assetId: uuid('asset_id').notNull(),
    assetVersionId: uuid('asset_version_id').notNull(),
    kind: text('kind', { enum: ['dataset', 'model', 'code', 'other'] }).notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull(),
    formats: text('formats').array().notNull().default(sql`'{}'::text[]`),
    recordCount: integer('record_count'),
    language: text('language'),
    labeling: text('labeling'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    licenseId: text('license_id').notNull(),
    licenseHash: text('license_hash').notNull(),
    terms: jsonb('terms').notNull(),
    termsHash: text('terms_hash').notNull(),
    priceMicro: micro('price_micro').notNull(),
    listingIdOnchain: bigint('listing_id_onchain', { mode: 'bigint' }).notNull(),
    onchainAddress: text('onchain_address').notNull().unique(),
    onchainVersion: integer('onchain_version').notNull().default(0),
    status: text('status', { enum: ['draft', 'published', 'delisted', 'moderated'] }).notNull().default('draft'),
    certificateAttestation: text('certificate_attestation'),
    sales: integer('sales').notNull().default(0),
    createdAt: created(),
    updatedAt: ts('updated_at').defaultNow(),
  },
  (t) => [index('listings_status_kind').on(t.status, t.kind)],
);

export const orders = pgTable(
  'orders',
  {
    id: id(),
    kind: text('kind', { enum: ['purchase', 'bounty'] }).notNull(),
    buyerId: uuid('buyer_id').notNull(),
    buyerWallet: text('buyer_wallet').notNull(),
    sellerId: uuid('seller_id'),
    sellerWallet: text('seller_wallet'),
    listingId: uuid('listing_id'),
    orderIdOnchain: bigint('order_id_onchain', { mode: 'bigint' }).notNull(),
    onchainAddress: text('onchain_address').notNull().unique(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    category: text('category'),
    terms: jsonb('terms').notNull(),
    termsHash: text('terms_hash').notNull(),
    criteria: jsonb('criteria'),
    criteriaHash: text('criteria_hash').notNull(),
    licenseId: text('license_id').notNull(),
    licenseHash: text('license_hash').notNull(),
    amountMicro: micro('amount_micro').notNull(),
    verifierWallet: text('verifier_wallet'),
    verifierFeeMicro: micro('verifier_fee_micro').notNull().default(sql`0`),
    deadline: ts('deadline'),
    maxCorrections: integer('max_corrections').notNull().default(0),
    public: boolean('public').notNull().default(true),
    /** Phase 5: milestone contracts and multi-seller slot groups share a group id. */
    groupId: uuid('group_id'),
    groupKind: text('group_kind', { enum: ['milestone', 'slot'] }),
    groupIndex: integer('group_index'),
    designatedSeller: text('designated_seller'),
    arbitratorWallet: text('arbitrator_wallet'),
    chainState: text('chain_state').notNull().default('draft'),
    chain: jsonb('chain'),
    syncedAt: ts('synced_at'),
    createdAt: created(),
  },
  (t) => [index('orders_chain_state').on(t.chainState), index('orders_buyer').on(t.buyerId), index('orders_seller').on(t.sellerId), index('orders_group').on(t.groupId)],
);

export const onchainTransactions = pgTable('onchain_transactions', {
  id: id(),
  signature: text('signature').notNull().unique(),
  kind: text('kind').notNull(),
  subject: text('subject'),
  wallet: text('wallet'),
  status: text('status', { enum: ['pending', 'confirmed', 'failed'] }).notNull().default('pending'),
  error: text('error'),
  createdAt: created(),
});

export const submissions = pgTable(
  'submissions',
  {
    id: id(),
    orderId: uuid('order_id').notNull(),
    index: integer('index').notNull(),
    assetVersionId: uuid('asset_version_id').notNull(),
    commitment: text('commitment').notNull(),
    onchainAddress: text('onchain_address'),
    status: text('status', { enum: ['prepared', 'onchain'] }).notNull().default('prepared'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('submissions_order_index').on(t.orderId, t.index)],
);

export const verificationJobs = pgTable(
  'verification_jobs',
  {
    id: id(),
    kind: text('kind', { enum: ['order', 'standalone', 'listing', 'failure_example', 'provider_job'] }).notNull(),
    orderId: uuid('order_id'),
    submissionIndex: integer('submission_index'),
    assetVersionId: uuid('asset_version_id').notNull(),
    requesterId: uuid('requester_id').notNull(),
    providerWallet: text('provider_wallet'),
    level: text('level', { enum: ['L1', 'L2', 'L3', 'L4'] }).notNull(),
    criteria: jsonb('criteria'),
    benchmarkId: text('benchmark_id'),
    specHash: text('spec_hash').notNull(),
    status: text('status', { enum: ['awaiting_payment', 'queued', 'running', 'needs_authorization', 'completed', 'failed', 'awaiting_provider', 'cancelled'] }).notNull().default('queued'),
    quoteMicro: micro('quote_micro').notNull().default(sql`0`),
    budget: jsonb('budget').$type<{ maxSpend: string; maxSeconds: number; maxItems: number; maxApiCalls: number }>().notNull(),
    actualCostMicro: micro('actual_cost_micro').notNull().default(sql`0`),
    onchainJobAddress: text('onchain_job_address'),
    invoiceId: uuid('invoice_id'),
    attempts: integer('attempts').notNull().default(0),
    lockedAt: ts('locked_at'),
    lockedBy: text('locked_by'),
    error: text('error'),
    publishOnchain: boolean('publish_onchain').notNull().default(false),
    auditOf: uuid('audit_of'),
    /** verification policy the result was produced under; results are reused only within one policy */
    policyVersion: text('policy_version').notNull().default(''),
    createdAt: created(),
    completedAt: ts('completed_at'),
  },
  (t) => [index('verification_jobs_status').on(t.status)],
);

/**
 * One canonical (paid) inference run per immutable version + check spec + policy. The unique key is the
 * idempotency guard: concurrent jobs race on the insert and only the winner runs inference; the others
 * wait and then reuse its persisted result.
 */
export const verificationRuns = pgTable(
  'verification_runs',
  {
    id: id(),
    assetVersionId: uuid('asset_version_id').notNull(),
    specHash: text('spec_hash').notNull(),
    policyVersion: text('policy_version').notNull(),
    jobId: uuid('job_id').notNull(),
    status: text('status', { enum: ['running', 'completed'] }).notNull().default('running'),
    resultId: uuid('result_id'),
    createdAt: created(),
    completedAt: ts('completed_at'),
  },
  (t) => [uniqueIndex('verification_runs_key').on(t.assetVersionId, t.specHash, t.policyVersion)],
);

export const verificationResults = pgTable('verification_results', {
  id: id(),
  jobId: uuid('job_id').notNull().unique(),
  report: jsonb('report').notNull(),
  reportHash: text('report_hash').notNull(),
  passed: boolean('passed').notNull(),
  attestationAddress: text('attestation_address'),
  txSignature: text('tx_signature'),
  /** set when this result reuses an earlier run's report (no new inference, no new charge) */
  reusedFromJobId: uuid('reused_from_job_id'),
  createdAt: created(),
});

export const deliveryEntitlements = pgTable('delivery_entitlements', {
  id: id(),
  orderId: uuid('order_id').notNull().unique(),
  buyerId: uuid('buyer_id').notNull(),
  buyerWallet: text('buyer_wallet').notNull(),
  assetVersionId: uuid('asset_version_id').notNull(),
  licenseReceipt: text('license_receipt').notNull(),
  grantedAt: created(),
  revokedAt: ts('revoked_at'),
  /** hosting access window; null = legacy entitlement from before metered access (unmetered, kept as-is) */
  accessStartsAt: ts('access_starts_at'),
  accessEndsAt: ts('access_ends_at'),
  /** included download bytes for the period (null = legacy, unmetered) */
  allowanceBytes: bigint('allowance_bytes', { mode: 'bigint' }),
  /** bytes bought with prepaid download credits */
  extraBytes: bigint('extra_bytes', { mode: 'bigint' }).notNull().default(sql`0`),
  /** bytes actually streamed (range-aware); reservations are refunded for bytes never sent */
  bytesServed: bigint('bytes_served', { mode: 'bigint' }).notNull().default(sql`0`),
  checkoutQuoteId: uuid('checkout_quote_id'),
});

/**
 * Funded hosting of one physical dataset version. Coverage only ever grows (rows are prepaid and
 * immutable), so a gap computed at quote time can never be uncovered later by someone else's expiry.
 */
export const hostingCoverage = pgTable(
  'hosting_coverage',
  {
    id: id(),
    assetVersionId: uuid('asset_version_id').notNull(),
    source: text('source', { enum: ['seller_prepaid', 'free_tier', 'buyer'] }).notNull(),
    payerId: uuid('payer_id').notNull(),
    bytes: bigint('bytes', { mode: 'bigint' }).notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    /** lamports paid for this interval (0 for free tier) */
    amountMicro: micro('amount_micro').notNull().default(sql`0`),
    usdMicro: bigint('usd_micro', { mode: 'bigint' }).notNull().default(sql`0`),
    invoiceId: uuid('invoice_id'),
    checkoutQuoteId: uuid('checkout_quote_id'),
    createdAt: created(),
  },
  (t) => [index('hosting_coverage_version').on(t.assetVersionId, t.endsAt), index('hosting_coverage_payer').on(t.payerId, t.source)],
);

/** Locked buyer checkout: rates, access window, gaps to fund and the extras invoice. */
export const checkoutQuotes = pgTable('checkout_quotes', {
  id: id(),
  orderId: uuid('order_id').unique(),
  listingId: uuid('listing_id').notNull(),
  buyerId: uuid('buyer_id').notNull(),
  assetVersionId: uuid('asset_version_id').notNull(),
  months: integer('months').notNull(),
  pricingVersion: text('pricing_version').notNull(),
  solUsdMicro: bigint('sol_usd_micro', { mode: 'bigint' }).notNull(),
  objectBytes: bigint('object_bytes', { mode: 'bigint' }).notNull(),
  accessStartsAt: ts('access_starts_at').notNull(),
  accessEndsAt: ts('access_ends_at').notNull(),
  hostingGaps: jsonb('hosting_gaps').$type<{ start: string; end: string }[]>().notNull(),
  allowanceBytes: bigint('allowance_bytes', { mode: 'bigint' }).notNull(),
  priceMicro: micro('price_micro').notNull(),
  hostingMicro: micro('hosting_micro').notNull(),
  downloadsMicro: micro('downloads_micro').notNull(),
  minimumFeeMicro: micro('minimum_fee_micro').notNull(),
  extrasMicro: micro('extras_micro').notNull(),
  hostingUsdMicro: bigint('hosting_usd_micro', { mode: 'bigint' }).notNull(),
  invoiceId: uuid('invoice_id'),
  status: text('status', { enum: ['awaiting_payment', 'paid'] }).notNull().default('awaiting_payment'),
  createdAt: created(),
  paidAt: ts('paid_at'),
});

/**
 * Cost ledger. `estimated` = derived from configured rates; false only for amounts imported from verified
 * provider/AWS billing data. Free-tier usage is recorded with amount 0 and its quantity, never an invented price.
 */
export const costEvents = pgTable(
  'cost_events',
  {
    id: id(),
    category: text('category', { enum: ['verification', 'storage', 'bandwidth', 'compute', 'other'] }).notNull(),
    provider: text('provider').notNull(),
    quantity: bigint('quantity', { mode: 'bigint' }).notNull(),
    unit: text('unit').notNull(),
    usdMicro: bigint('usd_micro', { mode: 'bigint' }).notNull(),
    estimated: boolean('estimated').notNull(),
    note: text('note'),
    subjectId: uuid('subject_id'),
    createdAt: created(),
  },
  (t) => [index('cost_events_category_time').on(t.category, t.createdAt)],
);

export const deliveryEvents = pgTable('delivery_events', {
  id: id(),
  entitlementId: uuid('entitlement_id').notNull(),
  fileId: uuid('file_id').notNull(),
  accountId: uuid('account_id').notNull(),
  kind: text('kind', { enum: ['token_issued', 'download_started', 'download_completed', 'download_failed'] }).notNull(),
  /** bytes actually sent for this request (bandwidth accounting) */
  bytes: bigint('bytes', { mode: 'bigint' }),
  createdAt: created(),
});

export const disputes = pgTable('disputes', {
  id: id(),
  orderId: uuid('order_id').notNull(),
  index: integer('index').notNull(),
  openedByWallet: text('opened_by_wallet').notNull(),
  reason: text('reason').notNull(),
  reasonHash: text('reason_hash').notNull(),
  evidence: jsonb('evidence').$type<{ by: string; note: string; assetVersionId?: string; hash: string; at: string }[]>().notNull().default([]),
  status: text('status', { enum: ['prepared', 'open', 'resolved'] }).notNull().default('prepared'),
  resolution: text('resolution'),
  sellerBps: integer('seller_bps'),
  resolverId: uuid('resolver_id'),
  notes: text('notes'),
  createdAt: created(),
  resolvedAt: ts('resolved_at'),
});

export const reviews = pgTable(
  'reviews',
  {
    id: id(),
    orderId: uuid('order_id').notNull(),
    reviewerId: uuid('reviewer_id').notNull(),
    subjectId: uuid('subject_id').notNull(),
    rating: integer('rating').notNull(),
    comment: text('comment').notNull().default(''),
    createdAt: created(),
  },
  (t) => [uniqueIndex('reviews_order_reviewer').on(t.orderId, t.reviewerId)],
);

export const providers = pgTable('providers', {
  wallet: text('wallet').primaryKey(),
  accountId: uuid('account_id'),
  profile: jsonb('profile'),
  metadataHash: text('metadata_hash'),
  approved: boolean('approved').notNull().default(false),
  capabilities: integer('capabilities').notNull().default(0),
  requestedCapabilities: integer('requested_capabilities').notNull().default(0),
  jobsCompleted: integer('jobs_completed').notNull().default(0),
  jobsDisputed: integer('jobs_disputed').notNull().default(0),
  onchainAddress: text('onchain_address'),
  updatedAt: ts('updated_at').defaultNow(),
});

export const failureBounties = pgTable('failure_bounties', {
  id: id(),
  creatorId: uuid('creator_id').notNull(),
  creatorWallet: text('creator_wallet').notNull(),
  bountyIdOnchain: bigint('bounty_id_onchain', { mode: 'bigint' }).notNull(),
  onchainAddress: text('onchain_address').notNull().unique(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  spec: jsonb('spec').notNull(),
  specHash: text('spec_hash').notNull(),
  termsHash: text('terms_hash').notNull(),
  modelAssetVersionId: uuid('model_asset_version_id'),
  modelCommitment: text('model_commitment').notNull(),
  rewardMicro: micro('reward_micro').notNull(),
  verifierFeeMicro: micro('verifier_fee_micro').notNull(),
  maxExamples: integer('max_examples').notNull(),
  maxEvaluations: integer('max_evaluations').notNull(),
  verifierWallet: text('verifier_wallet').notNull(),
  expiresAt: ts('expires_at').notNull(),
  chain: jsonb('chain'),
  chainState: text('chain_state').notNull().default('draft'),
  createdAt: created(),
});

export const failureExamples = pgTable('failure_examples', {
  id: id(),
  bountyId: uuid('bounty_id').notNull(),
  contributorId: uuid('contributor_id').notNull(),
  contributorWallet: text('contributor_wallet').notNull(),
  assetVersionId: uuid('asset_version_id').notNull(),
  commitment: text('commitment').notNull(),
  onchainAddress: text('onchain_address').notNull().unique(),
  status: text('status', { enum: ['prepared', 'pending', 'accepted', 'rejected'] }).notNull().default('prepared'),
  report: jsonb('report'),
  createdAt: created(),
});

export const providerJobs = pgTable('provider_jobs', {
  id: id(),
  requesterId: uuid('requester_id').notNull(),
  requesterWallet: text('requester_wallet').notNull(),
  jobIdOnchain: bigint('job_id_onchain', { mode: 'bigint' }).notNull(),
  onchainAddress: text('onchain_address').notNull().unique(),
  assetVersionId: uuid('asset_version_id').notNull(),
  spec: jsonb('spec').notNull(),
  specHash: text('spec_hash').notNull(),
  priceMicro: micro('price_micro').notNull(),
  providerWallet: text('provider_wallet'),
  requiredCapability: integer('required_capability').notNull(),
  deadline: ts('deadline').notNull(),
  report: jsonb('report'),
  reportHash: text('report_hash'),
  chainState: text('chain_state').notNull().default('draft'),
  chain: jsonb('chain'),
  createdAt: created(),
});

export const attestationsMirror = pgTable('attestations', {
  address: text('address').primaryKey(),
  subject: text('subject').notNull(),
  verifier: text('verifier').notNull(),
  assetCommitment: text('asset_commitment').notNull(),
  specHash: text('spec_hash').notNull(),
  resultHash: text('result_hash').notNull(),
  passed: boolean('passed').notNull(),
  revoked: boolean('revoked').notNull(),
  issuedAt: ts('issued_at').notNull(),
});

export const benchmarks = pgTable('benchmarks', {
  id: text('id').primaryKey(),
  version: integer('version').notNull(),
  task: text('task').notNull(),
  description: text('description').notNull(),
  license: text('license').notNull(),
  methodology: text('methodology').notNull(),
  assetVersionId: uuid('asset_version_id'),
  ownerId: uuid('owner_id'),
  private: boolean('private').notNull().default(false),
  inputSpec: jsonb('input_spec').notNull(),
  createdAt: created(),
});

export const auditEvents = pgTable('audit_events', {
  id: id(),
  actorId: uuid('actor_id'),
  actorWallet: text('actor_wallet'),
  action: text('action').notNull(),
  target: text('target'),
  details: jsonb('details').notNull().default({}),
  createdAt: created(),
});

/** Phase 5: buyer-specific encrypted delivery. The platform stores only ciphertext envelopes. */
export const deliveryKeys = pgTable('delivery_keys', {
  id: id(),
  assetVersionId: uuid('asset_version_id').notNull().unique(),
  sellerId: uuid('seller_id').notNull(),
  scheme: text('scheme').notNull(),
  /** per-file IVs and the content-key fingerprint (sha256 of the raw key) */
  params: jsonb('params').notNull(),
  createdAt: created(),
});

export const deliveryEnvelopes = pgTable(
  'delivery_envelopes',
  {
    id: id(),
    orderId: uuid('order_id').notNull(),
    buyerBoxPublicKey: text('buyer_box_public_key').notNull(),
    envelope: text('envelope'),
    sellerBoxPublicKey: text('seller_box_public_key'),
    nonce: text('nonce'),
    createdAt: created(),
    deliveredAt: ts('delivered_at'),
  },
  (t) => [uniqueIndex('delivery_envelopes_order').on(t.orderId)],
);
