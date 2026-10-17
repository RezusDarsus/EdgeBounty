use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    constants::*,
    error::EdgeBountyError,
    events::*,
    instructions::provider::require_approved_verifier,
    state::*,
    util::{close_vault, now, user_transfer, vault_transfer},
};

pub fn emit_state(order: &Account<Order>) -> Result<()> {
    emit!(OrderStateChanged {
        order: order.key(),
        buyer: order.buyer,
        seller: order.seller,
        state: order.state,
        at: now()?,
    });
    Ok(())
}

fn validate_verifier(
    verifier: Pubkey,
    verifier_fee: u64,
    capability: u32,
    provider: Option<&Provider>,
    buyer: Pubkey,
    seller: Pubkey,
) -> Result<()> {
    if verifier == Pubkey::default() {
        require!(verifier_fee == 0, EdgeBountyError::VerifierMismatch);
        return Ok(());
    }
    let provider = provider.ok_or(EdgeBountyError::VerifierNotApproved)?;
    require_approved_verifier(provider, verifier, capability)?;
    require!(
        verifier != buyer && verifier != seller,
        EdgeBountyError::ConflictOfInterest
    );
    Ok(())
}

// ---------------------------------------------------------------- purchase

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PurchaseParams {
    pub expected_price: u64,
    pub expected_version: u32,
    pub verifier: Pubkey,
    pub verifier_fee: u64,
    pub verifier_capability: u32,
}

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct CreateOrder<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, PlatformConfig>>,
    #[account(mut)]
    pub listing: Box<Account<'info, Listing>>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Order::INIT_SPACE,
        seeds = [ORDER_SEED, buyer.key().as_ref(), &order_id.to_le_bytes()],
        bump
    )]
    pub order: Box<Account<'info, Order>>,
    #[account(
        init,
        payer = buyer,
        seeds = [VAULT_SEED, order.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = order,
        token::token_program = token_program
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(address = config.payment_mint)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token: Box<Account<'info, TokenAccount>>,
    pub verifier_provider: Option<Box<Account<'info, Provider>>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Purchase an existing listing. Funds immediately; the listed asset version is the deliverable.
pub fn handle_create_order(ctx: Context<CreateOrder>, order_id: u64, p: PurchaseParams) -> Result<()> {
    let config = &ctx.accounts.config;
    let listing = &ctx.accounts.listing;
    let buyer = ctx.accounts.buyer.key();
    require!(!config.paused, EdgeBountyError::Paused);
    require!(listing.active && !listing.moderated, EdgeBountyError::ListingUnavailable);
    require!(
        listing.price == p.expected_price && listing.version == p.expected_version,
        EdgeBountyError::ListingChanged
    );
    require!(listing.seller != buyer, EdgeBountyError::ConflictOfInterest);
    let provider = ctx.accounts.verifier_provider.as_ref().map(|b| &***b);
    validate_verifier(p.verifier, p.verifier_fee, p.verifier_capability, provider, buyer, listing.seller)?;

    let t = now()?;
    let o = &mut ctx.accounts.order;
    o.buyer = buyer;
    o.seller = listing.seller;
    o.verifier = p.verifier;
    o.listing = listing.key();
    o.order_id = order_id;
    o.kind = OrderKind::Purchase;
    o.amount = listing.price;
    o.verifier_fee = p.verifier_fee;
    o.fee_bps = config.fee_bps;
    o.terms_hash = listing.terms_hash;
    o.criteria_hash = [0u8; 32];
    o.license_hash = listing.license_hash;
    o.deadline = 0;
    o.review_window_secs = config.review_window_secs;
    o.correction_window_secs = config.correction_window_secs;
    o.max_corrections = 0;
    o.submission_count = 1;
    o.current_commitment = listing.asset_commitment;
    o.current_version = listing.version;
    o.submitted_at = t;
    o.seller_bps = BPS_DENOMINATOR as u16;
    o.created_at = t;
    o.funded_at = t;
    o.bump = ctx.bumps.order;
    if o.has_verifier() {
        o.state = OrderState::Submitted;
    } else {
        o.state = OrderState::UnderReview;
        o.review_deadline = t.checked_add(o.review_window_secs).ok_or(EdgeBountyError::Overflow)?;
    }

    let total = o.amount.checked_add(o.verifier_fee).ok_or(EdgeBountyError::Overflow)?;
    user_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.buyer_token,
        &ctx.accounts.mint,
        ctx.accounts.vault.to_account_info(),
        ctx.accounts.buyer.to_account_info(),
        total,
    )?;
    emit_state(o)
}

// ---------------------------------------------------------------- custom bounty

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BountyParams {
    pub amount: u64,
    pub verifier: Pubkey,
    pub verifier_fee: u64,
    pub verifier_capability: u32,
    pub terms_hash: [u8; 32],
    pub criteria_hash: [u8; 32],
    pub license_hash: [u8; 32],
    pub deadline: i64,
    pub max_corrections: u8,
    /// Default pubkey = open to any seller.
    pub designated_seller: Pubkey,
    /// Default pubkey = platform dispute authority only.
    pub arbitrator: Pubkey,
}

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct CreateBounty<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, PlatformConfig>>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Order::INIT_SPACE,
        seeds = [ORDER_SEED, buyer.key().as_ref(), &order_id.to_le_bytes()],
        bump
    )]
    pub order: Box<Account<'info, Order>>,
    pub verifier_provider: Option<Box<Account<'info, Provider>>>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_bounty(ctx: Context<CreateBounty>, order_id: u64, p: BountyParams) -> Result<()> {
    let config = &ctx.accounts.config;
    let buyer = ctx.accounts.buyer.key();
    require!(!config.paused, EdgeBountyError::Paused);
    require!(p.amount > 0, EdgeBountyError::ZeroAmount);
    require!(p.max_corrections <= MAX_CORRECTIONS, EdgeBountyError::TooManyCorrections);
    let t = now()?;
    require!(p.deadline > t, EdgeBountyError::InvalidDeadline);
    let provider = ctx.accounts.verifier_provider.as_ref().map(|b| &***b);
    validate_verifier(p.verifier, p.verifier_fee, p.verifier_capability, provider, buyer, p.designated_seller)?;
    require!(p.designated_seller != buyer, EdgeBountyError::ConflictOfInterest);
    require!(
        p.arbitrator == Pubkey::default()
            || (p.arbitrator != buyer && p.arbitrator != p.designated_seller && p.arbitrator != p.verifier),
        EdgeBountyError::ConflictOfInterest
    );

    let o = &mut ctx.accounts.order;
    o.buyer = buyer;
    o.seller = Pubkey::default();
    o.verifier = p.verifier;
    o.listing = Pubkey::default();
    o.order_id = order_id;
    o.kind = OrderKind::Bounty;
    o.state = OrderState::Created;
    o.amount = p.amount;
    o.verifier_fee = p.verifier_fee;
    o.terms_hash = p.terms_hash;
    o.criteria_hash = p.criteria_hash;
    o.license_hash = p.license_hash;
    o.deadline = p.deadline;
    o.max_corrections = p.max_corrections;
    o.designated_seller = p.designated_seller;
    o.arbitrator = p.arbitrator;
    o.seller_bps = BPS_DENOMINATOR as u16;
    o.created_at = t;
    o.bump = ctx.bumps.order;
    emit_state(o)
}

#[derive(Accounts)]
pub struct FundBounty<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, PlatformConfig>>,
    #[account(mut, has_one = buyer @ EdgeBountyError::Unauthorized)]
    pub order: Box<Account<'info, Order>>,
    #[account(
        init,
        payer = buyer,
        seeds = [VAULT_SEED, order.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = order,
        token::token_program = token_program
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(address = config.payment_mint)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Locks amount, fee and review windows. Terms are immutable from here on.
pub fn handle_fund_bounty(ctx: Context<FundBounty>) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, EdgeBountyError::Paused);
    let t = now()?;
    let o = &mut ctx.accounts.order;
    require!(o.state == OrderState::Created, EdgeBountyError::InvalidState);
    require!(o.deadline > t, EdgeBountyError::DeadlinePassed);
    o.state = OrderState::Funded;
    o.fee_bps = config.fee_bps;
    o.review_window_secs = config.review_window_secs;
    o.correction_window_secs = config.correction_window_secs;
    o.funded_at = t;
    let total = o.amount.checked_add(o.verifier_fee).ok_or(EdgeBountyError::Overflow)?;
    user_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.buyer_token,
        &ctx.accounts.mint,
        ctx.accounts.vault.to_account_info(),
        ctx.accounts.buyer.to_account_info(),
        total,
    )?;
    emit_state(o)
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut, has_one = buyer @ EdgeBountyError::Unauthorized)]
    pub order: Box<Account<'info, Order>>,
    /// Required only when the order is funded.
    #[account(mut, seeds = [VAULT_SEED, order.key().as_ref()], bump)]
    pub vault: Option<Box<Account<'info, TokenAccount>>>,
    pub mint: Option<Box<Account<'info, Mint>>>,
    #[account(mut, token::authority = buyer)]
    pub buyer_token: Option<Box<Account<'info, TokenAccount>>>,
    pub token_program: Program<'info, Token>,
}

/// Cancel before any seller has accepted. Funded orders are fully refunded.
pub fn handle_cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
    let state = ctx.accounts.order.state;
    match state {
        OrderState::Created => {}
        OrderState::Funded => {
            let vault = ctx.accounts.vault.as_ref().ok_or(EdgeBountyError::InvalidState)?;
            let mint = ctx.accounts.mint.as_ref().ok_or(EdgeBountyError::InvalidState)?;
            let buyer_token = ctx.accounts.buyer_token.as_ref().ok_or(EdgeBountyError::InvalidState)?;
            require_keys_eq!(buyer_token.mint, mint.key(), EdgeBountyError::TokenOwnerMismatch);
            let o = &ctx.accounts.order;
            let buyer = o.buyer;
            let id = o.order_id.to_le_bytes();
            let bump = [o.bump];
            let seeds: &[&[u8]] = &[ORDER_SEED, buyer.as_ref(), &id, &bump];
            vault_transfer(
                &ctx.accounts.token_program,
                vault,
                mint,
                buyer_token.to_account_info(),
                o.to_account_info(),
                &[seeds],
                vault.amount,
            )?;
            close_vault(
                &ctx.accounts.token_program,
                vault,
                ctx.accounts.buyer.to_account_info(),
                o.to_account_info(),
                &[seeds],
            )?;
        }
        _ => return err!(EdgeBountyError::InvalidState),
    }
    let o = &mut ctx.accounts.order;
    o.state = OrderState::Cancelled;
    o.closed_at = now()?;
    emit_state(o)
}

#[derive(Accounts)]
pub struct AcceptBounty<'info> {
    pub seller: Signer<'info>,
    #[account(mut)]
    pub order: Box<Account<'info, Order>>,
}

pub fn handle_accept_bounty(ctx: Context<AcceptBounty>) -> Result<()> {
    let seller = ctx.accounts.seller.key();
    let o = &mut ctx.accounts.order;
    require!(o.state == OrderState::Funded, EdgeBountyError::InvalidState);
    require!(now()? < o.deadline, EdgeBountyError::DeadlinePassed);
    require!(seller != o.buyer && seller != o.verifier && seller != o.arbitrator, EdgeBountyError::ConflictOfInterest);
    require!(
        o.designated_seller == Pubkey::default() || o.designated_seller == seller,
        EdgeBountyError::Unauthorized
    );
    o.seller = seller;
    o.state = OrderState::Assigned;
    emit_state(o)
}

// ---------------------------------------------------------------- submission & review

#[derive(Accounts)]
pub struct SubmitDeliverable<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut, has_one = seller @ EdgeBountyError::Unauthorized)]
    pub order: Box<Account<'info, Order>>,
    #[account(
        init,
        payer = seller,
        space = 8 + Submission::INIT_SPACE,
        seeds = [SUBMISSION_SEED, order.key().as_ref(), &[order.submission_count]],
        bump
    )]
    pub submission: Box<Account<'info, Submission>>,
    pub system_program: Program<'info, System>,
}

pub fn handle_submit_deliverable(ctx: Context<SubmitDeliverable>, commitment: [u8; 32], version: u32) -> Result<()> {
    let t = now()?;
    let o = &mut ctx.accounts.order;
    match o.state {
        OrderState::Assigned => require!(t <= o.deadline, EdgeBountyError::DeadlinePassed),
        OrderState::CorrectionRequired => {
            require!(t <= o.correction_deadline, EdgeBountyError::DeadlinePassed)
        }
        _ => return err!(EdgeBountyError::InvalidState),
    }
    require!(o.submission_count < o.submissions_allowed(), EdgeBountyError::NoCorrectionsLeft);

    let s = &mut ctx.accounts.submission;
    s.order = o.key();
    s.seller = o.seller;
    s.index = o.submission_count;
    s.commitment = commitment;
    s.version = version;
    s.submitted_at = t;
    s.bump = ctx.bumps.submission;

    o.submission_count += 1;
    o.current_commitment = commitment;
    o.current_version = version;
    o.submitted_at = t;
    o.verdict_current = false;
    o.verdict_passed = false;
    if o.has_verifier() {
        o.state = OrderState::Submitted;
    } else {
        o.state = OrderState::UnderReview;
        o.review_deadline = t.checked_add(o.review_window_secs).ok_or(EdgeBountyError::Overflow)?;
    }
    emit_state(o)
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct VerdictParams {
    pub result_hash: [u8; 32],
    pub spec_hash: [u8; 32],
    pub benchmark_version: u32,
    pub passed: bool,
    pub expires_at: i64,
}

#[derive(Accounts)]
pub struct SubmitOrderVerification<'info> {
    #[account(mut)]
    pub verifier: Signer<'info>,
    #[account(mut, has_one = verifier @ EdgeBountyError::VerifierMismatch)]
    pub order: Box<Account<'info, Order>>,
    #[account(
        mut,
        seeds = [PROVIDER_SEED, verifier.key().as_ref()],
        bump = provider.bump
    )]
    pub provider: Box<Account<'info, Provider>>,
    #[account(
        init,
        payer = verifier,
        space = 8 + Attestation::INIT_SPACE,
        seeds = [ATTESTATION_SEED, order.key().as_ref(), &[order.submission_count]],
        bump
    )]
    pub attestation: Box<Account<'info, Attestation>>,
    pub system_program: Program<'info, System>,
}

pub fn handle_submit_order_verification(ctx: Context<SubmitOrderVerification>, v: VerdictParams) -> Result<()> {
    require!(ctx.accounts.provider.approved, EdgeBountyError::VerifierNotApproved);
    let t = now()?;
    let o = &mut ctx.accounts.order;
    require!(o.state == OrderState::Submitted, EdgeBountyError::InvalidState);

    let a = &mut ctx.accounts.attestation;
    a.subject = o.key();
    a.verifier = o.verifier;
    a.asset_commitment = o.current_commitment;
    a.asset_version = o.current_version;
    a.spec_hash = v.spec_hash;
    a.benchmark_version = v.benchmark_version;
    a.result_hash = v.result_hash;
    a.passed = v.passed;
    a.issued_at = t;
    a.expires_at = v.expires_at;
    a.revoked = false;
    a.bump = ctx.bumps.attestation;

    o.verifications_done = o.verifications_done.saturating_add(1);
    o.verdict_current = true;
    o.verdict_passed = v.passed;
    o.state = OrderState::UnderReview;
    o.review_deadline = t.checked_add(o.review_window_secs).ok_or(EdgeBountyError::Overflow)?;

    let p = &mut ctx.accounts.provider;
    p.jobs_completed = p.jobs_completed.saturating_add(1);

    emit!(AttestationIssued {
        attestation: a.key(),
        subject: a.subject,
        verifier: a.verifier,
        passed: v.passed,
    });
    emit_state(o)
}

#[derive(Accounts)]
pub struct BuyerAction<'info> {
    pub buyer: Signer<'info>,
    #[account(mut, has_one = buyer @ EdgeBountyError::Unauthorized)]
    pub order: Box<Account<'info, Order>>,
}

pub fn handle_accept_deliverable(ctx: Context<BuyerAction>) -> Result<()> {
    let o = &mut ctx.accounts.order;
    require!(o.state == OrderState::UnderReview, EdgeBountyError::InvalidState);
    o.state = OrderState::Approved;
    o.seller_bps = BPS_DENOMINATOR as u16;
    emit_state(o)
}

/// Objective rejection: allowed only when the agreed verifier recorded a FAILED verdict
/// for the current submission and corrections remain.
pub fn handle_reject_deliverable(ctx: Context<BuyerAction>) -> Result<()> {
    let t = now()?;
    let o = &mut ctx.accounts.order;
    require!(o.state == OrderState::UnderReview, EdgeBountyError::InvalidState);
    require!(t <= o.review_deadline, EdgeBountyError::DeadlinePassed);
    require!(o.verdict_current && !o.verdict_passed, EdgeBountyError::RejectionNotAllowed);
    require!(o.submission_count < o.submissions_allowed(), EdgeBountyError::NoCorrectionsLeft);
    o.state = OrderState::CorrectionRequired;
    o.correction_deadline = t.checked_add(o.correction_window_secs).ok_or(EdgeBountyError::Overflow)?;
    emit_state(o)
}
