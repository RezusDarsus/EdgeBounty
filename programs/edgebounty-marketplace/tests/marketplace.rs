mod common;

use {
    anchor_lang::solana_program::system_program,
    anchor_spl::token::spl_token,
    common::*,
    ::edgebounty_marketplace::{accounts as acc, constants::*, instruction as ix, state::*},
    solana_signer::Signer,
};

// ======================================================================= purchases

#[test]
fn purchase_settles_exactly_once_with_5pct_fee() {
    let mut env = Env::new();
    let seller = env.user(0);
    let buyer = env.user(500 * USDC);
    let listing = env.create_listing(&seller, 1, 100 * USDC);

    let i = env.purchase_ix(&buyer, listing, 1, 100 * USDC, None, 0);
    env.ok(&[i], &[&buyer.kp]);
    let order = order_pda(&buyer.key(), 1);
    assert_eq!(env.balance(&vault_pda(&order)), 100 * USDC);
    let o: Order = env.fetch(&order);
    assert_eq!(o.state, OrderState::UnderReview);
    assert_eq!(o.current_commitment, h(1));

    // the buyer cannot withdraw while the deliverable is under review
    env.refund(&buyer, order, None).unwrap_err();
    // settlement before approval or window expiry is rejected
    let cranker = env.user(0);
    env.fails(
        &[env.settle_ix(&cranker, order, &seller, &buyer, None)],
        &[&cranker.kp],
        "DeadlineNotReached",
    );

    env.buyer_action(&buyer, order, true).unwrap();
    env.settle(&cranker, order, &seller, &buyer, None).unwrap();

    assert_eq!(env.balance(&seller.token), 95 * USDC);
    assert_eq!(env.balance(&env.treasury.clone()), 5 * USDC);
    assert_eq!(env.balance(&buyer.token), 400 * USDC);
    assert!(!env.exists(&vault_pda(&order)), "vault closed");
    let o: Order = env.fetch(&order);
    assert_eq!(o.state, OrderState::Settled);
    let lic: LicenseReceipt = env.fetch(&license_pda(&order));
    assert!(lic.granted);
    assert_eq!(lic.asset_commitment, h(1));
    assert_eq!(lic.listing, listing);
    let rep: Reputation = env.fetch(&reputation_pda(&seller.key()));
    assert_eq!(rep.sales_completed, 1);
    assert_eq!(rep.volume_sold, 100 * USDC);

    // second settlement must fail (terminal state, vault gone)
    assert!(env.settle(&cranker, order, &seller, &buyer, None).is_err());
    assert_eq!(env.balance(&seller.token), 95 * USDC);
}

#[test]
fn purchase_rejects_stale_price_self_purchase_and_inactive_listing() {
    let mut env = Env::new();
    let seller = env.user(100 * USDC);
    let buyer = env.user(500 * USDC);
    let listing = env.create_listing(&seller, 1, 100 * USDC);

    let i = env.purchase_ix(&buyer, listing, 1, 90 * USDC, None, 0);
    env.fails(&[i], &[&buyer.kp], "ListingChanged");

    let i = env.purchase_ix(&seller, listing, 1, 100 * USDC, None, 0);
    env.fails(&[i], &[&seller.kp], "ConflictOfInterest");

    let i = instr(
        ix::SetListingActive { active: false },
        acc::UpdateListing { seller: seller.key(), listing },
    );
    env.ok(&[i], &[&seller.kp]);
    let i = env.purchase_ix(&buyer, listing, 1, 100 * USDC, None, 0);
    env.fails(&[i], &[&buyer.kp], "ListingUnavailable");
}

#[test]
fn moderated_listing_cannot_be_reactivated_by_seller() {
    let mut env = Env::new();
    let seller = env.user(0);
    let listing = env.create_listing(&seller, 7, 10 * USDC);
    let admin = env.admin.insecure_clone();
    let i = instr(
        ix::ModerateListing { moderated: true },
        acc::ModerateListing { admin: admin.pubkey(), config: config_pda(), listing },
    );
    env.ok(&[i], &[&admin]);
    let i = instr(
        ix::SetListingActive { active: true },
        acc::UpdateListing { seller: seller.key(), listing },
    );
    env.fails(&[i], &[&seller.kp], "ListingModerated");
}

#[test]
fn wrong_mint_token_account_is_rejected() {
    let mut env = Env::new();
    let seller = env.user(0);
    let buyer = env.user(0);
    let listing = env.create_listing(&seller, 1, 10 * USDC);
    let fake_mint = anchor_lang::prelude::Pubkey::new_unique();
    env.create_mint(fake_mint);
    let fake_token = anchor_lang::prelude::Pubkey::new_unique();
    env.create_token_account(fake_token, fake_mint, buyer.key(), 1_000 * USDC);
    let bad_buyer = User { kp: buyer.kp.insecure_clone(), token: fake_token };
    let i = env.purchase_ix(&bad_buyer, listing, 1, 10 * USDC, None, 0);
    assert!(env.send(&[i], &[&buyer.kp]).is_err());
}

// ======================================================================= bounties

fn funded_bounty(env: &mut Env, verifier: Option<&User>, max_corrections: u8) -> (User, User, anchor_lang::prelude::Pubkey) {
    let buyer = env.user(1_000 * USDC);
    let seller = env.user(0);
    let vfee = if verifier.is_some() { 2 * USDC } else { 0 };
    let ixs = env.bounty_ixs(&buyer, 42, 100 * USDC, verifier, vfee, max_corrections);
    env.ok(&ixs, &[&buyer.kp]);
    let order = order_pda(&buyer.key(), 42);
    env.accept_bounty(&seller, order).unwrap();
    (buyer, seller, order)
}

#[test]
fn bounty_with_verifier_full_happy_path() {
    let mut env = Env::new();
    let verifier = env.verifier(CAP_DATASET_IMAGE);
    let (buyer, seller, order) = funded_bounty(&mut env, Some(&verifier), 1);
    assert_eq!(env.balance(&vault_pda(&order)), 102 * USDC);

    env.submit(&seller, order, h(11)).unwrap();
    let o: Order = env.fetch(&order);
    assert_eq!(o.state, OrderState::Submitted);
    // buyer cannot accept before the agreed verifier has reported
    assert!(env.buyer_action(&buyer, order, true).is_err());

    env.verify(&verifier, order, true).unwrap();
    let att: Attestation = env.fetch(&attestation_pda(&order, 1));
    assert!(att.passed);
    assert_eq!(att.asset_commitment, h(11));
    assert_eq!(att.verifier, verifier.key());

    env.buyer_action(&buyer, order, true).unwrap();
    let cranker = env.user(0);
    env.settle(&cranker, order, &seller, &buyer, Some(&verifier)).unwrap();
    assert_eq!(env.balance(&seller.token), 95 * USDC);
    assert_eq!(env.balance(&verifier.token), 2 * USDC);
    assert_eq!(env.balance(&env.treasury.clone()), 5 * USDC);
    assert_eq!(env.balance(&buyer.token), 898 * USDC);
    let p: Provider = env.fetch(&provider_pda(&verifier.key()));
    assert_eq!(p.jobs_completed, 1);
}

#[test]
fn settlement_without_verifier_token_fails_when_verifier_earned() {
    let mut env = Env::new();
    let verifier = env.verifier(CAP_DATASET_IMAGE);
    let (buyer, seller, order) = funded_bounty(&mut env, Some(&verifier), 0);
    env.submit(&seller, order, h(11)).unwrap();
    env.verify(&verifier, order, true).unwrap();
    env.buyer_action(&buyer, order, true).unwrap();
    let cranker = env.user(0);
    let e = env.settle(&cranker, order, &seller, &buyer, None).unwrap_err();
    assert!(e.contains("VerifierTokenRequired"), "{e}");
    // and paying the verifier fee to someone else's account is rejected
    let impostor = env.user(0);
    assert!(env.settle(&cranker, order, &seller, &buyer, Some(&impostor)).is_err());
}

#[test]
fn failed_verdict_correction_then_refund_pays_verifier_only() {
    let mut env = Env::new();
    let verifier = env.verifier(CAP_DATASET_IMAGE);
    let (buyer, seller, order) = funded_bounty(&mut env, Some(&verifier), 1);

    env.submit(&seller, order, h(11)).unwrap();
    env.verify(&verifier, order, false).unwrap();
    // refund is not allowed while corrections remain
    assert!(env.refund(&buyer, order, Some(&verifier)).is_err());
    env.buyer_action(&buyer, order, false).unwrap();
    let o: Order = env.fetch(&order);
    assert_eq!(o.state, OrderState::CorrectionRequired);

    env.submit(&seller, order, h(12)).unwrap(); // resubmission
    env.verify(&verifier, order, false).unwrap();
    // no corrections left: rejection impossible, refund allowed
    assert!(env.buyer_action(&buyer, order, false).is_err());
    env.refund(&buyer, order, Some(&verifier)).unwrap();

    assert_eq!(env.balance(&buyer.token), 1_000 * USDC - 2 * USDC);
    assert_eq!(env.balance(&verifier.token), 2 * USDC);
    assert_eq!(env.balance(&seller.token), 0);
    assert_eq!(env.balance(&env.treasury.clone()), 0);
    let o: Order = env.fetch(&order);
    assert_eq!(o.state, OrderState::Refunded);
}

#[test]
fn rejection_requires_failed_verdict() {
    let mut env = Env::new();
    let (buyer, seller, order) = funded_bounty(&mut env, None, 2);
    env.submit(&seller, order, h(11)).unwrap();
    let e = env.buyer_action(&buyer, order, false).unwrap_err();
    assert!(e.contains("RejectionNotAllowed"), "{e}");
}

#[test]
fn review_window_elapses_into_seller_protected_settlement() {
    let mut env = Env::new();
    let (buyer, seller, order) = funded_bounty(&mut env, None, 0);
    env.submit(&seller, order, h(11)).unwrap();
    let cranker = env.user(0);
    assert!(env.settle(&cranker, order, &seller, &buyer, None).is_err());
    let t = env.now();
    env.set_time(t + 3 * DAY + 1);
    // a late dispute is rejected
    assert!(env.open_dispute(&buyer, order).is_err());
    env.settle(&cranker, order, &seller, &buyer, None).unwrap();
    assert_eq!(env.balance(&seller.token), 95 * USDC);
}

#[test]
fn deadline_refund_when_seller_never_delivers() {
    let mut env = Env::new();
    let (buyer, seller, order) = funded_bounty(&mut env, None, 0);
    assert!(env.refund(&buyer, order, None).is_err(), "too early");
    let t = env.now();
    env.set_time(t + 11 * DAY);
    let e = env.submit(&seller, order, h(11)).unwrap_err();
    assert!(e.contains("DeadlinePassed"), "{e}");
    env.refund(&buyer, order, None).unwrap();
    assert_eq!(env.balance(&buyer.token), 1_000 * USDC);
}

#[test]
fn cancel_unaccepted_bounty_refunds_everything() {
    let mut env = Env::new();
    let buyer = env.user(1_000 * USDC);
    let ixs = env.bounty_ixs(&buyer, 5, 100 * USDC, None, 0, 0);
    env.ok(&ixs, &[&buyer.kp]);
    let order = order_pda(&buyer.key(), 5);
    let i = instr(
        ix::CancelOrder {},
        acc::CancelOrder {
            buyer: buyer.key(),
            order,
            vault: Some(vault_pda(&order)),
            mint: Some(env.mint),
            buyer_token: Some(buyer.token),
            token_program: spl_token::ID,
        },
    );
    env.ok(&[i], &[&buyer.kp]);
    assert_eq!(env.balance(&buyer.token), 1_000 * USDC);
    let o: Order = env.fetch(&order);
    assert_eq!(o.state, OrderState::Cancelled);
    // a seller can no longer accept
    let seller = env.user(0);
    assert!(env.accept_bounty(&seller, order).is_err());
}

#[test]
fn verifier_must_be_approved_and_unconflicted() {
    let mut env = Env::new();
    let buyer = env.user(1_000 * USDC);
    // unapproved provider
    let v = env.verifier(CAP_DATASET_IMAGE);
    env.review_provider(&v.key(), false, 0);
    let ixs = env.bounty_ixs(&buyer, 1, 10 * USDC, Some(&v), USDC, 0);
    env.fails(&ixs, &[&buyer.kp], "VerifierNotApproved");
    // missing capability
    let v2 = env.verifier(CAP_DATASET_TABULAR);
    let ixs = env.bounty_ixs(&buyer, 2, 10 * USDC, Some(&v2), USDC, 0);
    env.fails(&ixs, &[&buyer.kp], "MissingCapability");
    // the verifier cannot also be the seller
    let v3 = env.verifier(CAP_DATASET_IMAGE);
    let ixs = env.bounty_ixs(&buyer, 3, 10 * USDC, Some(&v3), USDC, 0);
    env.ok(&ixs, &[&buyer.kp]);
    let e = env.accept_bounty(&v3, order_pda(&buyer.key(), 3)).unwrap_err();
    assert!(e.contains("ConflictOfInterest"), "{e}");
    // a random wallet cannot post the verdict
    let seller = env.user(0);
    env.accept_bounty(&seller, order_pda(&buyer.key(), 3)).unwrap();
    env.submit(&seller, order_pda(&buyer.key(), 3), h(1)).unwrap();
    let impostor = env.verifier(CAP_DATASET_IMAGE);
    assert!(env.verify(&impostor, order_pda(&buyer.key(), 3), true).is_err());
}

#[test]
fn fee_is_locked_at_funding() {
    let mut env = Env::new();
    let (buyer, seller, order) = funded_bounty(&mut env, None, 0);
    env.update_fee(1_000).unwrap();
    env.submit(&seller, order, h(11)).unwrap();
    env.buyer_action(&buyer, order, true).unwrap();
    let cranker = env.user(0);
    env.settle(&cranker, order, &seller, &buyer, None).unwrap();
    assert_eq!(env.balance(&seller.token), 95 * USDC);
    // and the hard ceiling holds
    let e = env.update_fee(1_001).unwrap_err();
    assert!(e.contains("FeeTooHigh"), "{e}");
}

#[test]
fn pause_blocks_new_commitments_but_not_exit() {
    let mut env = Env::new();
    let (buyer, seller, order) = funded_bounty(&mut env, None, 0);
    env.set_paused(true);
    let other = env.user(100 * USDC);
    let ixs = env.bounty_ixs(&other, 9, 10 * USDC, None, 0, 0);
    env.fails(&ixs, &[&other.kp], "Paused");
    env.submit(&seller, order, h(11)).unwrap();
    env.buyer_action(&buyer, order, true).unwrap();
    let cranker = env.user(0);
    env.settle(&cranker, order, &seller, &buyer, None).unwrap();
}

// ======================================================================= disputes

#[test]
fn dispute_split_pays_exact_shares() {
    let mut env = Env::new();
    let (buyer, seller, order) = funded_bounty(&mut env, None, 0);
    env.submit(&seller, order, h(11)).unwrap();
    // seller cannot open a dispute during buyer review
    assert!(env.open_dispute(&seller, order).is_err());
    env.open_dispute(&buyer, order).unwrap();
    // buyer cannot withdraw during dispute; nobody can settle
    assert!(env.refund(&buyer, order, None).is_err());
    let cranker = env.user(0);
    assert!(env.settle(&cranker, order, &seller, &buyer, None).is_err());
    // only the dispute authority can resolve
    let admin = env.admin.insecure_clone();
    let e = env.resolve(&admin, order, DisputeResolution::Split, 10_000).unwrap_err();
    assert!(e.contains("Unauthorized"), "{e}");
    let da = env.dispute_authority.insecure_clone();
    env.resolve(&da, order, DisputeResolution::Split, 5_000).unwrap();
    env.settle(&cranker, order, &seller, &buyer, None).unwrap();
    // 50 to seller side: 47.5 net + 2.5 fee; 50 refunded
    assert_eq!(env.balance(&seller.token), 47_500_000);
    assert_eq!(env.balance(&env.treasury.clone()), 2_500_000);
    assert_eq!(env.balance(&buyer.token), 950 * USDC);
    let rep: Reputation = env.fetch(&reputation_pda(&seller.key()));
    assert_eq!(rep.disputed_orders, 1);
}

#[test]
fn dispute_full_refund_resolution() {
    let mut env = Env::new();
    let (buyer, seller, order) = funded_bounty(&mut env, None, 0);
    env.submit(&seller, order, h(11)).unwrap();
    env.open_dispute(&buyer, order).unwrap();
    let da = env.dispute_authority.insecure_clone();
    env.resolve(&da, order, DisputeResolution::Split, 0).unwrap();
    let cranker = env.user(0);
    env.settle(&cranker, order, &seller, &buyer, None).unwrap();
    assert_eq!(env.balance(&buyer.token), 1_000 * USDC);
    let o: Order = env.fetch(&order);
    assert_eq!(o.state, OrderState::Refunded);
    let lic: LicenseReceipt = env.fetch(&license_pda(&order));
    assert!(!lic.granted, "no entitlement on full refund");
}

#[test]
fn dispute_correction_then_second_dispute() {
    let mut env = Env::new();
    let (buyer, seller, order) = funded_bounty(&mut env, None, 1);
    env.submit(&seller, order, h(11)).unwrap();
    env.open_dispute(&buyer, order).unwrap();
    let da = env.dispute_authority.insecure_clone();
    env.resolve(&da, order, DisputeResolution::Correction, 0).unwrap();
    // resolving twice is impossible
    assert!(env.resolve(&da, order, DisputeResolution::Split, 10_000).is_err());
    env.submit(&seller, order, h(12)).unwrap();
    env.open_dispute(&buyer, order).unwrap(); // second, independent dispute record
    // corrections exhausted
    let e = env.resolve(&da, order, DisputeResolution::Correction, 0).unwrap_err();
    assert!(e.contains("NoCorrectionsLeft"), "{e}");
    env.resolve(&da, order, DisputeResolution::Split, 10_000).unwrap();
    let cranker = env.user(0);
    env.settle(&cranker, order, &seller, &buyer, None).unwrap();
    assert_eq!(env.balance(&seller.token), 95 * USDC);
}

#[test]
fn resolver_cannot_touch_undisputed_orders() {
    let mut env = Env::new();
    let (_buyer, seller, order) = funded_bounty(&mut env, None, 0);
    env.submit(&seller, order, h(11)).unwrap();
    let da = env.dispute_authority.insecure_clone();
    // no dispute PDA exists / order not disputed
    assert!(env.resolve(&da, order, DisputeResolution::Split, 10_000).is_err());
}

#[test]
fn unresponsive_verifier_can_be_escalated() {
    let mut env = Env::new();
    let verifier = env.verifier(CAP_DATASET_IMAGE);
    let (buyer, seller, order) = funded_bounty(&mut env, Some(&verifier), 0);
    env.submit(&seller, order, h(11)).unwrap();
    assert!(env.open_dispute(&seller, order).is_err(), "too early");
    let t = env.now();
    env.set_time(t + 3 * DAY + 1);
    env.open_dispute(&seller, order).unwrap();
    let da = env.dispute_authority.insecure_clone();
    env.resolve(&da, order, DisputeResolution::Split, 10_000).unwrap();
    let cranker = env.user(0);
    // verifier never reported, so its fee goes back to the buyer
    env.settle(&cranker, order, &seller, &buyer, None).unwrap();
    assert_eq!(env.balance(&seller.token), 95 * USDC);
    assert_eq!(env.balance(&buyer.token), 900 * USDC);
}

// ======================================================================= admin

#[test]
fn two_step_admin_transfer() {
    let mut env = Env::new();
    let new_admin = env.user(0);
    let admin = env.admin.insecure_clone();
    let i = instr(
        ix::ProposeAdmin { new_admin: new_admin.key() },
        acc::AdminOnly { admin: admin.pubkey(), config: config_pda() },
    );
    env.ok(&[i], &[&admin]);
    let stranger = env.user(0);
    let i = instr(ix::AcceptAdmin {}, acc::AcceptAdmin { new_admin: stranger.key(), config: config_pda() });
    assert!(env.send(&[i], &[&stranger.kp]).is_err());
    let i = instr(ix::AcceptAdmin {}, acc::AcceptAdmin { new_admin: new_admin.key(), config: config_pda() });
    env.ok(&[i], &[&new_admin.kp]);
    let c: PlatformConfig = env.fetch(&config_pda());
    assert_eq!(c.admin, new_admin.key());
    assert!(env.update_fee(100).is_err(), "old admin lost power");
}

#[test]
fn attestation_revocation_permissions() {
    let mut env = Env::new();
    let verifier = env.verifier(CAP_DATASET_IMAGE);
    let (_buyer, seller, order) = funded_bounty(&mut env, Some(&verifier), 0);
    env.submit(&seller, order, h(11)).unwrap();
    env.verify(&verifier, order, true).unwrap();
    let att = attestation_pda(&order, 1);
    let revoke = |who: &anchor_lang::prelude::Pubkey| {
        instr(
            ix::RevokeAttestation {},
            acc::RevokeAttestation { authority: *who, config: config_pda(), attestation: att },
        )
    };
    let i = revoke(&seller.key());
    env.fails(&[i], &[&seller.kp], "Unauthorized");
    let i = revoke(&verifier.key());
    env.ok(&[i], &[&verifier.kp]);
    let a: Attestation = env.fetch(&att);
    assert!(a.revoked);
    let i = revoke(&verifier.key());
    env.fails(&[i], &[&verifier.kp], "AlreadyRevoked");
}

// ======================================================================= service receipts

#[test]
fn service_payment_reference_is_single_use() {
    let mut env = Env::new();
    let payer = env.user(10 * USDC);
    let reference = h(77);
    let mk = |env: &Env| {
        instr(
            ix::PayService { reference, kind: 1, amount: 1_990_000 },
            acc::PayService {
                payer: payer.key(),
                config: config_pda(),
                receipt: receipt_pda(&reference),
                mint: env.mint,
                payer_token: payer.token,
                treasury: env.treasury,
                token_program: spl_token::ID,
                system_program: system_program::ID,
            },
        )
    };
    let i = mk(&env);
    env.ok(&[i], &[&payer.kp]);
    let r: ServiceReceipt = env.fetch(&receipt_pda(&reference));
    assert_eq!(r.amount, 1_990_000);
    assert_eq!(env.balance(&env.treasury.clone()), 1_990_000);
    let i = mk(&env);
    assert!(env.send(&[i], &[&payer.kp]).is_err());
    assert_eq!(env.balance(&env.treasury.clone()), 1_990_000);
}

// ======================================================================= phase 5: milestones & arbitrators

#[test]
fn designated_seller_binds_milestone_orders() {
    let mut env = Env::new();
    let buyer = env.user(1_000 * USDC);
    let dev = env.user(0);
    let other = env.user(0);
    // milestone 2 of a contract: only the developer who delivered milestone 1 may accept
    let ixs = env.bounty_ixs_ext(&buyer, 77, 40 * USDC, None, 0, 0, dev.key(), anchor_lang::prelude::Pubkey::default());
    env.ok(&ixs, &[&buyer.kp]);
    let order = order_pda(&buyer.key(), 77);
    let e = env.accept_bounty(&other, order).unwrap_err();
    assert!(e.contains("Unauthorized"), "{e}");
    env.accept_bounty(&dev, order).unwrap();
    env.submit(&dev, order, h(3)).unwrap();
    env.buyer_action(&buyer, order, true).unwrap();
    let cranker = env.user(0);
    env.settle(&cranker, order, &dev, &buyer, None).unwrap();
    assert_eq!(env.balance(&dev.token), 38 * USDC);
    // the buyer cannot designate itself
    let ixs = env.bounty_ixs_ext(&buyer, 78, USDC, None, 0, 0, buyer.key(), anchor_lang::prelude::Pubkey::default());
    env.fails(&ixs, &[&buyer.kp], "ConflictOfInterest");
}

#[test]
fn agreed_arbitrator_resolves_only_its_own_orders() {
    let mut env = Env::new();
    let arbiter = env.user(0);
    let buyer = env.user(1_000 * USDC);
    let seller = env.user(0);
    let ixs = env.bounty_ixs_ext(&buyer, 90, 100 * USDC, None, 0, 0, anchor_lang::prelude::Pubkey::default(), arbiter.key());
    env.ok(&ixs, &[&buyer.kp]);
    let order = order_pda(&buyer.key(), 90);
    // the arbitrator cannot also be the seller
    let e = env.accept_bounty(&arbiter, order).unwrap_err();
    assert!(e.contains("ConflictOfInterest"), "{e}");
    env.accept_bounty(&seller, order).unwrap();
    env.submit(&seller, order, h(4)).unwrap();
    env.open_dispute(&buyer, order).unwrap();
    env.resolve(&arbiter.kp, order, DisputeResolution::Split, 2_000).unwrap();
    let cranker = env.user(0);
    env.settle(&cranker, order, &seller, &buyer, None).unwrap();
    assert_eq!(env.balance(&seller.token), 19 * USDC); // 20 gross - 5%
    assert_eq!(env.balance(&buyer.token), 980 * USDC);

    // the same arbitrator has no power over an order that did not appoint it
    let (b2, s2, o2) = (env.user(1_000 * USDC), env.user(0), 0u8);
    let _ = o2;
    let ixs = env.bounty_ixs(&b2, 91, 10 * USDC, None, 0, 0);
    env.ok(&ixs, &[&b2.kp]);
    let order2 = order_pda(&b2.key(), 91);
    env.accept_bounty(&s2, order2).unwrap();
    env.submit(&s2, order2, h(5)).unwrap();
    env.open_dispute(&b2, order2).unwrap();
    let e = env.resolve(&arbiter.kp, order2, DisputeResolution::Split, 10_000).unwrap_err();
    assert!(e.contains("Unauthorized"), "{e}");
    // the platform authority still can
    let da = env.dispute_authority.insecure_clone();
    env.resolve(&da, order2, DisputeResolution::Split, 10_000).unwrap();
}

#[test]
fn initialization_requires_upgrade_authority() {
    // A stranger racing the first transaction cannot take over the platform.
    let mut env = Env::uninitialized();
    let admin = env.admin.pubkey();
    env.set_upgrade_authority(Some(admin));
    let attacker = env.user(0);
    let err = env.try_initialize(&attacker.kp, 500).unwrap_err();
    assert!(err.contains("NotUpgradeAuthority"), "got:
{err}");
    assert!(env.svm.get_account(&config_pda()).is_none(), "attacker must not create config");
    let owner = env.admin.insecure_clone();
    env.try_initialize(&owner, 500).unwrap();
    let c: PlatformConfig = env.fetch(&config_pda());
    assert_eq!(c.admin, admin);
    // Re-initialization is impossible once the config exists.
    assert!(env.try_initialize(&owner, 100).is_err());
}

#[test]
fn immutable_program_cannot_be_initialized() {
    let mut env = Env::uninitialized();
    env.set_upgrade_authority(None);
    let owner = env.admin.insecure_clone();
    let err = env.try_initialize(&owner, 500).unwrap_err();
    assert!(err.contains("NotUpgradeAuthority"), "got:
{err}");
}
