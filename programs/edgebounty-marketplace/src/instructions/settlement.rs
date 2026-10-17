use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    constants::*,
    error::EdgeBountyError,
    events::OrderPaidOut,
    instructions::order::emit_state,
    state::*,
    util::{close_vault, compute_payout, now, vault_transfer, Payout},
};

/// Pays out the full vault according to `seller_bps` and closes it. Callers must move the
/// order into a terminal state in the same instruction, which makes payouts exactly-once.
#[allow(clippy::too_many_arguments)]
fn payout_order<'info>(
    order: &Account<'info, Order>,
    vault: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    token_program: &Program<'info, Token>,
    seller_token: Option<AccountInfo<'info>>,
    buyer_token: AccountInfo<'info>,
    treasury: Option<AccountInfo<'info>>,
    verifier_token: Option<AccountInfo<'info>>,
    rent_destination: AccountInfo<'info>,
    seller_bps: u16,
) -> Result<Payout> {
    let mut p = compute_payout(
        order.amount,
        order.verifier_fee,
        order.fee_bps,
        seller_bps,
        order.verifications_done > 0,
    )?;
    let expected = order
        .amount
        .checked_add(order.verifier_fee)
        .ok_or(EdgeBountyError::Overflow)?;
    require!(vault.amount >= expected, EdgeBountyError::Overflow);
    // Tokens sent directly to the vault by third parties are returned to the buyer.
    p.buyer_refund = p
        .buyer_refund
        .checked_add(vault.amount - expected)
        .ok_or(EdgeBountyError::Overflow)?;

    let buyer = order.buyer;
    let id = order.order_id.to_le_bytes();
    let bump = [order.bump];
    let seeds: &[&[u8]] = &[ORDER_SEED, buyer.as_ref(), &id, &bump];
    let auth = order.to_account_info();

    if p.seller_net > 0 {
        let to = seller_token.clone().ok_or(EdgeBountyError::TokenOwnerMismatch)?;
        vault_transfer(token_program, vault, mint, to, auth.clone(), &[seeds], p.seller_net)?;
    }
    if p.platform_fee > 0 {
        let to = treasury.ok_or(EdgeBountyError::TreasuryMismatch)?;
        vault_transfer(token_program, vault, mint, to, auth.clone(), &[seeds], p.platform_fee)?;
    }
    if p.verifier_paid > 0 {
        let to = verifier_token.ok_or(EdgeBountyError::VerifierTokenRequired)?;
        vault_transfer(token_program, vault, mint, to, auth.clone(), &[seeds], p.verifier_paid)?;
    }
    vault_transfer(token_program, vault, mint, buyer_token, auth.clone(), &[seeds], p.buyer_refund)?;
    close_vault(token_program, vault, rent_destination, auth, &[seeds])?;

    emit!(OrderPaidOut {
        order: order.key(),
        seller_net: p.seller_net,
        platform_fee: p.platform_fee,
        verifier_paid: p.verifier_paid,
        buyer_refund: p.buyer_refund,
    });
    Ok(p)
}

#[derive(Accounts)]
pub struct SettleOrder<'info> {
    /// Anyone may crank settlement (pays rent for receipts).
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, PlatformConfig>>,
    #[account(mut)]
    pub order: Box<Account<'info, Order>>,
    #[account(mut, seeds = [VAULT_SEED, order.key().as_ref()], bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(address = config.payment_mint)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = mint, token::authority = order.seller)]
    pub seller_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = order.buyer)]
    pub buyer_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = config.treasury @ EdgeBountyError::TreasuryMismatch)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = order.verifier)]
    pub verifier_token: Option<Box<Account<'info, TokenAccount>>>,
    /// CHECK: receives the vault rent; constrained to the order's buyer.
    #[account(mut, address = order.buyer)]
    pub buyer: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + LicenseReceipt::INIT_SPACE,
        seeds = [LICENSE_SEED, order.key().as_ref()],
        bump
    )]
    pub license_receipt: Box<Account<'info, LicenseReceipt>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Reputation::INIT_SPACE,
        seeds = [REPUTATION_SEED, order.seller.as_ref()],
        bump
    )]
    pub seller_reputation: Box<Account<'info, Reputation>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Reputation::INIT_SPACE,
        seeds = [REPUTATION_SEED, order.buyer.as_ref()],
        bump
    )]
    pub buyer_reputation: Box<Account<'info, Reputation>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Settle an approved order, or an order whose review window elapsed without a dispute
/// (silence = acceptance, protecting the seller).
pub fn handle_settle_order(ctx: Context<SettleOrder>) -> Result<()> {
    let t = now()?;
    let o = &ctx.accounts.order;
    let seller_bps = match o.state {
        OrderState::Approved => o.seller_bps,
        OrderState::UnderReview => {
            require!(t > o.review_deadline, EdgeBountyError::DeadlineNotReached);
            BPS_DENOMINATOR as u16
        }
        _ => return err!(EdgeBountyError::InvalidState),
    };

    let p = payout_order(
        o,
        &ctx.accounts.vault,
        &ctx.accounts.mint,
        &ctx.accounts.token_program,
        Some(ctx.accounts.seller_token.to_account_info()),
        ctx.accounts.buyer_token.to_account_info(),
        Some(ctx.accounts.treasury.to_account_info()),
        ctx.accounts.verifier_token.as_ref().map(|a| a.to_account_info()),
        ctx.accounts.buyer.to_account_info(),
        seller_bps,
    )?;
    let granted = seller_bps > 0;

    let r = &mut ctx.accounts.license_receipt;
    r.order = o.key();
    r.buyer = o.buyer;
    r.seller = o.seller;
    r.listing = o.listing;
    r.asset_commitment = o.current_commitment;
    r.asset_version = o.current_version;
    r.license_hash = o.license_hash;
    r.terms_hash = o.terms_hash;
    r.granted = granted;
    r.issued_at = t;
    r.bump = ctx.bumps.license_receipt;

    let gross = p.seller_net.saturating_add(p.platform_fee);
    let sr = &mut ctx.accounts.seller_reputation;
    sr.wallet = o.seller;
    sr.bump = ctx.bumps.seller_reputation;
    let br = &mut ctx.accounts.buyer_reputation;
    br.wallet = o.buyer;
    br.bump = ctx.bumps.buyer_reputation;
    if granted {
        sr.sales_completed = sr.sales_completed.saturating_add(1);
        sr.volume_sold = sr.volume_sold.saturating_add(gross);
        br.purchases_completed = br.purchases_completed.saturating_add(1);
        br.volume_bought = br.volume_bought.saturating_add(gross);
    } else {
        sr.refunded_orders = sr.refunded_orders.saturating_add(1);
    }
    if o.disputed {
        sr.disputed_orders = sr.disputed_orders.saturating_add(1);
        br.disputed_orders = br.disputed_orders.saturating_add(1);
    }

    let o = &mut ctx.accounts.order;
    o.seller_bps = seller_bps;
    o.state = if granted { OrderState::Settled } else { OrderState::Refunded };
    o.closed_at = t;
    emit_state(o)
}

#[derive(Accounts)]
pub struct RefundOrder<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut, has_one = buyer @ EdgeBountyError::Unauthorized)]
    pub order: Box<Account<'info, Order>>,
    #[account(mut, seeds = [VAULT_SEED, order.key().as_ref()], bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(address = vault.mint)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = order.verifier)]
    pub verifier_token: Option<Box<Account<'info, TokenAccount>>>,
    pub token_program: Program<'info, Token>,
}

/// Buyer refund paths (all without arbitration):
/// * nobody accepted, or the seller never delivered, before `deadline`;
/// * a requested correction was not delivered before `correction_deadline`;
/// * the verifier FAILED the current submission and no corrections remain.
pub fn handle_refund_order(ctx: Context<RefundOrder>) -> Result<()> {
    let t = now()?;
    let o = &ctx.accounts.order;
    let allowed = match o.state {
        OrderState::Funded | OrderState::Assigned => t > o.deadline,
        OrderState::CorrectionRequired => t > o.correction_deadline,
        OrderState::UnderReview => {
            o.verdict_current && !o.verdict_passed && o.submission_count >= o.submissions_allowed()
        }
        _ => false,
    };
    require!(allowed, EdgeBountyError::InvalidState);

    payout_order(
        o,
        &ctx.accounts.vault,
        &ctx.accounts.mint,
        &ctx.accounts.token_program,
        None,
        ctx.accounts.buyer_token.to_account_info(),
        None,
        ctx.accounts.verifier_token.as_ref().map(|a| a.to_account_info()),
        ctx.accounts.buyer.to_account_info(),
        0,
    )?;
    let o = &mut ctx.accounts.order;
    o.seller_bps = 0;
    o.state = OrderState::Refunded;
    o.closed_at = t;
    emit_state(o)
}
