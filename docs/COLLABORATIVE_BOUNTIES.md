# Collaborative dataset bounties

This extends the existing marketplace with independently scoped seller agents, a shared accepted-image target, cross-seller duplicate detection, human-approved reservations/review, live updates, immutable accounting and authorized settlement using existing designated-seller contracts. `COLLABORATIVE_BOUNTIES_ENABLED` defaults off; requests opt in individually.

## Reused architecture

Fastify 5 and Zod 4 routes reuse wallet sessions, API-key scopes and rate limits. Drizzle/PostgreSQL and PGlite share the additive migration. Uploads reuse owned immutable asset versions, private R2/local storage, trusted finalization and existing quotas/billing. The existing Python/Pillow verifier supplies private SHA-256/dHash evidence; no competing verification engine was added. NVIDIA enrichment reuses the existing assistant provider interface, cache and daily budgets. Next.js 16/React 19 use the existing datasheet components and wallet transaction builders. The Anchor program is unchanged.

## Creation and escrow safety

The existing `POST /bounties` accepts `collaborationTarget` for enabled, single-structure image requests. The new-request page exposes the opt-in. The parent escrow's designated seller is a PDA in the existing program's `collaboration-reserve` namespace. No instruction signs for that namespace, so an individual seller cannot accept the shared parent escrow; the buyer retains ordinary cancellation/refund. Legacy funded open requests cannot be silently converted to this reserved funding model.

After final human approval, the buyer cancels/refunds the parent and explicitly approves a final delivery deadline and frozen manifest hash. Fresh chain reads verify that parent funding was released. One existing designated-seller contract is prepared per eligible contributor, with unique `(bounty, contributor)` records. Repeated/concurrent preparation returns the same plan. Gross child amounts sum exactly to the original approved reward; wallet addresses come from frozen ownership, never model/request input.

The buyer signs each child funding transaction. Each seller accepts only their designated contract, uploads/verifies a final accepted-only bundle and signs its commitment. Buyer acceptance, settlement, replay protection, license receipts and private downloads follow the existing escrow state machine. Final bundle hashes must exactly match the contributor's accepted ownership and complete trusted byte-verification evidence: substituted, extra, rejected and duplicate files are refused. No agent or backend controller signs or transfers funds.

The manifest's `blocked_contract_requires_single_seller` status describes direct payment from the parent escrow; the settlement plan supplies the existing-contract alternative. This is not an unaudited multi-recipient smart-contract redesign.

## Durable coordination and verification

Migration `0009_collaboration.sql` adds `collaborative_bounties`, `bounty_collaborators`, `seller_agents`, `collaboration_events`, `contribution_claims`, `agent_proposals`, `collaboration_submissions`, `submission_items`, `collaboration_verifier_evidence`, `collaboration_invitations` and `collaboration_settlements`. Existing balances/tables are not dropped, renamed or reinterpreted. Explicit SQL manages these tables: review future generated migration diffs to avoid dropping SQL-managed objects.

Mutations lock the bounty parent row. A partial unique index independently prevents two accepted records for one bounty/content hash. Events carry IDs, numeric sequence, originating agent, human actor, correlation ID, timestamp, payload, processing status, visibility and unique idempotency key. The pending-submission inbox and private verifier evidence recover processing after crashes; committed submissions cannot count twice. Failed jobs can be retried with new authorized verification; incomplete evidence remains pending.

SHA-256 matches are detected across all contributors in the bounty. Verification commit order and sorted paths deterministically resolve simultaneous identical content. dHash candidate indexing uses exact pigeonhole bands with a configurable Hamming threshold. Near matches enter review: similarity alone never permanently rejects distinct bytes. Sampled AI confidence is not file-level acceptance. Buyer relevance/quality/license decisions determine acceptance.

Each active seller agent observes permitted shared summaries, considers its own accepted/duplicate counts, and proposes corrective work or additional contributions. Existing proposals adapt to shortfall changes. Human owners approve, reject or modify reservations; first approved claim to acquire the lock wins competing capacity. Claims expire and support partial fulfillment/release. Invalidation reconciles fulfillment. Leaving pauses the agent and releases work while preserving accepted ownership. Withdrawal before accounting freeze invalidates owned items and restores the shortfall. Private participation requires buyer invitations.

Default cooperation is deterministic and event-driven. Optional NVIDIA explanations/proposals require explicit consent and reuse `AssistantProvider`, `nvidiaAssistant`, `cachedAgent`, strict schemas and existing account/global call limits. Only numeric aggregates and opaque bounty/agent IDs are shared. Providers never get file, signing, approval or mutation tools; Gemini can replace the provider without rewriting accounting.

## Inspection, privacy and delivery

Contributors explicitly grant/revoke buyer inspection of original images before payment. Short-lived wallet-bound `collaboration_review` tokens use the existing private download pipeline, which rechecks permission, current status and source version on every request. Revocation/withdrawal denies outstanding tokens. Inspection is not a purchase license. Other sellers cannot inspect those files. Shared events omit raw hashes, filenames, object keys and foreign duplicate references.

The buyer review queue shows image/declaration/permission state. Final licensed downloads remain behind fresh on-chain settlement and granted-license checks, with the existing R2 gateway, ranges, access accounting and billing. Source/accepted assets retain lifecycle protection; withdrawal does not delete someone else's files.

SSE uses authenticated fetch streams, never bearer tokens in query strings. Durable numeric cursors and authoritative snapshot reloads recover reconnects; periodic closure forces reauthentication and backpressure closes slow streams. Review, contribution and event history are paginated. Snapshot claims/proposals are capped at 200; very large membership requires further list paging/materialized progress before raising operational scale.

## Accounting and pricing

Integer largest-remainder allocation sums exactly to the gross reward, with stable owner-ID ties. The cat fixture reaches 9,700/10,000, resolves a 300-image shortfall, then allocates gross rewards of 200, 135 and 165 USDC. Existing configured commission remains 600 bps on the live test deployment, with the existing per-escrow rounding rules. Storage, verification, access and network expenses remain separate; no automatic reimbursement is introduced.

A frozen manifest binds currency, escrow address, existing terms/criteria/license hashes, accepted ownership, payout identities and approver, using canonical domain-separated digests that survive JSONB key reordering. It cannot be silently edited after approval.

A five-minute publication-admission tolerance fixes an existing one-month hosting boundary: wallet confirmation no longer makes newly purchased 30-day coverage immediately insufficient to publish. This does not extend paid intervals or change prices. Previously skipped legacy tests now pay current storage/hosting charges and distinguish legacy third-party/manual escrow compatibility from current platform-verifier policy.

## Endpoints

Unless noted, paths are prefixed `/bounties/:id`. UUIDs, bodies, counts, deadlines, pagination and cursors are validated. Reads require authorization/membership; human approvals and preparation reject API keys. Global limits apply, with a six/minute enrichment limit.

| Method | Path | Function |
| --- | --- | --- |
| POST | `/bounties` (root) | Existing creation with optional `collaborationTarget` |
| GET | `/collaboration-status` | Availability/opt-in |
| POST | `/collaboration/enable` | Suitable draft/reserved request opt-in |
| GET | `/collaboration`, `/collaborators`, `/agents` | Shared snapshot/participants |
| POST | `/collaborators/join`, `/collaborators/leave`, `/collaborators/invite` | Membership |
| GET | `/progress`, `/work-plan`, `/proposals` | Confirmed progress/plan |
| GET | `/agent-events?after=0&limit=100` | Event pagination; maximum 200 |
| GET | `/events/stream?after=0` | Authenticated SSE replay |
| POST | `/work-claims` | `{count,idempotencyKey}` |
| POST | `/work-claims/:claimId/release` | Release own work |
| POST | `/proposals/:proposalId/respond` | `{accept,count?}` |
| POST | `/agents/:agentId/propose` | Optional enrichment, `{consent:true}` |
| GET/POST | `/contributions` | Authorized list / owned finalized upload and verification attachment |
| POST | `/contributions/:submissionId/review-access` | `{granted}` |
| POST | `/contributions/:submissionId/withdraw` | Withdraw before freeze |
| GET | `/review-items?offset=0&limit=50` | Review queue; maximum 100 |
| GET | `/review-items/:itemId/content` | Authorized original-image inspection |
| POST | `/review-items/:itemId/respond` | Buyer `{accept,reason}` |
| POST | `/payout-manifest` | Freeze replay-safe allocation |
| GET/POST | `/settlement-plan` | Read / prepare designated contracts with explicit manifest/deadline approval |
| GET | `/health/release` (API root) | Deployed revision/feature state |
| GET | `/api/release` (web origin) | Deployed frontend revision |

## Tests and demos

```powershell
npm run typecheck
npx tsc -p apps/web/tsconfig.json --noEmit
npm test
npm run program:test
npm run build -w @edgebounty/web
npm run demo:collaboration
npm run demo:collaboration -- --serve
```

The CLI/loopback demo uses a new in-memory database and 10,300 deterministic records, never real escrow funding. At `http://127.0.0.1:4010`, select Mariam, approve 300 images, contribute fixtures, then select Buyer and freeze accounting. Restart to reset; never expose the fixture server publicly.

`tests/end-to-end/collaboration.test.ts` exercises real image uploads, paid verification, duplicate detection, scoped inspection, human acceptance, safe parent reservation/cancellation, designated contributor funding, exact bundle matching, license-gated delivery and repeated settlement rejection on an isolated validator. Synthetic large-count tests separately cover the 10,300-item example. Unit/security tests cover claims, concurrency, replay, invalidation, withdrawal, private invitations, permission revocation, provider consent/cache and canonical hashes. The unchanged program has 33 Rust tests.

`tests/integration/collaboration-postgres.test.ts` accepts only a disposable `edgebounty_collaboration_verify_*` database and tests independent pools, claims/duplicate races and rollback/restart. `scripts/collaboration-storage-smoke.ts` requires explicit opt-in, tests generated private R2 put/stat/read/ranges/interrupted-multipart cleanup, and deletes its probe objects. Deployment-specific results belong in the deployment report.

## Rollout and external gates

Back up database, source, private environment, PM2 and Caddy before additive migration. Stage/build before switching traffic. Preserve database identity, mock-USDC mint, genesis, program, treasury, commission and credentials. Roll back code/routes without rewinding the database or chain; additive tables remain.

The public deployment remains mock USDC on a private validator. Independent production audit, production signer custody/legal approval, Mainnet promotion and real-money transactions are separate external gates; this release does not claim them. No contract upgrade is needed. Actual provider billing remains account-dependent. Archived datasets need extraction-to-review mapping; the UI and final-bundle path use individual images. Missing/truncated evidence needs a complete authorized rerun. Post-freeze disputes use the existing contract dispute pathway rather than editing approved allocations.

Changed code: additive migration/journal; collaboration routes/coordinator/worker/settlement service; registration/config/release identity; token/download authorization; bounty creation/final-bundle enforcement; retention/hosting admission; Python validator 1.5.0; new-request/shared-workspace/review/contribution/settlement UI; verification controls; release route; tests/demos/storage probe/CI. Existing unrelated README and pricing changes are retained.
