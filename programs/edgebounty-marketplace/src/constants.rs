pub const CONFIG_SEED: &[u8] = b"config";
pub const PROVIDER_SEED: &[u8] = b"provider";
pub const LISTING_SEED: &[u8] = b"listing";
pub const ORDER_SEED: &[u8] = b"order";
pub const VAULT_SEED: &[u8] = b"vault";
pub const SUBMISSION_SEED: &[u8] = b"submission";
pub const ATTESTATION_SEED: &[u8] = b"attestation";
pub const DISPUTE_SEED: &[u8] = b"dispute";
pub const LICENSE_SEED: &[u8] = b"license";
pub const REPUTATION_SEED: &[u8] = b"reputation";
pub const FAILURE_BOUNTY_SEED: &[u8] = b"fbounty";
pub const FAILURE_VAULT_SEED: &[u8] = b"fvault";
pub const FAILURE_EXAMPLE_SEED: &[u8] = b"fexample";
pub const JOB_SEED: &[u8] = b"vjob";
pub const JOB_VAULT_SEED: &[u8] = b"jvault";
pub const RECEIPT_SEED: &[u8] = b"receipt";

/// Hard ceiling on the platform commission (10%). Cannot be changed without a program upgrade.
pub const MAX_FEE_BPS: u16 = 1_000;
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const MAX_CORRECTIONS: u8 = 5;
pub const MIN_WINDOW_SECS: i64 = 60;
pub const MAX_WINDOW_SECS: i64 = 60 * 60 * 24 * 60;

/// Provider capability bits (also mirrored in packages/shared-types).
pub const CAP_DATASET_IMAGE: u32 = 1 << 0;
pub const CAP_DATASET_TABULAR: u32 = 1 << 1;
pub const CAP_MODEL_VISION: u32 = 1 << 2;
pub const CAP_MODEL_LANGUAGE: u32 = 1 << 3;
pub const CAP_MODEL_SPEECH: u32 = 1 << 4;
pub const CAP_HUMAN_REVIEW: u32 = 1 << 5;
pub const CAP_FAILURE_BOUNTY: u32 = 1 << 6;
