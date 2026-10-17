import { z } from 'zod';

// ------------------------------------------------------------------ manifests

export const ManifestFile = z.object({
  path: z.string().min(1).max(512),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  mediaType: z.string().max(128),
});
export type ManifestFile = z.infer<typeof ManifestFile>;

export const Manifest = z.object({
  schema: z.literal('edgebounty.manifest/1'),
  assetId: z.string(),
  versionId: z.string(),
  fileCount: z.number().int().nonnegative(),
  totalSize: z.number().int().nonnegative(),
  files: z.array(ManifestFile),
});
export type Manifest = z.infer<typeof Manifest>;

export function buildManifest(assetId: string, versionId: string, files: ManifestFile[]): Manifest {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    schema: 'edgebounty.manifest/1',
    assetId,
    versionId,
    fileCount: sorted.length,
    totalSize: sorted.reduce((n, f) => n + f.size, 0),
    files: sorted,
  };
}

// ------------------------------------------------------------------ acceptance criteria

export const ImageDatasetCriteria = z.object({
  kind: z.literal('image_dataset'),
  minImages: z.number().int().positive(),
  minWidth: z.number().int().nonnegative().default(0),
  minHeight: z.number().int().nonnegative().default(0),
  /** Readable files as basis points of all files (10000 = 100%). */
  minReadableBps: z.number().int().min(0).max(10_000).default(10_000),
  maxExactDuplicates: z.number().int().nonnegative().default(0),
  maxNearDuplicateBps: z.number().int().min(0).max(10_000).default(10_000),
  minLabelValidBps: z.number().int().min(0).max(10_000).optional(),
  minRelevanceBps: z.number().int().min(0).max(10_000).optional(),
  relevancePrompt: z.string().max(500).optional(),
  allowedFormats: z.array(z.enum(['jpeg', 'png', 'webp', 'bmp', 'gif', 'tiff'])).optional(),
  requiredLabels: z.array(z.string()).optional(),
});

export const TabularDatasetCriteria = z.object({
  kind: z.literal('tabular_dataset'),
  minRows: z.number().int().positive(),
  requiredColumns: z.array(z.string()).default([]),
  maxNullBps: z.number().int().min(0).max(10_000).default(10_000),
  maxDuplicateRowBps: z.number().int().min(0).max(10_000).default(10_000),
  columnTypes: z.record(z.string(), z.enum(['int', 'float', 'string', 'bool', 'datetime'])).optional(),
});

export const ModelCriteria = z.object({
  kind: z.literal('model'),
  task: z.enum(['image_classification', 'object_detection', 'text_classification', 'speech_recognition', 'tabular_regression', 'tabular_classification']),
  benchmarkId: z.string(),
  metric: z.enum(['accuracy', 'f1_macro', 'precision_macro', 'recall_macro', 'map50', 'wer', 'cer', 'rmse']),
  /** For error metrics (wer, cer, rmse) this is a maximum; otherwise a minimum. Scaled by 1e4. */
  thresholdE4: z.number().int().nonnegative(),
  maxLatencyMs: z.number().int().positive().optional(),
});

export const AcceptanceCriteria = z.discriminatedUnion('kind', [ImageDatasetCriteria, TabularDatasetCriteria, ModelCriteria]);
export type AcceptanceCriteria = z.infer<typeof AcceptanceCriteria>;

// ------------------------------------------------------------------ terms & licenses

export const OrderTerms = z.object({
  schema: z.literal('edgebounty.terms/1'),
  title: z.string().min(3).max(200),
  description: z.string().max(10_000),
  deliverables: z.array(z.string().max(500)).max(50),
  frameworks: z.array(z.string()).max(20).default([]),
  licenseId: z.string(),
  ipTerms: z.enum(['non_exclusive_license', 'exclusive_license', 'assignment']).default('non_exclusive_license'),
  commercialUse: z.boolean().default(true),
  disputeProcedure: z.string().default('edgebounty-standard-v1'),
});
export type OrderTerms = z.infer<typeof OrderTerms>;

// ------------------------------------------------------------------ reports

export const CriterionResult = z.object({
  criterion: z.string(),
  required: z.union([z.number(), z.string(), z.boolean()]),
  actual: z.union([z.number(), z.string(), z.boolean(), z.null()]),
  status: z.enum(['pass', 'fail', 'untested']),
  note: z.string().optional(),
});
export type CriterionResult = z.infer<typeof CriterionResult>;

export const Finding = z.object({
  severity: z.enum(['confirmed', 'suspected']),
  code: z.string(),
  message: z.string(),
  files: z.array(z.string()).max(200).default([]),
});
export type Finding = z.infer<typeof Finding>;

export const DatasetMetrics = z.object({
  totalFiles: z.number().int(),
  totalSize: z.number().int(),
  dataFiles: z.number().int(),
  readableFiles: z.number().int(),
  corruptedFiles: z.number().int(),
  exactDuplicates: z.number().int(),
  nearDuplicates: z.number().int().nullable(),
  minWidth: z.number().int().nullable(),
  minHeight: z.number().int().nullable(),
  belowResolution: z.number().int().nullable(),
  formats: z.record(z.string(), z.number().int()),
  labelIssues: z.number().int().nullable(),
  labeledFiles: z.number().int().nullable(),
  labels: z.record(z.string(), z.number().int()).nullable(),
  outliers: z.number().int().nullable(),
  rows: z.number().int().nullable(),
  columns: z.array(z.object({ name: z.string(), type: z.string(), nulls: z.number().int(), distinct: z.number().int().nullable() })).nullable(),
  duplicateRows: z.number().int().nullable(),
  nullCells: z.number().int().nullable(),
  relevance: z
    .object({ estimateBps: z.number().int(), lowBps: z.number().int(), highBps: z.number().int(), sampleSize: z.number().int(), method: z.string() })
    .nullable(),
  /** audio/video container & signal statistics (Phase 5) */
  media: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type DatasetMetrics = z.infer<typeof DatasetMetrics>;

export const ModelMetrics = z.object({
  format: z.string(),
  opset: z.number().int().nullable(),
  operators: z.array(z.string()),
  disallowedOperators: z.array(z.string()),
  parameters: z.number().int().nullable(),
  inputs: z.array(z.object({ name: z.string(), shape: z.array(z.union([z.number(), z.string(), z.null()])), dtype: z.string() })),
  outputs: z.array(z.object({ name: z.string(), shape: z.array(z.union([z.number(), z.string(), z.null()])), dtype: z.string() })),
  benchmark: z
    .object({
      id: z.string(),
      version: z.number().int(),
      samples: z.number().int(),
      metrics: z.record(z.string(), z.number()),
      confusionMatrix: z.array(z.array(z.number().int())).nullable(),
      latencyMsP50: z.number(),
      latencyMsP95: z.number(),
      hardware: z.string(),
    })
    .nullable(),
});
export type ModelMetrics = z.infer<typeof ModelMetrics>;

export const VerificationReport = z.object({
  schema: z.literal('edgebounty.report/1'),
  assetId: z.string(),
  assetVersion: z.string(),
  assetCommitment: z.string().regex(/^[0-9a-f]{64}$/),
  level: z.enum(['L1', 'L2', 'L3', 'L4']),
  specHash: z.string().regex(/^[0-9a-f]{64}$/),
  datasetMetrics: DatasetMetrics.nullable(),
  modelMetrics: ModelMetrics.nullable(),
  findings: z.array(Finding),
  criteria: z.array(CriterionResult),
  passed: z.boolean(),
  sampling: z.string(),
  tools: z.array(z.object({ name: z.string(), version: z.string() })),
  limitations: z.array(z.string()),
  untested: z.array(z.string()),
  verifier: z.string(),
  createdAt: z.string(),
  /** optional AI-generated plain-English explanation (Level 3); never used for pass/fail */
  summary: z.string().max(2000).optional(),
});
export type VerificationReport = z.infer<typeof VerificationReport>;

// ------------------------------------------------------------------ providers

export const ProviderProfile = z.object({
  schema: z.literal('edgebounty.provider/1'),
  name: z.string().min(2).max(100),
  description: z.string().max(2_000),
  assetTypes: z.array(z.string()).max(20),
  hardware: z.string().max(500),
  methods: z.array(z.string()).max(30),
  pricing: z.string().max(1_000),
  capacityJobsPerDay: z.number().int().positive(),
  securityCapabilities: z.array(z.string()).max(20),
  contact: z.string().max(200).optional(),
});
export type ProviderProfile = z.infer<typeof ProviderProfile>;
