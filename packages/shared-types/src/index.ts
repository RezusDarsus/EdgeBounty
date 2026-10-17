/** Mirrors of on-chain enums (order matters: Borsh enum index). */
export const ORDER_STATES = [
  'created',
  'funded',
  'assigned',
  'submitted',
  'under_review',
  'approved',
  'disputed',
  'correction_required',
  'settled',
  'refunded',
  'cancelled',
] as const;
export type OrderState = (typeof ORDER_STATES)[number];
export const TERMINAL_ORDER_STATES: OrderState[] = ['settled', 'refunded', 'cancelled'];

export const JOB_STATES = ['open', 'accepted', 'result_submitted', 'disputed', 'resolved', 'completed', 'refunded'] as const;
export type JobState = (typeof JOB_STATES)[number];

export const ASSET_KINDS = ['dataset', 'model', 'code', 'other'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const CAPABILITIES = {
  dataset_image: 1 << 0,
  dataset_tabular: 1 << 1,
  model_vision: 1 << 2,
  model_language: 1 << 3,
  model_speech: 1 << 4,
  human_review: 1 << 5,
  failure_bounty: 1 << 6,
} as const;
export type Capability = keyof typeof CAPABILITIES;

export const capabilityMask = (caps: Capability[]) => caps.reduce((m, c) => m | CAPABILITIES[c], 0);
export const capabilityList = (mask: number) => (Object.keys(CAPABILITIES) as Capability[]).filter((c) => (mask & CAPABILITIES[c]) !== 0);

export const SERVICE_KINDS = { storage: 1, verification: 2, other: 3 } as const;

export const DATASET_CATEGORIES = ['image_classification', 'object_detection', 'segmentation', 'tabular', 'text', 'audio', 'video', 'multimodal', 'time_series'] as const;
export const FILE_FORMATS = ['jpeg', 'png', 'webp', 'csv', 'json', 'jsonl', 'parquet', 'onnx', 'safetensors', 'zip'] as const;

export const ALLOWED_LICENSES = [
  { id: 'eb-nonexclusive-commercial-v1', name: 'EdgeBounty Non-Exclusive Commercial v1', redistribution: false, commercial: true },
  { id: 'eb-nonexclusive-research-v1', name: 'EdgeBounty Non-Exclusive Research-Only v1', redistribution: false, commercial: false },
  { id: 'eb-exclusive-transfer-v1', name: 'EdgeBounty Exclusive Transfer v1', redistribution: true, commercial: true },
  { id: 'cc-by-4.0', name: 'Creative Commons Attribution 4.0', redistribution: true, commercial: true },
  { id: 'cc-by-nc-4.0', name: 'Creative Commons Attribution-NonCommercial 4.0', redistribution: true, commercial: false },
  { id: 'apache-2.0', name: 'Apache License 2.0', redistribution: true, commercial: true },
  { id: 'mit', name: 'MIT License', redistribution: true, commercial: true },
] as const;

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

/** Money is always transported as decimal strings of lamports (SOL base units; legacy Micro field names). */
export type MicroUsdc = string;
