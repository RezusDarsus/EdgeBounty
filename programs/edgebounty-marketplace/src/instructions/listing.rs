use anchor_lang::prelude::*;

use crate::{constants::*, error::EdgeBountyError, state::*, util::now};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ListingTerms {
    pub asset_commitment: [u8; 32],
    pub terms_hash: [u8; 32],
    pub license_hash: [u8; 32],
    pub price: u64,
}

#[derive(Accounts)]
#[instruction(listing_id: u64)]
pub struct CreateListing<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, PlatformConfig>,
    #[account(
        init,
        payer = seller,
        space = 8 + Listing::INIT_SPACE,
        seeds = [LISTING_SEED, seller.key().as_ref(), &listing_id.to_le_bytes()],
        bump
    )]
    pub listing: Account<'info, Listing>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_listing(
    ctx: Context<CreateListing>,
    listing_id: u64,
    kind: AssetKind,
    terms: ListingTerms,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, EdgeBountyError::Paused);
    require!(terms.price > 0, EdgeBountyError::ZeroAmount);
    let t = now()?;
    let l = &mut ctx.accounts.listing;
    l.seller = ctx.accounts.seller.key();
    l.listing_id = listing_id;
    l.kind = kind;
    l.version = 1;
    l.asset_commitment = terms.asset_commitment;
    l.terms_hash = terms.terms_hash;
    l.license_hash = terms.license_hash;
    l.price = terms.price;
    l.active = true;
    l.moderated = false;
    l.sales = 0;
    l.created_at = t;
    l.updated_at = t;
    l.bump = ctx.bumps.listing;
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateListing<'info> {
    pub seller: Signer<'info>,
    #[account(
        mut,
        seeds = [LISTING_SEED, seller.key().as_ref(), &listing.listing_id.to_le_bytes()],
        bump = listing.bump,
        has_one = seller @ EdgeBountyError::Unauthorized
    )]
    pub listing: Account<'info, Listing>,
}

/// Publishes a new immutable version. Orders reference the version they bought.
pub fn handle_update_listing_version(ctx: Context<UpdateListing>, terms: ListingTerms) -> Result<()> {
    require!(terms.price > 0, EdgeBountyError::ZeroAmount);
    let l = &mut ctx.accounts.listing;
    l.version = l.version.checked_add(1).ok_or(EdgeBountyError::Overflow)?;
    l.asset_commitment = terms.asset_commitment;
    l.terms_hash = terms.terms_hash;
    l.license_hash = terms.license_hash;
    l.price = terms.price;
    l.updated_at = now()?;
    Ok(())
}

pub fn handle_set_listing_active(ctx: Context<UpdateListing>, active: bool) -> Result<()> {
    let l = &mut ctx.accounts.listing;
    require!(!(active && l.moderated), EdgeBountyError::ListingModerated);
    l.active = active;
    l.updated_at = now()?;
    Ok(())
}

#[derive(Accounts)]
pub struct ModerateListing<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ EdgeBountyError::Unauthorized)]
    pub config: Account<'info, PlatformConfig>,
    #[account(mut)]
    pub listing: Account<'info, Listing>,
}

/// Takedown for prohibited content. Does not touch already-funded orders.
pub fn handle_moderate_listing(ctx: Context<ModerateListing>, moderated: bool) -> Result<()> {
    let l = &mut ctx.accounts.listing;
    l.moderated = moderated;
    if moderated {
        l.active = false;
    }
    l.updated_at = now()?;
    Ok(())
}
