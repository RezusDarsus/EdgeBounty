use anchor_lang::prelude::*;

use crate::state::{JobState, OrderState};

#[event]
pub struct OrderStateChanged {
    pub order: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub state: OrderState,
    pub at: i64,
}

#[event]
pub struct OrderPaidOut {
    pub order: Pubkey,
    pub seller_net: u64,
    pub platform_fee: u64,
    pub verifier_paid: u64,
    pub buyer_refund: u64,
}

#[event]
pub struct AttestationIssued {
    pub attestation: Pubkey,
    pub subject: Pubkey,
    pub verifier: Pubkey,
    pub passed: bool,
}

#[event]
pub struct JobStateChanged {
    pub job: Pubkey,
    pub state: JobState,
    pub at: i64,
}

#[event]
pub struct FailureExampleEvaluated {
    pub bounty: Pubkey,
    pub example: Pubkey,
    pub accepted: bool,
    pub reward_paid: u64,
}

#[event]
pub struct ServicePaid {
    pub receipt: Pubkey,
    pub payer: Pubkey,
    pub amount: u64,
    pub kind: u8,
}
