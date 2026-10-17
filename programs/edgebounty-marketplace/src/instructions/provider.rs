use anchor_lang::prelude::*;

use crate::{constants::*, error::EdgeBountyError, state::*, util::now};

#[derive(Accounts)]
pub struct RegisterProvider<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Provider::INIT_SPACE,
        seeds = [PROVIDER_SEED, authority.key().as_ref()],
        bump
    )]
    pub provider: Account<'info, Provider>,
    pub system_program: Program<'info, System>,
}

/// Registration does not grant trust: providers start unapproved.
pub fn handle_register_provider(
    ctx: Context<RegisterProvider>,
    metadata_hash: [u8; 32],
    requested_capabilities: u32,
) -> Result<()> {
    let p = &mut ctx.accounts.provider;
    p.authority = ctx.accounts.authority.key();
    p.approved = false;
    p.capabilities = 0;
    p.requested_capabilities = requested_capabilities;
    p.metadata_hash = metadata_hash;
    p.jobs_completed = 0;
    p.jobs_disputed = 0;
    p.registered_at = now()?;
    p.bump = ctx.bumps.provider;
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateProvider<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [PROVIDER_SEED, authority.key().as_ref()], bump = provider.bump, has_one = authority)]
    pub provider: Account<'info, Provider>,
}

/// Requesting new capabilities keeps current grants; the admin must approve additions.
pub fn handle_update_provider(
    ctx: Context<UpdateProvider>,
    metadata_hash: [u8; 32],
    requested_capabilities: u32,
) -> Result<()> {
    let p = &mut ctx.accounts.provider;
    p.metadata_hash = metadata_hash;
    p.requested_capabilities = requested_capabilities;
    p.capabilities &= requested_capabilities;
    Ok(())
}

#[derive(Accounts)]
pub struct ReviewProvider<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ EdgeBountyError::Unauthorized)]
    pub config: Account<'info, PlatformConfig>,
    #[account(mut, seeds = [PROVIDER_SEED, provider.authority.as_ref()], bump = provider.bump)]
    pub provider: Account<'info, Provider>,
}

/// Approve (or suspend with `approved = false`) and set granted capabilities.
pub fn handle_review_provider(ctx: Context<ReviewProvider>, approved: bool, capabilities: u32) -> Result<()> {
    let p = &mut ctx.accounts.provider;
    p.approved = approved;
    p.capabilities = capabilities & p.requested_capabilities;
    Ok(())
}

pub fn require_approved_verifier(
    provider: &Provider,
    verifier: Pubkey,
    capability: u32,
) -> Result<()> {
    require_keys_eq!(provider.authority, verifier, EdgeBountyError::VerifierMismatch);
    require!(provider.approved, EdgeBountyError::VerifierNotApproved);
    require!(
        provider.capabilities & capability == capability,
        EdgeBountyError::MissingCapability
    );
    Ok(())
}
