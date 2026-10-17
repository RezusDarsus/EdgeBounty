use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    constants::*,
    error::EdgeBountyError,
    events::{AttestationIssued, FailureExampleEvaluated},
    instructions::provider::require_approved_verifier,
    state::*,
    util::{close_vault, mul_bps, now, user_transfer, vault_transfer},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct FailureBountyParams {
    pub verifier: Pubkey,
    pub model_commitment: [u8; 32],
    pub spec_hash: [u8; 32],
    pub terms_hash: [u8; 32],
    pub reward_per_example: u64,
    pub verifier_fee: u64,
    pub max_examples: u16,
    pub max_evaluations: u16,
    pub expires_at: i64,
}

#[derive(Accounts)]
#[instruction(bounty_id: u64)]
pub struct CreateFailureBounty<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, PlatformConfig>>,
    #[account(
        init,
        payer = creator,
        space = 8 + FailureBounty::INIT_SPACE,
        seeds = [FAILURE_BOUNTY_SEED, creator.key().as_ref(), &bounty_id.to_le_bytes()],
        bump
    )]
    pub bounty: Box<Account<'info, FailureBounty>>,
    #[account(
        init,
        payer = creator,
        seeds = [FAILURE_VAULT_SEED, bounty.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = bounty,
        token::token_program = token_program
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(address = config.payment_mint)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = mint, token::authority = creator)]
    pub creator_token: Box<Account<'info, TokenAccount>>,
    pub verifier_provider: Box<Account<'info, Provider>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_failure_bounty(
    ctx: Context<CreateFailureBounty>,
    bounty_id: u64,
    p: FailureBountyParams,
) -> Result<()> {
    let config = &ctx.accounts.config;
    let creator = ctx.accounts.creator.key();
    require!(!config.paused, EdgeBountyError::Paused);
    require!(p.reward_per_example > 0 && p.max_examples > 0, EdgeBountyError::ZeroAmount);
    require!(p.max_evaluations >= p.max_examples, EdgeBountyError::InvalidState);
    let t = now()?;
    require!(p.expires_at > t, EdgeBountyError::InvalidDeadline);
    require_approved_verifier(&ctx.accounts.verifier_provider, p.verifier, CAP_FAILURE_BOUNTY)?;
    require!(p.verifier != creator, EdgeBountyError::ConflictOfInterest);

    let total = (p.reward_per_example as u128)
        .checked_mul(p.max_examples as u128)
        .and_then(|a| a.checked_add((p.verifier_fee as u128).checked_mul(p.max_evaluations as u128)?))
        .and_then(|v| u64::try_from(v).ok())
        .ok_or(EdgeBountyError::Overflow)?;

    let b = &mut ctx.accounts.bounty;
    b.creator = creator;
    b.bounty_id = bounty_id;
    b.verifier = p.verifier;
    b.model_commitment = p.model_commitment;
    b.spec_hash = p.spec_hash;
    b.terms_hash = p.terms_hash;
    b.reward_per_example = p.reward_per_example;
    b.verifier_fee = p.verifier_fee;
    b.fee_bps = config.fee_bps;
    b.max_examples = p.max_examples;
    b.max_evaluations = p.max_evaluations;
    b.accepted = 0;
    b.evaluations = 0;
    b.pending = 0;
    b.expires_at = p.expires_at;
    b.open = true;
    b.created_at = t;
    b.bump = ctx.bumps.bounty;

    user_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.creator_token,
        &ctx.accounts.mint,
        ctx.accounts.vault.to_account_info(),
        ctx.accounts.creator.to_account_info(),
        total,
    )
}

#[derive(Accounts)]
#[instruction(commitment: [u8; 32])]
pub struct SubmitFailureExample<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,
    #[account(mut)]
    pub bounty: Box<Account<'info, FailureBounty>>,
    /// Seeded by the content commitment: identical submissions collide and fail.
    #[account(
        init,
        payer = contributor,
        space = 8 + FailureExample::INIT_SPACE,
        seeds = [FAILURE_EXAMPLE_SEED, bounty.key().as_ref(), commitment.as_ref()],
        bump
    )]
    pub example: Box<Account<'info, FailureExample>>,
    pub system_program: Program<'info, System>,
}

pub fn handle_submit_failure_example(ctx: Context<SubmitFailureExample>, commitment: [u8; 32]) -> Result<()> {
    let t = now()?;
    let contributor = ctx.accounts.contributor.key();
    let b = &mut ctx.accounts.bounty;
    require!(b.open, EdgeBountyError::BountyClosed);
    require!(t < b.expires_at, EdgeBountyError::DeadlinePassed);
    require!(b.accepted < b.max_examples, EdgeBountyError::BountyFull);
    require!(
        contributor != b.creator && contributor != b.verifier,
        EdgeBountyError::ConflictOfInterest
    );
    b.pending = b.pending.checked_add(1).ok_or(EdgeBountyError::Overflow)?;
    let e = &mut ctx.accounts.example;
    e.bounty = b.key();
    e.contributor = contributor;
    e.commitment = commitment;
    e.state = ExampleState::Pending;
    e.result_hash = [0u8; 32];
    e.submitted_at = t;
    e.evaluated_at = 0;
    e.bump = ctx.bumps.example;
    Ok(())
}

#[derive(Accounts)]
pub struct VerifyFailureExample<'info> {
    #[account(mut)]
    pub verifier: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, PlatformConfig>>,
    #[account(mut, has_one = verifier @ EdgeBountyError::VerifierMismatch)]
    pub bounty: Box<Account<'info, FailureBounty>>,
    #[account(mut, has_one = bounty)]
    pub example: Box<Account<'info, FailureExample>>,
    #[account(mut, seeds = [FAILURE_VAULT_SEED, bounty.key().as_ref()], bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(address = config.payment_mint)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = mint, token::authority = example.contributor)]
    pub contributor_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = verifier)]
    pub verifier_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = config.treasury @ EdgeBountyError::TreasuryMismatch)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    #[account(seeds = [PROVIDER_SEED, verifier.key().as_ref()], bump = provider.bump)]
    pub provider: Box<Account<'info, Provider>>,
    #[account(
        init,
        payer = verifier,
        space = 8 + Attestation::INIT_SPACE,
        seeds = [ATTESTATION_SEED, example.key().as_ref(), &[0u8]],
        bump
    )]
    pub attestation: Box<Account<'info, Attestation>>,
    #[account(
        init_if_needed,
        payer = verifier,
        space = 8 + Reputation::INIT_SPACE,
        seeds = [REPUTATION_SEED, example.contributor.as_ref()],
        bump
    )]
    pub contributor_reputation: Box<Account<'info, Reputation>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// The verifier is paid for every evaluation (pass or fail), up to `max_evaluations`.
pub fn handle_verify_failure_example(
    ctx: Context<VerifyFailureExample>,
    passed: bool,
    result_hash: [u8; 32],
) -> Result<()> {
    require!(ctx.accounts.provider.approved, EdgeBountyError::VerifierNotApproved);
    let t = now()?;
    let b = &ctx.accounts.bounty;
    let e = &ctx.accounts.example;
    require!(e.state == ExampleState::Pending, EdgeBountyError::ExampleAlreadyEvaluated);
    require!(b.evaluations < b.max_evaluations, EdgeBountyError::EvaluationBudgetExhausted);

    let creator = b.creator;
    let id = b.bounty_id.to_le_bytes();
    let bump = [b.bump];
    let seeds: &[&[u8]] = &[FAILURE_BOUNTY_SEED, creator.as_ref(), &id, &bump];
    let auth = b.to_account_info();

    vault_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.vault,
        &ctx.accounts.mint,
        ctx.accounts.verifier_token.to_account_info(),
        auth.clone(),
        &[seeds],
        b.verifier_fee,
    )?;

    let accept = passed && b.accepted < b.max_examples;
    let mut reward_paid = 0;
    if accept {
        let fee = mul_bps(b.reward_per_example, b.fee_bps)?;
        reward_paid = b.reward_per_example - fee;
        vault_transfer(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            ctx.accounts.contributor_token.to_account_info(),
            auth.clone(),
            &[seeds],
            reward_paid,
        )?;
        vault_transfer(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            ctx.accounts.treasury.to_account_info(),
            auth,
            &[seeds],
            fee,
        )?;
    }

    let a = &mut ctx.accounts.attestation;
    a.subject = ctx.accounts.example.key();
    a.verifier = ctx.accounts.verifier.key();
    a.asset_commitment = ctx.accounts.example.commitment;
    a.asset_version = 1;
    a.spec_hash = b.spec_hash;
    a.benchmark_version = 0;
    a.result_hash = result_hash;
    a.passed = passed;
    a.issued_at = t;
    a.expires_at = 0;
    a.revoked = false;
    a.bump = ctx.bumps.attestation;
    emit!(AttestationIssued {
        attestation: a.key(),
        subject: a.subject,
        verifier: a.verifier,
        passed,
    });

    let example_key = ctx.accounts.example.key();
    let e = &mut ctx.accounts.example;
    e.state = if accept { ExampleState::Accepted } else { ExampleState::Rejected };
    e.result_hash = result_hash;
    e.evaluated_at = t;

    let r = &mut ctx.accounts.contributor_reputation;
    r.wallet = e.contributor;
    r.bump = ctx.bumps.contributor_reputation;
    if accept {
        r.verified_contributions = r.verified_contributions.saturating_add(1);
    }

    let b = &mut ctx.accounts.bounty;
    b.evaluations += 1;
    b.pending = b.pending.saturating_sub(1);
    if accept {
        b.accepted += 1;
    }
    emit!(FailureExampleEvaluated {
        bounty: b.key(),
        example: example_key,
        accepted: accept,
        reward_paid,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CloseFailureBounty<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, PlatformConfig>>,
    #[account(mut, has_one = creator @ EdgeBountyError::Unauthorized)]
    pub bounty: Box<Account<'info, FailureBounty>>,
    #[account(mut, seeds = [FAILURE_VAULT_SEED, bounty.key().as_ref()], bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(address = vault.mint)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = mint, token::authority = creator)]
    pub creator_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

/// Returns the remainder once the bounty is filled, or after expiry when nothing is
/// pending, or after expiry + grace regardless (pending examples had their chance).
pub fn handle_close_failure_bounty(ctx: Context<CloseFailureBounty>) -> Result<()> {
    let t = now()?;
    let b = &ctx.accounts.bounty;
    require!(b.open, EdgeBountyError::BountyClosed);
    let filled = b.accepted >= b.max_examples && b.pending == 0;
    let expired_idle = t > b.expires_at && b.pending == 0;
    let grace_over = t > b.expires_at.saturating_add(ctx.accounts.config.failure_bounty_grace_secs);
    require!(filled || expired_idle || grace_over, EdgeBountyError::CannotCloseYet);

    let creator = b.creator;
    let id = b.bounty_id.to_le_bytes();
    let bump = [b.bump];
    let seeds: &[&[u8]] = &[FAILURE_BOUNTY_SEED, creator.as_ref(), &id, &bump];
    vault_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.vault,
        &ctx.accounts.mint,
        ctx.accounts.creator_token.to_account_info(),
        b.to_account_info(),
        &[seeds],
        ctx.accounts.vault.amount,
    )?;
    close_vault(
        &ctx.accounts.token_program,
        &ctx.accounts.vault,
        ctx.accounts.creator.to_account_info(),
        b.to_account_info(),
        &[seeds],
    )?;
    ctx.accounts.bounty.open = false;
    Ok(())
}
