use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::EdgeBountyError,
    instructions::order::emit_state,
    state::*,
    util::now,
};

#[derive(Accounts)]
pub struct OpenDispute<'info> {
    #[account(mut)]
    pub opener: Signer<'info>,
    #[account(mut)]
    pub order: Box<Account<'info, Order>>,
    #[account(
        init,
        payer = opener,
        space = 8 + Dispute::INIT_SPACE,
        seeds = [DISPUTE_SEED, order.key().as_ref(), &[order.dispute_count]],
        bump
    )]
    pub dispute: Box<Account<'info, Dispute>>,
    pub system_program: Program<'info, System>,
}

/// Buyer: during the review window.
/// Seller: while a correction is demanded (contesting the rejection).
/// Either party: if the verifier has not answered within one review window.
/// Each dispute gets its own PDA (indexed), so a resolved dispute cannot be reopened.
pub fn handle_open_dispute(ctx: Context<OpenDispute>, reason_hash: [u8; 32]) -> Result<()> {
    let t = now()?;
    let opener = ctx.accounts.opener.key();
    let o = &mut ctx.accounts.order;
    let is_buyer = opener == o.buyer;
    let is_seller = opener == o.seller && o.seller != Pubkey::default();
    require!(is_buyer || is_seller, EdgeBountyError::Unauthorized);

    let allowed = match o.state {
        OrderState::UnderReview => is_buyer && t <= o.review_deadline,
        OrderState::CorrectionRequired => is_seller && t <= o.correction_deadline,
        OrderState::Submitted => {
            o.has_verifier()
                && t > o.submitted_at.checked_add(o.review_window_secs).ok_or(EdgeBountyError::Overflow)?
        }
        _ => false,
    };
    require!(allowed, EdgeBountyError::InvalidState);

    let d = &mut ctx.accounts.dispute;
    d.subject = o.key();
    d.opened_by = opener;
    d.reason_hash = reason_hash;
    d.buyer_evidence = [0u8; 32];
    d.seller_evidence = [0u8; 32];
    d.evidence_count = 0;
    d.resolution = DisputeResolution::Pending;
    d.seller_bps = 0;
    d.opened_at = t;
    d.resolved_at = 0;
    d.bump = ctx.bumps.dispute;

    o.state = OrderState::Disputed;
    o.disputed = true;
    o.dispute_count = o.dispute_count.checked_add(1).ok_or(EdgeBountyError::Overflow)?;
    emit_state(o)
}

#[derive(Accounts)]
pub struct AddEvidence<'info> {
    pub party: Signer<'info>,
    pub order: Box<Account<'info, Order>>,
    #[account(mut, seeds = [DISPUTE_SEED, order.key().as_ref(), &[order.dispute_count.saturating_sub(1)]], bump = dispute.bump)]
    pub dispute: Box<Account<'info, Dispute>>,
}

/// Evidence files stay private off-chain; only their hashes are recorded here.
pub fn handle_add_dispute_evidence(ctx: Context<AddEvidence>, evidence_hash: [u8; 32]) -> Result<()> {
    let o = &ctx.accounts.order;
    require!(o.state == OrderState::Disputed, EdgeBountyError::InvalidState);
    let party = ctx.accounts.party.key();
    let d = &mut ctx.accounts.dispute;
    if party == o.buyer {
        d.buyer_evidence = evidence_hash;
    } else if party == o.seller {
        d.seller_evidence = evidence_hash;
    } else {
        return err!(EdgeBountyError::Unauthorized);
    }
    d.evidence_count = d.evidence_count.saturating_add(1);
    Ok(())
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    /// The platform dispute authority, or the order's agreed independent arbitrator.
    pub dispute_authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, PlatformConfig>>,
    #[account(mut)]
    pub order: Box<Account<'info, Order>>,
    #[account(mut, seeds = [DISPUTE_SEED, order.key().as_ref(), &[order.dispute_count.saturating_sub(1)]], bump = dispute.bump)]
    pub dispute: Box<Account<'info, Dispute>>,
}

/// The resolver can only (a) send the work back for correction or (b) split the escrow
/// between buyer and seller. It can never direct funds elsewhere.
pub fn handle_resolve_dispute(
    ctx: Context<ResolveDispute>,
    resolution: DisputeResolution,
    seller_bps: u16,
) -> Result<()> {
    let t = now()?;
    let who = ctx.accounts.dispute_authority.key();
    let o = &mut ctx.accounts.order;
    require!(
        who == ctx.accounts.config.dispute_authority || (o.arbitrator != Pubkey::default() && who == o.arbitrator),
        EdgeBountyError::Unauthorized
    );
    let d = &mut ctx.accounts.dispute;
    require!(o.state == OrderState::Disputed, EdgeBountyError::InvalidState);
    require!(d.resolution == DisputeResolution::Pending, EdgeBountyError::InvalidState);
    match resolution {
        DisputeResolution::Correction => {
            require!(o.seller != Pubkey::default(), EdgeBountyError::InvalidResolution);
            require!(o.submission_count < o.submissions_allowed(), EdgeBountyError::NoCorrectionsLeft);
            o.state = OrderState::CorrectionRequired;
            o.correction_deadline = t
                .checked_add(o.correction_window_secs)
                .ok_or(EdgeBountyError::Overflow)?;
        }
        DisputeResolution::Split => {
            require!((seller_bps as u64) <= BPS_DENOMINATOR, EdgeBountyError::InvalidBps);
            o.state = OrderState::Approved;
            o.seller_bps = seller_bps;
        }
        DisputeResolution::Pending => return err!(EdgeBountyError::InvalidResolution),
    }
    d.resolution = resolution;
    d.seller_bps = seller_bps;
    d.resolved_at = t;
    emit_state(o)
}
