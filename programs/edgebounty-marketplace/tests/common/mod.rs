#![allow(dead_code)]
use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{bpf_loader_upgradeable, instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::token::spl_token,
    ::edgebounty_marketplace::{accounts as acc, constants::*, instruction as ix, instructions::*, state::*},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_program_pack::Pack,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

pub const USDC: u64 = 1_000_000;
pub const T0: i64 = 1_800_000_000;
pub const DAY: i64 = 86_400;

pub struct Env {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub dispute_authority: Keypair,
    pub mint: Pubkey,
    pub treasury: Pubkey,
}

pub struct User {
    pub kp: Keypair,
    pub token: Pubkey,
}

impl User {
    pub fn key(&self) -> Pubkey {
        self.kp.pubkey()
    }
}

pub fn pid() -> Pubkey {
    ::edgebounty_marketplace::id()
}

pub fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &pid()).0
}

pub fn config_pda() -> Pubkey {
    pda(&[CONFIG_SEED])
}
pub fn provider_pda(a: &Pubkey) -> Pubkey {
    pda(&[PROVIDER_SEED, a.as_ref()])
}
pub fn listing_pda(seller: &Pubkey, id: u64) -> Pubkey {
    pda(&[LISTING_SEED, seller.as_ref(), &id.to_le_bytes()])
}
pub fn order_pda(buyer: &Pubkey, id: u64) -> Pubkey {
    pda(&[ORDER_SEED, buyer.as_ref(), &id.to_le_bytes()])
}
pub fn vault_pda(order: &Pubkey) -> Pubkey {
    pda(&[VAULT_SEED, order.as_ref()])
}
pub fn submission_pda(order: &Pubkey, i: u8) -> Pubkey {
    pda(&[SUBMISSION_SEED, order.as_ref(), &[i]])
}
pub fn attestation_pda(subject: &Pubkey, i: u8) -> Pubkey {
    pda(&[ATTESTATION_SEED, subject.as_ref(), &[i]])
}
pub fn dispute_pda(subject: &Pubkey, i: u8) -> Pubkey {
    pda(&[DISPUTE_SEED, subject.as_ref(), &[i]])
}
pub fn license_pda(order: &Pubkey) -> Pubkey {
    pda(&[LICENSE_SEED, order.as_ref()])
}
pub fn reputation_pda(w: &Pubkey) -> Pubkey {
    pda(&[REPUTATION_SEED, w.as_ref()])
}
pub fn fbounty_pda(creator: &Pubkey, id: u64) -> Pubkey {
    pda(&[FAILURE_BOUNTY_SEED, creator.as_ref(), &id.to_le_bytes()])
}
pub fn fvault_pda(b: &Pubkey) -> Pubkey {
    pda(&[FAILURE_VAULT_SEED, b.as_ref()])
}
pub fn fexample_pda(b: &Pubkey, c: &[u8; 32]) -> Pubkey {
    pda(&[FAILURE_EXAMPLE_SEED, b.as_ref(), c.as_ref()])
}
pub fn job_pda(r: &Pubkey, id: u64) -> Pubkey {
    pda(&[JOB_SEED, r.as_ref(), &id.to_le_bytes()])
}
pub fn jvault_pda(j: &Pubkey) -> Pubkey {
    pda(&[JOB_VAULT_SEED, j.as_ref()])
}
pub fn receipt_pda(r: &[u8; 32]) -> Pubkey {
    pda(&[RECEIPT_SEED, r.as_ref()])
}

pub fn h(tag: u8) -> [u8; 32] {
    [tag; 32]
}

pub fn instr(data: impl InstructionData, accounts: impl ToAccountMetas) -> Instruction {
    Instruction::new_with_bytes(pid(), &data.data(), accounts.to_account_metas(None))
}

impl Env {
    pub fn new() -> Self {
        let mut env = Self::uninitialized();
        let admin = env.admin.pubkey();
        env.set_upgrade_authority(Some(admin));
        env.initialize(500);
        env
    }

    /// Program loaded (upgradeable, no authority yet) with mint/treasury created, platform not initialized.
    pub fn uninitialized() -> Self {
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/../deploy/edgebounty_marketplace.so"
        ));
        svm.add_program(pid(), bytes).unwrap();
        let admin = Keypair::new();
        let dispute_authority = Keypair::new();
        svm.airdrop(&admin.pubkey(), 100_000_000_000).unwrap();
        svm.airdrop(&dispute_authority.pubkey(), 10_000_000_000).unwrap();
        let mut env = Env {
            svm,
            admin,
            dispute_authority,
            mint: Pubkey::new_unique(),
            treasury: Pubkey::new_unique(),
        };
        env.set_time(T0);
        let mint = env.mint;
        env.create_mint(mint);
        let admin_key = env.admin.pubkey();
        let treasury = env.treasury;
        env.create_token_account(treasury, mint, admin_key, 0);
        env
    }

    pub fn programdata_pda() -> Pubkey {
        Pubkey::find_program_address(&[pid().as_ref()], &bpf_loader_upgradeable::ID).0
    }

    /// Rewrites the ProgramData header: bincode tag u32 (3) | slot u64 | Option<Pubkey> (tag byte + 32 bytes).
    pub fn set_upgrade_authority(&mut self, authority: Option<Pubkey>) {
        let key = Self::programdata_pda();
        let mut account = self.svm.get_account(&key).expect("programdata missing");
        assert_eq!(&account.data[..4], &3u32.to_le_bytes(), "not a ProgramData account");
        account.data[12..45].fill(0);
        if let Some(a) = authority {
            account.data[12] = 1;
            account.data[13..45].copy_from_slice(a.as_ref());
        }
        self.svm.set_account(key, account).unwrap();
    }

    pub fn set_time(&mut self, ts: i64) {
        let mut c: Clock = self.svm.get_sysvar();
        c.unix_timestamp = ts;
        c.slot += 1;
        self.svm.set_sysvar(&c);
    }

    pub fn now(&self) -> i64 {
        let c: Clock = self.svm.get_sysvar();
        c.unix_timestamp
    }

    pub fn create_mint(&mut self, mint: Pubkey) {
        let mut data = vec![0u8; spl_token::state::Mint::LEN];
        spl_token::state::Mint {
            mint_authority: Some(self.admin.pubkey()).into(),
            supply: 1_000_000_000 * USDC,
            decimals: 6,
            is_initialized: true,
            freeze_authority: None.into(),
        }
        .pack_into_slice(&mut data);
        self.svm
            .set_account(
                mint,
                solana_account(data, spl_token::ID, 1_000_000_000),
            )
            .unwrap();
    }

    pub fn create_token_account(&mut self, address: Pubkey, mint: Pubkey, owner: Pubkey, amount: u64) {
        let mut data = vec![0u8; spl_token::state::Account::LEN];
        spl_token::state::Account {
            mint,
            owner,
            amount,
            delegate: None.into(),
            state: spl_token::state::AccountState::Initialized,
            is_native: None.into(),
            delegated_amount: 0,
            close_authority: None.into(),
        }
        .pack_into_slice(&mut data);
        self.svm
            .set_account(address, solana_account(data, spl_token::ID, 2_039_280))
            .unwrap();
    }

    pub fn user(&mut self, usdc: u64) -> User {
        let kp = Keypair::new();
        self.svm.airdrop(&kp.pubkey(), 10_000_000_000).unwrap();
        let token = Pubkey::new_unique();
        let mint = self.mint;
        self.create_token_account(token, mint, kp.pubkey(), usdc);
        User { kp, token }
    }

    pub fn balance(&self, token: &Pubkey) -> u64 {
        match self.svm.get_account(token) {
            Some(a) if !a.data.is_empty() => spl_token::state::Account::unpack(&a.data).unwrap().amount,
            _ => 0,
        }
    }

    pub fn exists(&self, k: &Pubkey) -> bool {
        self.svm
            .get_account(k)
            .map(|a| a.lamports > 0)
            .unwrap_or(false)
    }

    pub fn fetch<T: AccountDeserialize>(&self, k: &Pubkey) -> T {
        let a = self.svm.get_account(k).expect("account missing");
        let mut d: &[u8] = &a.data;
        T::try_deserialize(&mut d).unwrap()
    }

    pub fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> Result<(), String> {
        self.svm.expire_blockhash();
        let payer = signers[0].pubkey();
        let msg = Message::new_with_blockhash(ixs, Some(&payer), &self.svm.latest_blockhash());
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
        self.svm
            .send_transaction(tx)
            .map(|_| ())
            .map_err(|e| format!("{:?}\n{}", e.err, e.meta.logs.join("\n")))
    }

    pub fn ok(&mut self, ixs: &[Instruction], signers: &[&Keypair]) {
        if let Err(e) = self.send(ixs, signers) {
            panic!("transaction failed: {e}");
        }
    }

    /// Asserts failure and that the logs mention `needle` (error name).
    pub fn fails(&mut self, ixs: &[Instruction], signers: &[&Keypair], needle: &str) {
        match self.send(ixs, signers) {
            Ok(()) => panic!("expected failure containing {needle}"),
            Err(e) => assert!(e.contains(needle), "expected `{needle}`, got:\n{e}"),
        }
    }

    // ------------------------------------------------------------- platform

    pub fn params(&self, fee_bps: u16) -> PlatformParams {
        PlatformParams {
            fee_bps,
            review_window_secs: 3 * DAY,
            correction_window_secs: 2 * DAY,
            failure_bounty_grace_secs: 7 * DAY,
            dispute_authority: self.dispute_authority.pubkey(),
        }
    }

    fn initialize(&mut self, fee_bps: u16) {
        let admin = self.admin.insecure_clone();
        if let Err(e) = self.try_initialize(&admin, fee_bps) {
            panic!("transaction failed: {e}");
        }
    }

    pub fn try_initialize(&mut self, signer: &Keypair, fee_bps: u16) -> Result<(), String> {
        let i = instr(
            ix::InitializePlatform { params: self.params(fee_bps) },
            acc::InitializePlatform {
                admin: signer.pubkey(),
                config: config_pda(),
                program: pid(),
                program_data: Self::programdata_pda(),
                payment_mint: self.mint,
                treasury: self.treasury,
                system_program: system_program::ID,
            },
        );
        self.send(&[i], &[signer])
    }

    pub fn update_fee(&mut self, fee_bps: u16) -> Result<(), String> {
        let i = instr(
            ix::UpdateConfig { params: self.params(fee_bps) },
            acc::AdminOnly { admin: self.admin.pubkey(), config: config_pda() },
        );
        let admin = self.admin.insecure_clone();
        self.send(&[i], &[&admin])
    }

    pub fn set_paused(&mut self, paused: bool) {
        let i = instr(
            ix::SetPaused { paused },
            acc::AdminOnly { admin: self.admin.pubkey(), config: config_pda() },
        );
        let admin = self.admin.insecure_clone();
        self.ok(&[i], &[&admin]);
    }

    // ------------------------------------------------------------- providers

    pub fn verifier(&mut self, caps: u32) -> User {
        let v = self.user(0);
        let i = instr(
            ix::RegisterProvider { metadata_hash: h(9), requested_capabilities: caps },
            acc::RegisterProvider {
                authority: v.key(),
                provider: provider_pda(&v.key()),
                system_program: system_program::ID,
            },
        );
        self.ok(&[i], &[&v.kp]);
        self.review_provider(&v.key(), true, caps);
        v
    }

    pub fn review_provider(&mut self, who: &Pubkey, approved: bool, caps: u32) {
        let i = instr(
            ix::ReviewProvider { approved, capabilities: caps },
            acc::ReviewProvider {
                admin: self.admin.pubkey(),
                config: config_pda(),
                provider: provider_pda(who),
            },
        );
        let admin = self.admin.insecure_clone();
        self.ok(&[i], &[&admin]);
    }

    // ------------------------------------------------------------- listings & orders

    pub fn create_listing(&mut self, seller: &User, id: u64, price: u64) -> Pubkey {
        let listing = listing_pda(&seller.key(), id);
        let i = instr(
            ix::CreateListing {
                listing_id: id,
                kind: AssetKind::Dataset,
                terms: ListingTerms {
                    asset_commitment: h(1),
                    terms_hash: h(2),
                    license_hash: h(3),
                    price,
                },
            },
            acc::CreateListing {
                seller: seller.key(),
                config: config_pda(),
                listing,
                system_program: system_program::ID,
            },
        );
        self.ok(&[i], &[&seller.kp]);
        listing
    }

    pub fn purchase_ix(
        &self,
        buyer: &User,
        listing: Pubkey,
        id: u64,
        price: u64,
        verifier: Option<&User>,
        verifier_fee: u64,
    ) -> Instruction {
        let order = order_pda(&buyer.key(), id);
        instr(
            ix::CreateOrder {
                order_id: id,
                params: PurchaseParams {
                    expected_price: price,
                    expected_version: 1,
                    verifier: verifier.map(|v| v.key()).unwrap_or_default(),
                    verifier_fee,
                    verifier_capability: 0,
                },
            },
            acc::CreateOrder {
                buyer: buyer.key(),
                config: config_pda(),
                listing,
                order,
                vault: vault_pda(&order),
                mint: self.mint,
                buyer_token: buyer.token,
                verifier_provider: verifier.map(|v| provider_pda(&v.key())),
                token_program: spl_token::ID,
                system_program: system_program::ID,
            },
        )
    }

    pub fn bounty_ixs(
        &self,
        buyer: &User,
        id: u64,
        amount: u64,
        verifier: Option<&User>,
        verifier_fee: u64,
        max_corrections: u8,
    ) -> Vec<Instruction> {
        self.bounty_ixs_ext(buyer, id, amount, verifier, verifier_fee, max_corrections, Pubkey::default(), Pubkey::default())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn bounty_ixs_ext(
        &self,
        buyer: &User,
        id: u64,
        amount: u64,
        verifier: Option<&User>,
        verifier_fee: u64,
        max_corrections: u8,
        designated_seller: Pubkey,
        arbitrator: Pubkey,
    ) -> Vec<Instruction> {
        let order = order_pda(&buyer.key(), id);
        vec![
            instr(
                ix::CreateBounty {
                    order_id: id,
                    params: BountyParams {
                        amount,
                        verifier: verifier.map(|v| v.key()).unwrap_or_default(),
                        verifier_fee,
                        verifier_capability: CAP_DATASET_IMAGE,
                        terms_hash: h(2),
                        criteria_hash: h(4),
                        license_hash: h(3),
                        deadline: self.now() + 10 * DAY,
                        max_corrections,
                        designated_seller,
                        arbitrator,
                    },
                },
                acc::CreateBounty {
                    buyer: buyer.key(),
                    config: config_pda(),
                    order,
                    verifier_provider: verifier.map(|v| provider_pda(&v.key())),
                    system_program: system_program::ID,
                },
            ),
            instr(
                ix::FundBounty {},
                acc::FundBounty {
                    buyer: buyer.key(),
                    config: config_pda(),
                    order,
                    vault: vault_pda(&order),
                    mint: self.mint,
                    buyer_token: buyer.token,
                    token_program: spl_token::ID,
                    system_program: system_program::ID,
                },
            ),
        ]
    }

    pub fn accept_bounty(&mut self, seller: &User, order: Pubkey) -> Result<(), String> {
        let i = instr(ix::AcceptBounty {}, acc::AcceptBounty { seller: seller.key(), order });
        self.send(&[i], &[&seller.kp])
    }

    pub fn submit(&mut self, seller: &User, order: Pubkey, commitment: [u8; 32]) -> Result<(), String> {
        let o: Order = self.fetch(&order);
        let i = instr(
            ix::SubmitDeliverable { commitment, version: 1 },
            acc::SubmitDeliverable {
                seller: seller.key(),
                order,
                submission: submission_pda(&order, o.submission_count),
                system_program: system_program::ID,
            },
        );
        self.send(&[i], &[&seller.kp])
    }

    pub fn verify(&mut self, verifier: &User, order: Pubkey, passed: bool) -> Result<(), String> {
        let o: Order = self.fetch(&order);
        let i = instr(
            ix::SubmitOrderVerification {
                verdict: VerdictParams {
                    result_hash: h(7),
                    spec_hash: h(8),
                    benchmark_version: 1,
                    passed,
                    expires_at: 0,
                },
            },
            acc::SubmitOrderVerification {
                verifier: verifier.key(),
                order,
                provider: provider_pda(&verifier.key()),
                attestation: attestation_pda(&order, o.submission_count),
                system_program: system_program::ID,
            },
        );
        self.send(&[i], &[&verifier.kp])
    }

    pub fn buyer_action(&mut self, buyer: &User, order: Pubkey, accept: bool) -> Result<(), String> {
        let a = acc::BuyerAction { buyer: buyer.key(), order };
        let i = if accept {
            instr(ix::AcceptDeliverable {}, a)
        } else {
            instr(ix::RejectDeliverable {}, a)
        };
        self.send(&[i], &[&buyer.kp])
    }

    pub fn settle_ix(&self, cranker: &User, order: Pubkey, seller: &User, buyer: &User, verifier: Option<&User>) -> Instruction {
        instr(
            ix::SettleOrder {},
            acc::SettleOrder {
                payer: cranker.key(),
                config: config_pda(),
                order,
                vault: vault_pda(&order),
                mint: self.mint,
                seller_token: seller.token,
                buyer_token: buyer.token,
                treasury: self.treasury,
                verifier_token: verifier.map(|v| v.token),
                buyer: buyer.key(),
                license_receipt: license_pda(&order),
                seller_reputation: reputation_pda(&seller.key()),
                buyer_reputation: reputation_pda(&buyer.key()),
                token_program: spl_token::ID,
                system_program: system_program::ID,
            },
        )
    }

    pub fn settle(&mut self, cranker: &User, order: Pubkey, seller: &User, buyer: &User, verifier: Option<&User>) -> Result<(), String> {
        let i = self.settle_ix(cranker, order, seller, buyer, verifier);
        self.send(&[i], &[&cranker.kp])
    }

    pub fn refund(&mut self, buyer: &User, order: Pubkey, verifier: Option<&User>) -> Result<(), String> {
        let i = instr(
            ix::RefundOrder {},
            acc::RefundOrder {
                buyer: buyer.key(),
                order,
                vault: vault_pda(&order),
                mint: self.mint,
                buyer_token: buyer.token,
                verifier_token: verifier.map(|v| v.token),
                token_program: spl_token::ID,
            },
        );
        self.send(&[i], &[&buyer.kp])
    }

    pub fn open_dispute(&mut self, opener: &User, order: Pubkey) -> Result<(), String> {
        let o: Order = self.fetch(&order);
        let i = instr(
            ix::OpenDispute { reason_hash: h(5) },
            acc::OpenDispute {
                opener: opener.key(),
                order,
                dispute: dispute_pda(&order, o.dispute_count),
                system_program: system_program::ID,
            },
        );
        self.send(&[i], &[&opener.kp])
    }

    pub fn resolve(&mut self, signer: &Keypair, order: Pubkey, r: DisputeResolution, seller_bps: u16) -> Result<(), String> {
        let o: Order = self.fetch(&order);
        let i = instr(
            ix::ResolveDispute { resolution: r, seller_bps },
            acc::ResolveDispute {
                dispute_authority: signer.pubkey(),
                config: config_pda(),
                order,
                dispute: dispute_pda(&order, o.dispute_count.saturating_sub(1)),
            },
        );
        self.send(&[i], &[signer])
    }
}

fn solana_account(data: Vec<u8>, owner: Pubkey, lamports: u64) -> solana_account::Account {
    solana_account::Account {
        lamports,
        data,
        owner,
        executable: false,
        rent_epoch: 0,
    }
}
