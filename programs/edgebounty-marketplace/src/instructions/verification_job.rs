use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    constants::*,
    error::EdgeBountyError,
    events::{AttestationIssued, JobStateChanged},
    instructions::provider::require_approved_verifier,
    state::*,
    util::{close_vault, compute_payout, now, user_transfer, vault_transfer},
};

fn emit_job(job: &Account<VerificationJob>) -> Result<()> {
    emit!(JobStateChanged {
        job: job.key(),
        state: job.state,
        at: now()?,
    });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct JobParams {
    /// Default pubkey = open to any approved provider with `required_capability`.
    pub provider: Pubkey,
    pub required_capability: u32,
    pub asset_commitment: [u8; 32],
    pub spec_hash: [u8; 32],
    pub price: u64,
    pub deadline: i64,
}

#[derive(Accounts)]
#[instruction(job_id: u64)]
pub struct CreateVerificationJob<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, PlatformConfig>>,
    #[account(
        init,
        payer = requester,
        space = 8 + VerificationJob::INIT_SPACE,
        seeds = [JOB_SEED, requester.key().as_ref(), &job_id.to_le_bytes()],
        bump
    )]
    pub job: Box<Account<'info, VerificationJob>>,
    #[account(
        init,
        payer = requester,
        seeds = [JOB_VAULT_SEED, job.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = job,
        token::token_program = token_program
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(address = config.payment_mint)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = mint, token::authority = requester)]
    pub requester_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_verification_job(ctx: Context<CreateVerificationJob>, job_id: u64, p: JobParams) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, EdgeBountyError::Paused);
    require!(p.price > 0, EdgeBountyError::ZeroAmount);
    let t = now()?;
    require!(p.deadline > t, EdgeBountyError::InvalidDeadline);
    require!(p.provider != ctx.accounts.requester.key(), EdgeBountyError::ConflictOfInterest);

    let j = &mut ctx.accounts.job;
    j.requester = ctx.accounts.requester.key();
    j.job_id = job_id;
    j.provider = p.provider;
    j.required_capability = p.required_capability;
    j.asset_commitment = p.asset_commitment;
    j.spec_hash = p.spec_hash;
    j.price = p.price;
    j.fee_bps = config.fee_bps;
    j.deadline = p.deadline;
    j.review_window_secs = config.review_window_secs;
    j.review_deadline = 0;
    j.state = JobState::Open;
    j.result_hash = [0u8; 32];
    j.passed = false;
    j.provider_bps = 0;
    j.created_at = t;
    j.bump = ctx.bumps.job;

    user_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.requester_token,
        &ctx.accounts.mint,
        ctx.accounts.vault.to_account_info(),
        ctx.accounts.requester.to_account_info(),
        p.price,
    )?;
    emit_job(j)
}

#[derive(Accounts)]
pub struct AcceptVerificationJob<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [PROVIDER_SEED, authority.key().as_ref()], bump = provider.bump)]
    pub provider: Box<Account<'info, Provider>>,
    #[account(mut)]
    pub job: Box<Account<'info, VerificationJob>>,
}

pub fn handle_accept_verification_job(ctx: Context<AcceptVerificationJob>) -> Result<()> {
    let who = ctx.accounts.authority.key();
    let j = &mut ctx.accounts.job;
    require!(j.state == JobState::Open, EdgeBountyError::InvalidState);
    require!(now()? < j.deadline, EdgeBountyError::DeadlinePassed);
    require!(who != j.requester, EdgeBountyError::ConflictOfInterest);
    require!(
        j.provider == Pubkey::default() || j.provider == who,
        EdgeBountyError::VerifierMismatch
    );
    require_approved_verifier(&ctx.accounts.provider, who, j.required_capability)?;
    j.provider = who;
    j.state = JobState::Accepted;
    emit_job(j)
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct JobResultParams {
    pub result_hash: [u8; 32],
    pub passed: bool,
    pub asset_version: u32,
    pub benchmark_version: u32,
    pub expires_at: i64,
}

#[derive(Accounts)]
pub struct SubmitJobResult<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [PROVIDER_SEED, authority.key().as_ref()], bump = provider.bump)]
    pub provider: Box<Account<'info, Provider>>,
    #[account(mut, constraint = job.provider == authority.key() @ EdgeBountyError::VerifierMismatch)]
    pub job: Box<Account<'info, VerificationJob>>,
    #[account(
        init,
        payer = authority,
        space = 8 + Attestation::INIT_SPACE,
        seeds = [ATTESTATION_SEED, job.key().as_ref(), &[0u8]],
        bump
    )]
    pub attestation: Box<Account<'info, Attestation>>,
    pub system_program: Program<'info, System>,
}

pub fn handle_submit_verification_job_result(ctx: Context<SubmitJobResult>, r: JobResultParams) -> Result<()> {
    require!(ctx.accounts.provider.approved, EdgeBountyError::VerifierNotApproved);
    let t = now()?;
    let j = &mut ctx.accounts.job;
    require!(j.state == JobState::Accepted, EdgeBountyError::InvalidState);
    require!(t <= j.deadline, EdgeBountyError::DeadlinePassed);

    let a = &mut ctx.accounts.attestation;
    a.subject = j.key();
    a.verifier = j.provider;
    a.asset_commitment = j.asset_commitment;
    a.asset_version = r.asset_version;
    a.spec_hash = j.spec_hash;
    a.benchmark_version = r.benchmark_version;
    a.result_hash = r.result_hash;
    a.passed = r.passed;
    a.issued_at = t;
    a.expires_at = r.expires_at;
    a.revoked = false;
    a.bump = ctx.bumps.attestation;
    emit!(AttestationIssued {
        attestation: a.key(),
        subject: a.subject,
        verifier: a.verifier,
        passed: r.passed,
    });

    j.result_hash = r.result_hash;
    j.passed = r.passed;
    j.state = JobState::ResultSubmitted;
    j.review_deadline = t.checked_add(j.review_window_secs).ok_or(EdgeBountyError::Overflow)?;
    emit_job(j)
}

#[derive(Accounts)]
pub struct DisputeJob<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,
    #[account(mut, has_one = requester @ EdgeBountyError::Unauthorized)]
    pub job: Box<Account<'info, VerificationJob>>,
    #[account(
        init,
        payer = requester,
        space = 8 + Dispute::INIT_SPACE,
        seeds = [DISPUTE_SEED, job.key().as_ref(), &[0u8]],
        bump
    )]
    pub dispute: Box<Account<'info, Dispute>>,
    pub system_program: Program<'info, System>,
}

/// Disputes concern the *work* (e.g. checks not performed), not an unwelcome verdict.
pub fn handle_dispute_verification_job(ctx: Context<DisputeJob>, reason_hash: [u8; 32]) -> Result<()> {
    let t = now()?;
    let j = &mut ctx.accounts.job;
    require!(j.state == JobState::ResultSubmitted, EdgeBountyError::InvalidState);
    require!(t <= j.review_deadline, EdgeBountyError::DeadlinePassed);
    let d = &mut ctx.accounts.dispute;
    d.subject = j.key();
    d.opened_by = j.requester;
    d.reason_hash = reason_hash;
    d.resolution = DisputeResolution::Pending;
    d.opened_at = t;
    d.bump = ctx.bumps.dispute;
    j.state = JobState::Disputed;
    emit_job(j)
}

#[derive(Accounts)]
pub struct ResolveJobDispute<'info> {
    pub dispute_authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = dispute_authority @ EdgeBountyError::Unauthorized)]
    pub config: Box<Account<'info, PlatformConfig>>,
    #[account(mut)]
    pub job: Box<Account<'info, VerificationJob>>,
    #[account(mut, seeds = [DISPUTE_SEED, job.key().as_ref(), &[0u8]], bump = dispute.bump)]
    pub dispute: Box<Account<'info, Dispute>>,
    #[account(mut, seeds = [PROVIDER_SEED, job.provider.as_ref()], bump = provider.bump)]
    pub provider: Box<Account<'info, Provider>>,
}

pub fn handle_resolve_verification_dispute(ctx: Context<ResolveJobDispute>, provider_bps: u16) -> Result<()> {
    require!((provider_bps as u64) <= BPS_DENOMINATOR, EdgeBountyError::InvalidBps);
    let j = &mut ctx.accounts.job;
    require!(j.state == JobState::Disputed, EdgeBountyError::InvalidState);
    j.provider_bps = provider_bps;
    j.state = JobState::Resolved;
    let d = &mut ctx.accounts.dispute;
    d.resolution = DisputeResolution::Split;
    d.seller_bps = provider_bps;
    d.resolved_at = now()?;
    if provider_bps < BPS_DENOMINATOR as u16 {
        let p = &mut ctx.accounts.provider;
        p.jobs_disputed = p.jobs_disputed.saturating_add(1);
    }
    emit_job(j)
}

#[derive(Accounts)]
pub struct SettleJob<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, PlatformConfig>>,
    #[account(mut)]
    pub job: Box<Account<'info, VerificationJob>>,
    #[account(mut, seeds = [JOB_VAULT_SEED, job.key().as_ref()], bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(address = config.payment_mint)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = mint, token::authority = job.provider)]
    pub provider_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = job.requester)]
    pub requester_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = config.treasury @ EdgeBountyError::TreasuryMismatch)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    /// CHECK: receives vault rent; constrained to the requester.
    #[account(mut, address = job.requester)]
    pub requester: UncheckedAccount<'info>,
    #[account(mut, seeds = [PROVIDER_SEED, job.provider.as_ref()], bump = provider.bump)]
    pub provider: Box<Account<'info, Provider>>,
    pub token_program: Program<'info, Token>,
}

/// Requester confirms at any time after the result, anyone may crank after the review
/// window, and resolved disputes settle with the resolver's split.
pub fn handle_settle_verification_job(ctx: Context<SettleJob>) -> Result<()> {
    let t = now()?;
    let j = &ctx.accounts.job;
    let bps = match j.state {
        JobState::ResultSubmitted => {
            require!(
                ctx.accounts.caller.key() == j.requester || t > j.review_deadline,
                EdgeBountyError::DeadlineNotReached
            );
            BPS_DENOMINATOR as u16
        }
        JobState::Resolved => j.provider_bps,
        _ => return err!(EdgeBountyError::InvalidState),
    };
    let p = compute_payout(j.price, 0, j.fee_bps, bps, false)?;
    let requester = j.requester;
    let id = j.job_id.to_le_bytes();
    let bump = [j.bump];
    let seeds: &[&[u8]] = &[JOB_SEED, requester.as_ref(), &id, &bump];
    let auth = j.to_account_info();
    let tp = &ctx.accounts.token_program;
    let vault = &ctx.accounts.vault;
    let mint = &ctx.accounts.mint;
    let extra = vault.amount.saturating_sub(j.price);
    vault_transfer(tp, vault, mint, ctx.accounts.provider_token.to_account_info(), auth.clone(), &[seeds], p.seller_net)?;
    vault_transfer(tp, vault, mint, ctx.accounts.treasury.to_account_info(), auth.clone(), &[seeds], p.platform_fee)?;
    vault_transfer(tp, vault, mint, ctx.accounts.requester_token.to_account_info(), auth.clone(), &[seeds], p.buyer_refund + extra)?;
    close_vault(tp, vault, ctx.accounts.requester.to_account_info(), auth, &[seeds])?;

    if bps > 0 {
        let pr = &mut ctx.accounts.provider;
        pr.jobs_completed = pr.jobs_completed.saturating_add(1);
    }
    let j = &mut ctx.accounts.job;
    j.provider_bps = bps;
    j.state = JobState::Completed;
    emit_job(j)
}

#[derive(Accounts)]
pub struct RefundJob<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,
    #[account(mut, has_one = requester @ EdgeBountyError::Unauthorized)]
    pub job: Box<Account<'info, VerificationJob>>,
    #[account(mut, seeds = [JOB_VAULT_SEED, job.key().as_ref()], bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(address = vault.mint)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = mint, token::authority = requester)]
    pub requester_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

/// Cancel an unaccepted job at any time, or reclaim funds when the provider missed the deadline.
pub fn handle_refund_verification_job(ctx: Context<RefundJob>) -> Result<()> {
    let t = now()?;
    let j = &ctx.accounts.job;
    let allowed = match j.state {
        JobState::Open => true,
        JobState::Accepted => t > j.deadline,
        _ => false,
    };
    require!(allowed, EdgeBountyError::InvalidState);
    let requester = j.requester;
    let id = j.job_id.to_le_bytes();
    let bump = [j.bump];
    let seeds: &[&[u8]] = &[JOB_SEED, requester.as_ref(), &id, &bump];
    let auth = j.to_account_info();
    vault_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.vault,
        &ctx.accounts.mint,
        ctx.accounts.requester_token.to_account_info(),
        auth.clone(),
        &[seeds],
        ctx.accounts.vault.amount,
    )?;
    close_vault(
        &ctx.accounts.token_program,
        &ctx.accounts.vault,
        ctx.accounts.requester.to_account_info(),
        auth,
        &[seeds],
    )?;
    let j = &mut ctx.accounts.job;
    j.state = JobState::Refunded;
    emit_job(j)
}
