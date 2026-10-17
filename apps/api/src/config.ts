import { z } from 'zod';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('127.0.0.1'),
  /** Domain bound into Sign-In-With-Solana messages. */
  APP_DOMAIN: z.string().default('localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  /** postgres://... for production; empty = embedded PGlite at DATA_DIR/db (dev/test). */
  DATABASE_URL: z.string().optional(),
  DATA_DIR: z.string().default(join(process.cwd(), '.data')),
  JWT_SECRET: z.string().min(32).default('dev-only-secret-change-me-dev-only-secret'),
  DOWNLOAD_TOKEN_SECRET: z.string().min(32).default('dev-only-download-secret-change-me-0000'),
  SOLANA_RPC_URL: z.string().default('http://127.0.0.1:8899'),
  PAYMENT_CURRENCY: z.enum(['SOL', 'USDC']).default('SOL'),
  /** Required for USDC; never infer a mint or reinterpret an existing SOL database. */
  PAYMENT_MINT: z.string().optional(),
  PROGRAM_ID: z.string().optional(),
  /** JSON secret key arrays for platform-operated keys (dev). Use a KMS/HSM in production. */
  PLATFORM_VERIFIER_KEY: z.string().optional(),
  DISPUTE_AUTHORITY_KEY: z.string().optional(),
  CRANK_KEY: z.string().optional(),
  ADMIN_WALLETS: z.string().default(''),
  STORAGE_DRIVER: z.enum(['local', 's3', 'r2']).default('local'),
  DOWNLOAD_GATEWAY_URL: z.string().url().optional(),
  GATEWAY_SHARED_SECRET: z.string().min(32).optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  /** Disable direct browser URLs when bucket CORS is not configured; the API proxies transfers. */
  S3_DIRECT_TRANSFERS: z.enum(['0', '1']).default('1'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** empty = AWS_REGION (EC2: eu-north-1); 'auto' for Cloudflare R2 */
  S3_REGION: z.string().optional(),
  /** lifetime of presigned S3 URLs (upload parts and downloads), seconds */
  PRESIGN_TTL_SECS: z.coerce.number().int().min(60).max(3600).default(900),
  PYTHON_BIN: z.string().optional(),
  SANDBOX: z.enum(['process', 'docker']).default('process'),
  DOCKER_USE_SUDO: z.enum(['0', '1']).default('0'),
  VERIFICATION_EXECUTOR: z.enum(['api', 'worker']).default('api'),
  /** AI provider for Level 3: 'nvidia' (OpenAI-compatible API catalog) or 'anthropic'. Auto-detected from keys if unset. */
  AI_PROVIDER: z.enum(['nvidia', 'anthropic', 'gemini']).optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_INPUT_MICRO_PER_MILLION: z.coerce.bigint().optional(),
  GEMINI_OUTPUT_MICRO_PER_MILLION: z.coerce.bigint().optional(),
  /** No automatic full dataset materialization above this budget. */
  VERIFICATION_MAX_MATERIALIZE_BYTES: z.coerce.number().int().positive().default(256 * 1024 ** 2),
  ANTHROPIC_API_KEY: z.string().optional(),
  L3_MODEL: z.string().default('claude-opus-5-5'),
  NVIDIA_API_KEY: z.string().optional(),
  NVIDIA_BASE_URL: z.string().default('https://integrate.api.nvidia.com/v1'),
  SEMANTIC_DUPLICATES: z.enum(['on', 'off']).default('off'),
  NVIDIA_EMBEDDING_MODEL: z.string().default('nvidia/nemotron-3-embed-1b'),
  /** must accept images */
  L3_VISION_MODEL: z.string().default('meta/llama-3.2-11b-vision-instruct'),
  /** text-only model used for plain-English report explanations */
  L3_TEXT_MODEL: z.string().default('nvidia/nemotron-3.5-lightning-30b-a3b'),
  MAX_UPLOAD_BYTES: z.coerce.number().default(10 * 1024 ** 3),
  MAX_FILE_BYTES: z.coerce.number().default(10 * 1024 ** 3),
  UPLOAD_PART_BYTES: z.coerce.number().default(16 * 1024 ** 2),
  /** MVP free tier, added on top of paid plans */
  FREE_STORAGE_BYTES: z.coerce.number().default(1024 ** 3),
  /** cap per bounty-submission / evidence version (workflow category; not charged to the quota) */
  SUBMISSION_MAX_BYTES: z.coerce.number().default(5 * 1024 ** 3),
  /** price of 1 SOL in micro-USD, used to convert USD-denominated rates at quote time (demo default; set from a real feed before mainnet) */
  SOL_USD_MICRO: z.coerce.bigint().default(150_000_000n),
  /** S3 Standard micro-USD per GB-month used in H (ESTIMATE; confirm eu-north-1 in the AWS Pricing Calculator) */
  S3_RATE_MICRO_PER_GB_MONTH: z.coerce.bigint().default(15_000n),
  /** free-tier hosting per listed version, days; bounded and granted once per version */
  FREE_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),
  /** a listing must have at least this much funded hosting ahead of it */
  LISTING_MIN_COVERAGE_DAYS: z.coerce.number().int().min(1).default(30),
  // ---- cost reporting (all micro-USD; unset = unknown, never guessed) ----
  EC2_MONTHLY_USD_MICRO: z.coerce.bigint().optional(),
  EBS_MONTHLY_USD_MICRO: z.coerce.bigint().optional(),
  OTHER_FIXED_MONTHLY_USD_MICRO: z.coerce.bigint().default(0n),
  /** AWS data transfer out, micro-USD per GB (ESTIMATE) */
  AWS_EGRESS_MICRO_PER_GB: z.coerce.bigint().default(90_000n),
  /** per-call inference price; 0 while on the NVIDIA free tier (usage is still counted) */
  NVIDIA_USD_MICRO_PER_CALL: z.coerce.bigint().default(0n),
  BUDGET_MONTHLY_USD_MICRO: z.coerce.bigint().optional(),
  /** monthly storage plans offered, in GB (comma-separated) */
  STORAGE_PLANS_GB: z.string().default('10,50,200,1000'),
  INDEXER_INTERVAL_MS: z.coerce.number().default(5_000),
  WORKERS: z.enum(['on', 'off']).default('on'),
});

export type Config = z.infer<typeof Env> & { repoRoot: string; pythonBin: string };

export function loadConfig(overrides: Partial<Record<keyof z.infer<typeof Env>, string>> = {}): Config {
  const cfg = Env.parse({ ...process.env, ...overrides });
  if (cfg.PAYMENT_CURRENCY === 'USDC' && !cfg.PAYMENT_MINT) throw new Error('PAYMENT_MINT required for USDC');
  if (cfg.STORAGE_DRIVER === 'r2' && cfg.S3_DIRECT_TRANSFERS !== '1') throw new Error('R2 requires direct transfers');
  if (cfg.DOWNLOAD_GATEWAY_URL && !cfg.GATEWAY_SHARED_SECRET) throw new Error('GATEWAY_SHARED_SECRET required for download gateway');
  if (cfg.NODE_ENV === 'production') {
    if (cfg.JWT_SECRET.startsWith('dev-only') || cfg.DOWNLOAD_TOKEN_SECRET.startsWith('dev-only')) throw new Error('set real secrets in production');
    if (!cfg.DATABASE_URL) throw new Error('DATABASE_URL required in production');
    if (cfg.SANDBOX !== 'docker') throw new Error('untrusted workloads must run in the docker sandbox in production');
  }
  const repoRoot = join(import.meta.dirname, '..', '..', '..');
  const venv = process.platform === 'win32' ? join(repoRoot, '.venv', 'Scripts', 'python.exe') : join(repoRoot, '.venv', 'bin', 'python');
  const pythonBin = cfg.PYTHON_BIN ?? (existsSync(venv) ? venv : 'python3');
  return { ...cfg, repoRoot, pythonBin };
}
