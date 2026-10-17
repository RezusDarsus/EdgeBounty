use anchor_lang::prelude::*;

#[error_code]
pub enum EdgeBountyError {
    #[msg("Signer is not authorized for this action")]
    Unauthorized,
    #[msg("Platform is paused for new commitments")]
    Paused,
    #[msg("Fee exceeds the hard maximum")]
    FeeTooHigh,
    #[msg("Window duration out of range")]
    InvalidWindow,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Invalid state transition for this order")]
    InvalidState,
    #[msg("Deadline has passed")]
    DeadlinePassed,
    #[msg("Deadline has not passed yet")]
    DeadlineNotReached,
    #[msg("Deadline must be in the future")]
    InvalidDeadline,
    #[msg("Buyer, seller and verifier must be distinct wallets")]
    ConflictOfInterest,
    #[msg("Verifier is not an approved provider")]
    VerifierNotApproved,
    #[msg("Provider lacks the required capability")]
    MissingCapability,
    #[msg("Verifier account does not match the order")]
    VerifierMismatch,
    #[msg("Listing is not available for purchase")]
    ListingUnavailable,
    #[msg("Listing price or version changed")]
    ListingChanged,
    #[msg("No corrections remaining")]
    NoCorrectionsLeft,
    #[msg("Verification has not failed; rejection requires a failed verdict")]
    RejectionNotAllowed,
    #[msg("Invalid basis points value")]
    InvalidBps,
    #[msg("Token account owner mismatch")]
    TokenOwnerMismatch,
    #[msg("Treasury account mismatch")]
    TreasuryMismatch,
    #[msg("Verifier token account required")]
    VerifierTokenRequired,
    #[msg("Too many corrections requested")]
    TooManyCorrections,
    #[msg("Bounty is full")]
    BountyFull,
    #[msg("Bounty is not open")]
    BountyClosed,
    #[msg("Evaluation budget exhausted")]
    EvaluationBudgetExhausted,
    #[msg("Example already evaluated")]
    ExampleAlreadyEvaluated,
    #[msg("Bounty cannot be closed yet")]
    CannotCloseYet,
    #[msg("Listing has been moderated and cannot be reactivated")]
    ListingModerated,
    #[msg("No pending admin transfer")]
    NoPendingAdmin,
    #[msg("Invalid resolution")]
    InvalidResolution,
    #[msg("Attestation already revoked")]
    AlreadyRevoked,
    #[msg("Only the program upgrade authority can initialize the platform")]
    NotUpgradeAuthority,
}
