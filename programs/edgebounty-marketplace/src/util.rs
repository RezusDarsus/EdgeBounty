use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

use crate::{constants::BPS_DENOMINATOR, error::EdgeBountyError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Payout {
    pub seller_net: u64,
    pub platform_fee: u64,
    pub verifier_paid: u64,
    pub buyer_refund: u64,
}

/// Exact integer escrow split. The four outputs always sum to `amount + verifier_fee`.
pub fn compute_payout(
    amount: u64,
    verifier_fee: u64,
    fee_bps: u16,
    seller_bps: u16,
    verifier_earned: bool,
) -> Result<Payout> {
    require!(
        (seller_bps as u64) <= BPS_DENOMINATOR,
        EdgeBountyError::InvalidBps
    );
    let seller_gross = mul_bps(amount, seller_bps)?;
    let platform_fee = mul_bps(seller_gross, fee_bps)?;
    let seller_net = seller_gross
        .checked_sub(platform_fee)
        .ok_or(EdgeBountyError::Overflow)?;
    let verifier_paid = if verifier_earned { verifier_fee } else { 0 };
    let buyer_refund = amount
        .checked_sub(seller_gross)
        .and_then(|v| v.checked_add(verifier_fee - verifier_paid))
        .ok_or(EdgeBountyError::Overflow)?;
    Ok(Payout {
        seller_net,
        platform_fee,
        verifier_paid,
        buyer_refund,
    })
}

pub fn mul_bps(amount: u64, bps: u16) -> Result<u64> {
    let v = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(EdgeBountyError::Overflow)?
        / BPS_DENOMINATOR as u128;
    u64::try_from(v).map_err(|_| error!(EdgeBountyError::Overflow))
}

pub fn now() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

/// Transfer from a PDA-owned vault using the PDA's signer seeds. Zero amounts are skipped.
pub fn vault_transfer<'info>(
    token_program: &Program<'info, Token>,
    vault: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let cpi = CpiContext::new_with_signer(
        token_program.key(),
        TransferChecked {
            from: vault.to_account_info(),
            mint: mint.to_account_info(),
            to,
            authority,
        },
        signer_seeds,
    );
    token::transfer_checked(cpi, amount, mint.decimals)
}

/// Transfer signed by a user wallet.
pub fn user_transfer<'info>(
    token_program: &Program<'info, Token>,
    from: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let cpi = CpiContext::new(
        token_program.key(),
        TransferChecked {
            from: from.to_account_info(),
            mint: mint.to_account_info(),
            to,
            authority,
        },
    );
    token::transfer_checked(cpi, amount, mint.decimals)
}

/// Close an emptied vault, returning its rent to `destination`.
pub fn close_vault<'info>(
    token_program: &Program<'info, Token>,
    vault: &Account<'info, TokenAccount>,
    destination: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let cpi = CpiContext::new_with_signer(
        token_program.key(),
        CloseAccount {
            account: vault.to_account_info(),
            destination,
            authority,
        },
        signer_seeds,
    );
    token::close_account(cpi)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_settlement_100_usdc() {
        let p = compute_payout(100_000_000, 0, 500, 10_000, false).unwrap();
        assert_eq!(p.seller_net, 95_000_000);
        assert_eq!(p.platform_fee, 5_000_000);
        assert_eq!(p.buyer_refund, 0);
    }

    #[test]
    fn split_and_verifier_sums_exact() {
        for &(amount, vfee, fee, bps, earned) in &[
            (100_000_001u64, 3_333_333u64, 500u16, 3_333u16, true),
            (7, 1, 999, 1, false),
            (u64::MAX / 2, 10, 1_000, 9_999, true),
        ] {
            let p = compute_payout(amount, vfee, fee, bps, earned).unwrap();
            assert_eq!(
                p.seller_net as u128 + p.platform_fee as u128 + p.verifier_paid as u128
                    + p.buyer_refund as u128,
                amount as u128 + vfee as u128
            );
        }
    }

    #[test]
    fn refund_returns_unearned_verifier_fee() {
        let p = compute_payout(50, 10, 500, 0, false).unwrap();
        assert_eq!(p.buyer_refund, 60);
        assert_eq!(p.verifier_paid, 0);
    }

    #[test]
    fn rejects_bps_over_100_percent() {
        assert!(compute_payout(1, 0, 0, 10_001, false).is_err());
    }
}
