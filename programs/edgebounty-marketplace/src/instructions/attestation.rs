use anchor_lang::prelude::*;

use crate::{constants::*, error::EdgeBountyError, state::*};

#[derive(Accounts)]
pub struct RevokeAttestation<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, PlatformConfig>>,
    #[account(mut)]
    pub attestation: Box<Account<'info, Attestation>>,
}

/// The issuing verifier (e.g. found a bug in its pipeline) or the admin (e.g. proven
/// misconduct) can revoke. Revocation is permanent and visible to every reader.
pub fn handle_revoke_attestation(ctx: Context<RevokeAttestation>) -> Result<()> {
    let who = ctx.accounts.authority.key();
    let a = &mut ctx.accounts.attestation;
    require!(
        who == a.verifier || who == ctx.accounts.config.admin,
        EdgeBountyError::Unauthorized
    );
    require!(!a.revoked, EdgeBountyError::AlreadyRevoked);
    a.revoked = true;
    Ok(())
}
