use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum OrderState {
    Created,
    Funded,
    Assigned,
    Submitted,
    UnderReview,
    Approved,
    Disputed,
    CorrectionRequired,
    Settled,
    Refunded,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum OrderKind {
    /// Purchase of an existing listing.
    Purchase,
    /// Funded custom development request.
    Bounty,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum AssetKind {
    Dataset,
    Model,
    Code,
    Other,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum DisputeResolution {
    Pending,
    /// Seller must resubmit; order returns to CorrectionRequired.
    Correction,
    /// Escrow split: `seller_bps` to the seller (minus fee), rest refunded.
    Split,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum JobState {
    Open,
    Accepted,
    ResultSubmitted,
    Disputed,
    Resolved,
    Completed,
    Refunded,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum ExampleState {
    Pending,
    Accepted,
    Rejected,
}

#[account]
#[derive(InitSpace)]
pub struct PlatformConfig {
    pub admin: Pubkey,
    /// Two-step admin transfer target (default = none).
    pub pending_admin: Pubkey,
    pub dispute_authority: Pubkey,
    pub payment_mint: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub review_window_secs: i64,
    pub correction_window_secs: i64,
    pub failure_bounty_grace_secs: i64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Provider {
    pub authority: Pubkey,
    pub approved: bool,
    /// Capabilities granted by the admin.
    pub capabilities: u32,
    /// Capabilities the provider asked for.
    pub requested_capabilities: u32,
    /// Hash of the off-chain provider profile (hardware, pricing, methods).
    pub metadata_hash: [u8; 32],
    pub jobs_completed: u64,
    pub jobs_disputed: u64,
    pub registered_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Listing {
    pub seller: Pubkey,
    pub listing_id: u64,
    pub kind: AssetKind,
    pub version: u32,
    pub asset_commitment: [u8; 32],
    pub terms_hash: [u8; 32],
    pub license_hash: [u8; 32],
    pub price: u64,
    pub active: bool,
    pub moderated: bool,
    pub sales: u64,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Order {
    pub buyer: Pubkey,
    /// Default pubkey until a seller accepts a bounty.
    pub seller: Pubkey,
    /// Default pubkey when no independent verifier is required.
    pub verifier: Pubkey,
    /// Default pubkey for custom bounties.
    pub listing: Pubkey,
    pub order_id: u64,
    pub kind: OrderKind,
    pub state: OrderState,
    pub amount: u64,
    pub verifier_fee: u64,
    /// Platform fee locked at funding time.
    pub fee_bps: u16,
    pub terms_hash: [u8; 32],
    pub criteria_hash: [u8; 32],
    pub license_hash: [u8; 32],
    pub deadline: i64,
    pub review_window_secs: i64,
    pub correction_window_secs: i64,
    pub review_deadline: i64,
    pub correction_deadline: i64,
    pub submitted_at: i64,
    pub max_corrections: u8,
    pub submission_count: u8,
    pub current_commitment: [u8; 32],
    pub current_version: u32,
    pub verifications_done: u8,
    pub verdict_current: bool,
    pub verdict_passed: bool,
    pub disputed: bool,
    pub dispute_count: u8,
    /// If set, only this wallet may accept the bounty (milestone continuations, direct hires).
    pub designated_seller: Pubkey,
    /// If set, this agreed independent arbitrator may resolve disputes on this order
    /// (in addition to the platform dispute authority).
    pub arbitrator: Pubkey,
    pub seller_bps: u16,
    pub created_at: i64,
    pub funded_at: i64,
    pub closed_at: i64,
    pub bump: u8,
}

impl Order {
    pub fn has_verifier(&self) -> bool {
        self.verifier != Pubkey::default()
    }
    pub fn submissions_allowed(&self) -> u8 {
        self.max_corrections.saturating_add(1)
    }
}

#[account]
#[derive(InitSpace)]
pub struct Submission {
    pub order: Pubkey,
    pub seller: Pubkey,
    pub index: u8,
    pub commitment: [u8; 32],
    pub version: u32,
    pub submitted_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Attestation {
    /// Order, verification job, or failure example this attestation is about.
    pub subject: Pubkey,
    pub verifier: Pubkey,
    pub asset_commitment: [u8; 32],
    pub asset_version: u32,
    pub spec_hash: [u8; 32],
    pub benchmark_version: u32,
    pub result_hash: [u8; 32],
    pub passed: bool,
    pub issued_at: i64,
    /// 0 = no expiry.
    pub expires_at: i64,
    pub revoked: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Dispute {
    pub subject: Pubkey,
    pub opened_by: Pubkey,
    pub reason_hash: [u8; 32],
    pub buyer_evidence: [u8; 32],
    pub seller_evidence: [u8; 32],
    pub evidence_count: u16,
    pub resolution: DisputeResolution,
    pub seller_bps: u16,
    pub opened_at: i64,
    pub resolved_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct LicenseReceipt {
    pub order: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub listing: Pubkey,
    pub asset_commitment: [u8; 32],
    pub asset_version: u32,
    pub license_hash: [u8; 32],
    pub terms_hash: [u8; 32],
    /// False when the order settled with a full refund (no entitlement).
    pub granted: bool,
    pub issued_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Reputation {
    pub wallet: Pubkey,
    pub sales_completed: u32,
    pub purchases_completed: u32,
    pub volume_sold: u64,
    pub volume_bought: u64,
    pub disputed_orders: u32,
    pub refunded_orders: u32,
    pub verified_contributions: u32,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct FailureBounty {
    pub creator: Pubkey,
    pub bounty_id: u64,
    pub verifier: Pubkey,
    pub model_commitment: [u8; 32],
    pub spec_hash: [u8; 32],
    pub terms_hash: [u8; 32],
    pub reward_per_example: u64,
    pub verifier_fee: u64,
    pub fee_bps: u16,
    pub max_examples: u16,
    pub max_evaluations: u16,
    pub accepted: u16,
    pub evaluations: u16,
    pub pending: u16,
    pub expires_at: i64,
    pub open: bool,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct FailureExample {
    pub bounty: Pubkey,
    pub contributor: Pubkey,
    pub commitment: [u8; 32],
    pub state: ExampleState,
    pub result_hash: [u8; 32],
    pub submitted_at: i64,
    pub evaluated_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct VerificationJob {
    pub requester: Pubkey,
    pub job_id: u64,
    /// Default = open to any approved provider with the capability.
    pub provider: Pubkey,
    pub required_capability: u32,
    pub asset_commitment: [u8; 32],
    pub spec_hash: [u8; 32],
    pub price: u64,
    pub fee_bps: u16,
    pub deadline: i64,
    pub review_window_secs: i64,
    pub review_deadline: i64,
    pub state: JobState,
    pub result_hash: [u8; 32],
    pub passed: bool,
    pub provider_bps: u16,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ServiceReceipt {
    pub payer: Pubkey,
    pub reference: [u8; 32],
    /// Service kind (1 = storage, 2 = automated verification, 3 = other).
    pub kind: u8,
    pub amount: u64,
    pub paid_at: i64,
    pub bump: u8,
}
