//! EdgeBounty marketplace program: escrowed AI-asset purchases and custom bounties,
//! independent verification with attestations, AI-failure bounties, standalone
//! verification jobs and service receipts. See docs/protocol/protocol-spec.md.
#![allow(unexpected_cfgs)]

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod util;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("6L6441Vus4rUdQXLiGfFtXUtRWbjqg3Lk1AfCjj6x3E");

#[program]
pub mod edgebounty_marketplace {
    use super::*;

    // ---------------------------------------------------------------- platform
    pub fn initialize_platform(ctx: Context<InitializePlatform>, params: PlatformParams) -> Result<()> {
        instructions::platform::handle_initialize_platform(ctx, params)
    }
    pub fn update_config(ctx: Context<AdminOnly>, params: PlatformParams) -> Result<()> {
        instructions::platform::handle_update_config(ctx, params)
    }
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        instructions::platform::handle_set_paused(ctx, paused)
    }
    pub fn propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        instructions::platform::handle_propose_admin(ctx, new_admin)
    }
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::platform::handle_accept_admin(ctx)
    }
    pub fn set_treasury(ctx: Context<SetTreasury>) -> Result<()> {
        instructions::platform::handle_set_treasury(ctx)
    }

    // ---------------------------------------------------------------- providers
    pub fn register_provider(ctx: Context<RegisterProvider>, metadata_hash: [u8; 32], requested_capabilities: u32) -> Result<()> {
        instructions::provider::handle_register_provider(ctx, metadata_hash, requested_capabilities)
    }
    pub fn update_provider(ctx: Context<UpdateProvider>, metadata_hash: [u8; 32], requested_capabilities: u32) -> Result<()> {
        instructions::provider::handle_update_provider(ctx, metadata_hash, requested_capabilities)
    }
    pub fn review_provider(ctx: Context<ReviewProvider>, approved: bool, capabilities: u32) -> Result<()> {
        instructions::provider::handle_review_provider(ctx, approved, capabilities)
    }

    // ---------------------------------------------------------------- listings
    pub fn create_listing(ctx: Context<CreateListing>, listing_id: u64, kind: AssetKind, terms: ListingTerms) -> Result<()> {
        instructions::listing::handle_create_listing(ctx, listing_id, kind, terms)
    }
    pub fn update_listing_version(ctx: Context<UpdateListing>, terms: ListingTerms) -> Result<()> {
        instructions::listing::handle_update_listing_version(ctx, terms)
    }
    pub fn set_listing_active(ctx: Context<UpdateListing>, active: bool) -> Result<()> {
        instructions::listing::handle_set_listing_active(ctx, active)
    }
    pub fn moderate_listing(ctx: Context<ModerateListing>, moderated: bool) -> Result<()> {
        instructions::listing::handle_moderate_listing(ctx, moderated)
    }

    // ---------------------------------------------------------------- orders
    pub fn create_order(ctx: Context<CreateOrder>, order_id: u64, params: PurchaseParams) -> Result<()> {
        instructions::order::handle_create_order(ctx, order_id, params)
    }
    pub fn create_bounty(ctx: Context<CreateBounty>, order_id: u64, params: BountyParams) -> Result<()> {
        instructions::order::handle_create_bounty(ctx, order_id, params)
    }
    pub fn fund_bounty(ctx: Context<FundBounty>) -> Result<()> {
        instructions::order::handle_fund_bounty(ctx)
    }
    pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
        instructions::order::handle_cancel_order(ctx)
    }
    pub fn accept_bounty(ctx: Context<AcceptBounty>) -> Result<()> {
        instructions::order::handle_accept_bounty(ctx)
    }
    pub fn submit_deliverable(ctx: Context<SubmitDeliverable>, commitment: [u8; 32], version: u32) -> Result<()> {
        instructions::order::handle_submit_deliverable(ctx, commitment, version)
    }
    pub fn submit_order_verification(ctx: Context<SubmitOrderVerification>, verdict: VerdictParams) -> Result<()> {
        instructions::order::handle_submit_order_verification(ctx, verdict)
    }
    pub fn accept_deliverable(ctx: Context<BuyerAction>) -> Result<()> {
        instructions::order::handle_accept_deliverable(ctx)
    }
    pub fn reject_deliverable(ctx: Context<BuyerAction>) -> Result<()> {
        instructions::order::handle_reject_deliverable(ctx)
    }

    // ---------------------------------------------------------------- disputes
    pub fn open_dispute(ctx: Context<OpenDispute>, reason_hash: [u8; 32]) -> Result<()> {
        instructions::dispute::handle_open_dispute(ctx, reason_hash)
    }
    pub fn add_dispute_evidence(ctx: Context<AddEvidence>, evidence_hash: [u8; 32]) -> Result<()> {
        instructions::dispute::handle_add_dispute_evidence(ctx, evidence_hash)
    }
    pub fn resolve_dispute(ctx: Context<ResolveDispute>, resolution: DisputeResolution, seller_bps: u16) -> Result<()> {
        instructions::dispute::handle_resolve_dispute(ctx, resolution, seller_bps)
    }

    // ---------------------------------------------------------------- settlement
    pub fn settle_order(ctx: Context<SettleOrder>) -> Result<()> {
        instructions::settlement::handle_settle_order(ctx)
    }
    pub fn refund_order(ctx: Context<RefundOrder>) -> Result<()> {
        instructions::settlement::handle_refund_order(ctx)
    }

    // ---------------------------------------------------------------- failure bounties
    pub fn create_failure_bounty(ctx: Context<CreateFailureBounty>, bounty_id: u64, params: FailureBountyParams) -> Result<()> {
        instructions::failure_bounty::handle_create_failure_bounty(ctx, bounty_id, params)
    }
    pub fn submit_failure_example(ctx: Context<SubmitFailureExample>, commitment: [u8; 32]) -> Result<()> {
        instructions::failure_bounty::handle_submit_failure_example(ctx, commitment)
    }
    pub fn verify_failure_example(ctx: Context<VerifyFailureExample>, passed: bool, result_hash: [u8; 32]) -> Result<()> {
        instructions::failure_bounty::handle_verify_failure_example(ctx, passed, result_hash)
    }
    pub fn close_failure_bounty(ctx: Context<CloseFailureBounty>) -> Result<()> {
        instructions::failure_bounty::handle_close_failure_bounty(ctx)
    }

    // ---------------------------------------------------------------- verification jobs
    pub fn create_verification_job(ctx: Context<CreateVerificationJob>, job_id: u64, params: JobParams) -> Result<()> {
        instructions::verification_job::handle_create_verification_job(ctx, job_id, params)
    }
    pub fn accept_verification_job(ctx: Context<AcceptVerificationJob>) -> Result<()> {
        instructions::verification_job::handle_accept_verification_job(ctx)
    }
    pub fn submit_verification_job_result(ctx: Context<SubmitJobResult>, result: JobResultParams) -> Result<()> {
        instructions::verification_job::handle_submit_verification_job_result(ctx, result)
    }
    pub fn dispute_verification_job(ctx: Context<DisputeJob>, reason_hash: [u8; 32]) -> Result<()> {
        instructions::verification_job::handle_dispute_verification_job(ctx, reason_hash)
    }
    pub fn resolve_verification_dispute(ctx: Context<ResolveJobDispute>, provider_bps: u16) -> Result<()> {
        instructions::verification_job::handle_resolve_verification_dispute(ctx, provider_bps)
    }
    pub fn settle_verification_job(ctx: Context<SettleJob>) -> Result<()> {
        instructions::verification_job::handle_settle_verification_job(ctx)
    }
    pub fn refund_verification_job(ctx: Context<RefundJob>) -> Result<()> {
        instructions::verification_job::handle_refund_verification_job(ctx)
    }

    // ---------------------------------------------------------------- attestations & services
    pub fn revoke_attestation(ctx: Context<RevokeAttestation>) -> Result<()> {
        instructions::attestation::handle_revoke_attestation(ctx)
    }
    pub fn pay_service(ctx: Context<PayService>, reference: [u8; 32], kind: u8, amount: u64) -> Result<()> {
        instructions::service::handle_pay_service(ctx, reference, kind, amount)
    }
}
