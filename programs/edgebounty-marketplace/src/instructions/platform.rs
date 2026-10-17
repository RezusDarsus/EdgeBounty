use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, TokenAccount};

use crate::{constants::*, error::EdgeBountyError, state::*};

fn check_window(secs: i64) -> Result<()> {
    require!(
        (MIN_WINDOW_SECS..=MAX_WINDOW_SECS).contains(&secs),
        EdgeBountyError::InvalidWindow
    );
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PlatformParams {
    pub fee_bps: u16,
    pub review_window_secs: i64,
    pub correction_window_secs: i64,
    pub failure_bounty_grace_secs: i64,
    pub dispute_authority: Pubkey,
}

#[derive(Accounts)]
pub struct InitializePlatform<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + PlatformConfig::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, PlatformConfig>,
    pub payment_mint: Account<'info, Mint>,
    #[account(token::mint = payment_mint)]
    pub treasury: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_platform(ctx: Context<InitializePlatform>, p: PlatformParams) -> Result<()> {
    require!(p.fee_bps <= MAX_FEE_BPS, EdgeBountyError::FeeTooHigh);
    check_window(p.review_window_secs)?;
    check_window(p.correction_window_secs)?;
    check_window(p.failure_bounty_grace_secs)?;
    let c = &mut ctx.accounts.config;
    c.admin = ctx.accounts.admin.key();
    c.pending_admin = Pubkey::default();
    c.dispute_authority = p.dispute_authority;
    c.payment_mint = ctx.accounts.payment_mint.key();
    c.treasury = ctx.accounts.treasury.key();
    c.fee_bps = p.fee_bps;
    c.review_window_secs = p.review_window_secs;
    c.correction_window_secs = p.correction_window_secs;
    c.failure_bounty_grace_secs = p.failure_bounty_grace_secs;
    c.paused = false;
    c.bump = ctx.bumps.config;
    Ok(())
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ EdgeBountyError::Unauthorized)]
    pub config: Account<'info, PlatformConfig>,
}

/// Fee changes only affect orders funded afterwards (fee is locked per order).
pub fn handle_update_config(ctx: Context<AdminOnly>, p: PlatformParams) -> Result<()> {
    require!(p.fee_bps <= MAX_FEE_BPS, EdgeBountyError::FeeTooHigh);
    check_window(p.review_window_secs)?;
    check_window(p.correction_window_secs)?;
    check_window(p.failure_bounty_grace_secs)?;
    let c = &mut ctx.accounts.config;
    c.fee_bps = p.fee_bps;
    c.review_window_secs = p.review_window_secs;
    c.correction_window_secs = p.correction_window_secs;
    c.failure_bounty_grace_secs = p.failure_bounty_grace_secs;
    c.dispute_authority = p.dispute_authority;
    Ok(())
}

pub fn handle_set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    Ok(())
}

pub fn handle_propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
    ctx.accounts.config.pending_admin = new_admin;
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, PlatformConfig>,
}

pub fn handle_accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let c = &mut ctx.accounts.config;
    require!(c.pending_admin != Pubkey::default(), EdgeBountyError::NoPendingAdmin);
    require_keys_eq!(c.pending_admin, ctx.accounts.new_admin.key(), EdgeBountyError::Unauthorized);
    c.admin = c.pending_admin;
    c.pending_admin = Pubkey::default();
    Ok(())
}

#[derive(Accounts)]
pub struct SetTreasury<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ EdgeBountyError::Unauthorized)]
    pub config: Account<'info, PlatformConfig>,
    #[account(token::mint = config.payment_mint)]
    pub treasury: Account<'info, TokenAccount>,
}

pub fn handle_set_treasury(ctx: Context<SetTreasury>) -> Result<()> {
    ctx.accounts.config.treasury = ctx.accounts.treasury.key();
    Ok(())
}
