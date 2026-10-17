use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    constants::*,
    error::EdgeBountyError,
    events::ServicePaid,
    state::*,
    util::{now, user_transfer},
};

#[derive(Accounts)]
#[instruction(reference: [u8; 32])]
pub struct PayService<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, PlatformConfig>>,
    /// One receipt per invoice reference: an invoice can never be paid (or counted) twice.
    #[account(
        init,
        payer = payer,
        space = 8 + ServiceReceipt::INIT_SPACE,
        seeds = [RECEIPT_SEED, reference.as_ref()],
        bump
    )]
    pub receipt: Box<Account<'info, ServiceReceipt>>,
    #[account(address = config.payment_mint)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = mint, token::authority = payer)]
    pub payer_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = config.treasury @ EdgeBountyError::TreasuryMismatch)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Pays a platform invoice (storage rental, platform-run verification).
pub fn handle_pay_service(ctx: Context<PayService>, reference: [u8; 32], kind: u8, amount: u64) -> Result<()> {
    require!(amount > 0, EdgeBountyError::ZeroAmount);
    user_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.payer_token,
        &ctx.accounts.mint,
        ctx.accounts.treasury.to_account_info(),
        ctx.accounts.payer.to_account_info(),
        amount,
    )?;
    let r = &mut ctx.accounts.receipt;
    r.payer = ctx.accounts.payer.key();
    r.reference = reference;
    r.kind = kind;
    r.amount = amount;
    r.paid_at = now()?;
    r.bump = ctx.bumps.receipt;
    emit!(ServicePaid {
        receipt: r.key(),
        payer: r.payer,
        amount,
        kind,
    });
    Ok(())
}
