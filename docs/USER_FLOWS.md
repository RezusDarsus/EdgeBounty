# User journeys and failure states

## Buy an existing asset

Browse/search/filter real listings → inspect metadata, seller, license, previews and exact-version check reports → sign in with wallet → review quote/hosting/download terms → sign escrow transaction → backend verifies chain → delivery/review/settlement → entitlement-gated private download. A browser transaction callback alone must never grant entitlement. Chain outage, rejected signature, mismatched mint, failed verification and expired access must be explicit states.

## Publish

Sign in → create asset/version → reserve quota → obtain short-lived multipart authorization → upload direct to storage → finalize authoritative size/integrity checks → request budgeted verification → review report and hosting quote → sign listing → confirm publication. Do not describe a declared content hash as independently verified. Deleted/unpublished assets remain private.

## Fund and deliver a bounty

Create manually, or optionally request a draft after consent → inspect draft checklist/unanswered questions → explicitly apply text → choose acceptance criteria, reward, license and deadline → inspect verification and fee breakdown → wallet funding → contributor accepts → private upload → structural/sample checks → authorized human review/correction/dispute → chain settlement/refund → reconcile entitlement. Milestones are sequential; multi-seller slots are separate equal escrows, not arbitrary weighted contributor shares.

Drafting does not change reward, deadline, criteria or license fields. AI output cannot create, fund, approve or release escrow. Applying a draft overwrites only title, description and additional deliverables and is labeled accordingly.

## Discover

Enter a subject on the homepage → query only published catalog metadata → see matching terms and links → inspect listing evidence. No matches shows an honest empty state and bounty link. This initial discovery implementation uses keyword matching, not AI inference. Backend failure shows an error rather than fabricated recommendations.

## Review and administration

Reviewers use the existing assigned-order interfaces; administrators use wallet-authorized moderation and infringement queues. Private reports are account-scoped. Dispute evidence remains untrusted and must not be fetched as arbitrary URLs. Financial actions still require the existing authority and transaction controls.
