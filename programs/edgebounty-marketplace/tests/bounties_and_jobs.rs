mod common;

use {
    anchor_lang::{prelude::Pubkey, solana_program::system_program},
    anchor_spl::token::spl_token,
    common::*,
    ::edgebounty_marketplace::{accounts as acc, constants::*, instruction as ix, instructions::*, state::*},
};

// ======================================================================= failure bounties

fn create_failure_bounty(env: &mut Env, creator: &User, verifier: &User) -> Pubkey {
    let bounty = fbounty_pda(&creator.key(), 1);
    let i = instr(
        ix::CreateFailureBounty {
            bounty_id: 1,
            params: FailureBountyParams {
                verifier: verifier.key(),
                model_commitment: h(30),
                spec_hash: h(31),
                terms_hash: h(32),
                reward_per_example: 10 * USDC,
                verifier_fee: USDC,
                max_examples: 2,
                max_evaluations: 3,
                expires_at: env.now() + 5 * DAY,
            },
        },
        acc::CreateFailureBounty {
            creator: creator.key(),
            config: config_pda(),
            bounty,
            vault: fvault_pda(&bounty),
            mint: env.mint,
            creator_token: creator.token,
            verifier_provider: provider_pda(&verifier.key()),
            token_program: spl_token::ID,
            system_program: system_program::ID,
        },
    );
    env.ok(&[i], &[&creator.kp]);
    bounty
}

fn submit_example(env: &mut Env, who: &User, bounty: Pubkey, c: [u8; 32]) -> Result<(), String> {
    let i = instr(
        ix::SubmitFailureExample { commitment: c },
        acc::SubmitFailureExample {
            contributor: who.key(),
            bounty,
            example: fexample_pda(&bounty, &c),
            system_program: system_program::ID,
        },
    );
    env.send(&[i], &[&who.kp])
}

fn verify_example(env: &mut Env, verifier: &User, bounty: Pubkey, contributor: &User, c: [u8; 32], passed: bool) -> Result<(), String> {
    let example = fexample_pda(&bounty, &c);
    let i = instr(
        ix::VerifyFailureExample { passed, result_hash: h(40) },
        acc::VerifyFailureExample {
            verifier: verifier.key(),
            config: config_pda(),
            bounty,
            example,
            vault: fvault_pda(&bounty),
            mint: env.mint,
            contributor_token: contributor.token,
            verifier_token: verifier.token,
            treasury: env.treasury,
            provider: provider_pda(&verifier.key()),
            attestation: attestation_pda(&example, 0),
            contributor_reputation: reputation_pda(&contributor.key()),
            token_program: spl_token::ID,
            system_program: system_program::ID,
        },
    );
    env.send(&[i], &[&verifier.kp])
}

#[test]
fn failure_bounty_pays_verified_examples_and_returns_remainder() {
    let mut env = Env::new();
    let creator = env.user(100 * USDC);
    let verifier = env.verifier(CAP_FAILURE_BOUNTY);
    let bounty = create_failure_bounty(&mut env, &creator, &verifier);
    // 2 * 10 rewards + 3 * 1 evaluation budget
    assert_eq!(env.balance(&fvault_pda(&bounty)), 23 * USDC);

    let alice = env.user(0);
    let bob = env.user(0);
    submit_example(&mut env, &alice, bounty, h(50)).unwrap();
    // exact duplicate of the same content is rejected by the PDA seed
    assert!(submit_example(&mut env, &bob, bounty, h(50)).is_err());
    // the creator cannot farm their own bounty
    assert!(submit_example(&mut env, &creator, bounty, h(51)).is_err());
    submit_example(&mut env, &bob, bounty, h(52)).unwrap();

    verify_example(&mut env, &verifier, bounty, &alice, h(50), true).unwrap();
    assert_eq!(env.balance(&alice.token), 9_500_000); // 10 - 5% fee
    assert_eq!(env.balance(&verifier.token), USDC);
    assert_eq!(env.balance(&env.treasury.clone()), 500_000);
    // cannot be evaluated twice
    assert!(verify_example(&mut env, &verifier, bounty, &alice, h(50), true).is_err());

    verify_example(&mut env, &verifier, bounty, &bob, h(52), false).unwrap();
    assert_eq!(env.balance(&bob.token), 0, "rejected example earns nothing");
    assert_eq!(env.balance(&verifier.token), 2 * USDC, "verifier paid for a negative finding");
    let rep: Reputation = env.fetch(&reputation_pda(&alice.key()));
    assert_eq!(rep.verified_contributions, 1);

    let close = instr(
        ix::CloseFailureBounty {},
        acc::CloseFailureBounty {
            creator: creator.key(),
            config: config_pda(),
            bounty,
            vault: fvault_pda(&bounty),
            mint: env.mint,
            creator_token: creator.token,
            token_program: spl_token::ID,
        },
    );
    env.fails(&[close.clone()], &[&creator.kp], "CannotCloseYet");
    let t = env.now();
    env.set_time(t + 6 * DAY);
    assert!(submit_example(&mut env, &bob, bounty, h(53)).is_err(), "expired");
    env.ok(&[close], &[&creator.kp]);
    // 100 - 23 + remaining (10 reward + 1 eval)
    assert_eq!(env.balance(&creator.token), 88 * USDC);
}

// ======================================================================= verification jobs

fn create_job(env: &mut Env, requester: &User, provider: Pubkey, cap: u32) -> Pubkey {
    let job = job_pda(&requester.key(), 1);
    let i = instr(
        ix::CreateVerificationJob {
            job_id: 1,
            params: JobParams {
                provider,
                required_capability: cap,
                asset_commitment: h(60),
                spec_hash: h(61),
                price: 20 * USDC,
                deadline: env.now() + 2 * DAY,
            },
        },
        acc::CreateVerificationJob {
            requester: requester.key(),
            config: config_pda(),
            job,
            vault: jvault_pda(&job),
            mint: env.mint,
            requester_token: requester.token,
            token_program: spl_token::ID,
            system_program: system_program::ID,
        },
    );
    env.ok(&[i], &[&requester.kp]);
    job
}

fn accept_job(env: &mut Env, p: &User, job: Pubkey) -> Result<(), String> {
    let i = instr(
        ix::AcceptVerificationJob {},
        acc::AcceptVerificationJob { authority: p.key(), provider: provider_pda(&p.key()), job },
    );
    env.send(&[i], &[&p.kp])
}

fn submit_job_result(env: &mut Env, p: &User, job: Pubkey) -> Result<(), String> {
    let i = instr(
        ix::SubmitVerificationJobResult {
            result: JobResultParams {
                result_hash: h(62),
                passed: false,
                asset_version: 1,
                benchmark_version: 3,
                expires_at: 0,
            },
        },
        acc::SubmitJobResult {
            authority: p.key(),
            provider: provider_pda(&p.key()),
            job,
            attestation: attestation_pda(&job, 0),
            system_program: system_program::ID,
        },
    );
    env.send(&[i], &[&p.kp])
}

fn settle_job(env: &mut Env, caller: &User, job: Pubkey, p: &User, requester: &User) -> Result<(), String> {
    let i = instr(
        ix::SettleVerificationJob {},
        acc::SettleJob {
            caller: caller.key(),
            config: config_pda(),
            job,
            vault: jvault_pda(&job),
            mint: env.mint,
            provider_token: p.token,
            requester_token: requester.token,
            treasury: env.treasury,
            requester: requester.key(),
            provider: provider_pda(&p.key()),
            token_program: spl_token::ID,
        },
    );
    env.send(&[i], &[&caller.kp])
}

#[test]
fn open_verification_job_paid_even_for_negative_result() {
    let mut env = Env::new();
    let requester = env.user(100 * USDC);
    let wrong_cap = env.verifier(CAP_MODEL_SPEECH);
    let provider = env.verifier(CAP_DATASET_IMAGE);
    let job = create_job(&mut env, &requester, Pubkey::default(), CAP_DATASET_IMAGE);

    let e = accept_job(&mut env, &wrong_cap, job).unwrap_err();
    assert!(e.contains("MissingCapability"), "{e}");
    accept_job(&mut env, &provider, job).unwrap();
    // another provider cannot post the result
    assert!(submit_job_result(&mut env, &wrong_cap, job).is_err());
    submit_job_result(&mut env, &provider, job).unwrap();
    let att: Attestation = env.fetch(&attestation_pda(&job, 0));
    assert!(!att.passed);
    assert_eq!(att.asset_commitment, h(60));
    assert_eq!(att.benchmark_version, 3);

    // a stranger cannot settle before the window, the requester can
    let stranger = env.user(0);
    assert!(settle_job(&mut env, &stranger, job, &provider, &requester).is_err());
    settle_job(&mut env, &requester, job, &provider, &requester).unwrap();
    assert_eq!(env.balance(&provider.token), 19 * USDC);
    assert_eq!(env.balance(&env.treasury.clone()), USDC);
    let j: VerificationJob = env.fetch(&job);
    assert_eq!(j.state, JobState::Completed);
}

#[test]
fn verification_job_dispute_and_deadline_refund() {
    let mut env = Env::new();
    let requester = env.user(100 * USDC);
    let provider = env.verifier(CAP_DATASET_TABULAR);
    let job = create_job(&mut env, &requester, provider.key(), CAP_DATASET_TABULAR);
    accept_job(&mut env, &provider, job).unwrap();
    submit_job_result(&mut env, &provider, job).unwrap();

    let i = instr(
        ix::DisputeVerificationJob { reason_hash: h(70) },
        acc::DisputeJob {
            requester: requester.key(),
            job,
            dispute: dispute_pda(&job, 0),
            system_program: system_program::ID,
        },
    );
    env.ok(&[i], &[&requester.kp]);
    let da = env.dispute_authority.insecure_clone();
    let i = instr(
        ix::ResolveVerificationDispute { provider_bps: 2_500 },
        acc::ResolveJobDispute {
            dispute_authority: da.pubkey_compat(),
            config: config_pda(),
            job,
            dispute: dispute_pda(&job, 0),
            provider: provider_pda(&provider.key()),
        },
    );
    env.ok(&[i], &[&da]);
    let stranger = env.user(0);
    settle_job(&mut env, &stranger, job, &provider, &requester).unwrap();
    // 25% of 20 = 5 gross, 0.25 fee
    assert_eq!(env.balance(&provider.token), 4_750_000);
    assert_eq!(env.balance(&requester.token), 95 * USDC);
    let p: Provider = env.fetch(&provider_pda(&provider.key()));
    assert_eq!(p.jobs_disputed, 1);

    // second job: provider accepts then disappears -> refund after deadline
    let job2 = job_pda(&requester.key(), 2);
    let i = instr(
        ix::CreateVerificationJob {
            job_id: 2,
            params: JobParams {
                provider: Pubkey::default(),
                required_capability: CAP_DATASET_TABULAR,
                asset_commitment: h(60),
                spec_hash: h(61),
                price: 10 * USDC,
                deadline: env.now() + DAY,
            },
        },
        acc::CreateVerificationJob {
            requester: requester.key(),
            config: config_pda(),
            job: job2,
            vault: jvault_pda(&job2),
            mint: env.mint,
            requester_token: requester.token,
            token_program: spl_token::ID,
            system_program: system_program::ID,
        },
    );
    env.ok(&[i], &[&requester.kp]);
    accept_job(&mut env, &provider, job2).unwrap();
    let refund = instr(
        ix::RefundVerificationJob {},
        acc::RefundJob {
            requester: requester.key(),
            job: job2,
            vault: jvault_pda(&job2),
            mint: env.mint,
            requester_token: requester.token,
            token_program: spl_token::ID,
        },
    );
    env.fails(&[refund.clone()], &[&requester.kp], "InvalidState");
    let t = env.now();
    env.set_time(t + DAY + 1);
    assert!(submit_job_result(&mut env, &provider, job2).is_err(), "late result rejected");
    env.ok(&[refund], &[&requester.kp]);
    assert_eq!(env.balance(&requester.token), 95 * USDC);
}

trait PubkeyCompat {
    fn pubkey_compat(&self) -> Pubkey;
}
impl PubkeyCompat for solana_keypair::Keypair {
    fn pubkey_compat(&self) -> Pubkey {
        solana_signer::Signer::pubkey(self)
    }
}
