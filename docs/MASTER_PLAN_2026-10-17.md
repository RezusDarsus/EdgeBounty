# EdgeBounty — Complete Business, Technical Architecture & Development Master Plan

October 2026 • Consolidated project plan • MVP → Production → Scaling

This is the consolidated plan for EdgeBounty, combining everything we have discussed: the product concept, Solana integration, Cloudflare R2, AWS infrastructure, AI verification, marketplace commissions, storage subscriptions, downloads, security, profitability, and development roadmap.

The goal is to build a financially sustainable AI-data marketplace that can support very large datasets without requiring expensive infrastructure or owning GPUs.

## 1. Executive summary

EdgeBounty is a Solana-powered marketplace where people can buy, sell, verify, and commission AI datasets and machine-learning models.

It combines three major services:

1. AI Marketplace: Buy and sell datasets and trained AI models.
2. Custom Bounties: Fund requests for new datasets, annotations, models, or other AI-related work.
3. AI Verification: Evaluate submitted materials to help buyers understand their quality and suitability.

EdgeBounty uses Solana for programmable escrow and USDC payments, Cloudflare R2 for economical file storage and distribution, and external AI services for quality checks.

Core business configuration

Marketplace commission

# 6%

Hosting price

# $0.045

Per GB / month

Minimum paid hosting

# $0.30

Per month

Free personal storage

# 1 GB

Subject to usage limits

Primary objective: Every paid transaction should generate a positive contribution after its variable costs. Total contributions should eventually cover the platform's fixed operating expenses.

## 2. The problem EdgeBounty solves

AI developers need high-quality datasets, but obtaining them can be expensive, difficult and risky.

Consider a company developing an AI system to recognize Georgian road signs. It requires 20,000 labelled photographs covering different weather conditions, lighting situations and road environments.

The company faces several problems:

| Problem                                  | EdgeBounty solution                       |
| ---------------------------------------- | ----------------------------------------- |
| No suitable dataset exists               | Create a funded custom bounty             |
| Seller and buyer do not trust each other | Solana escrow and acceptance rules        |
| Dataset quality is uncertain             | Automated technical and AI checks         |
| Collecting examples is expensive         | Open submissions to multiple contributors |
| International payments are inconvenient  | USDC settlement                           |
| Large files are expensive to distribute  | Cloudflare R2 storage                     |
| Contributors need a way to earn money    | Dataset sales and bounty rewards          |

Our competitive advantage is not simply accepting cryptocurrency. It is connecting data production, marketplace transactions, structured verification, and programmable payments in one workflow.

## 3. How the product works

### Scenario A — Selling an existing dataset

A developer has created a dataset of 10,000 vehicle photographs.

1

Create listing

The seller provides a title, category, description, price and license.

2

Upload files

The browser uploads the dataset directly into private Cloudflare R2 storage.

3

Run checks

EdgeBounty validates metadata, file formats and available quality indicators.

4

Publish

The dataset becomes searchable, with its price and verification status.

5

Purchase

A buyer pays in USDC through the supported Solana payment workflow.

6

Authorize download

The backend confirms entitlement and issues secure access.

7

Settle payment

The seller receives 94% and EdgeBounty receives 6%, before separately disclosed costs.

The buyer obtains licensed access to the data. The seller earns money, and EdgeBounty earns a commission.

### Scenario B — Creating a custom bounty

A company needs 5,000 annotated images of Georgian road signs and offers 500 USDC.

The buyer creates the bounty with requirements, deadlines, acceptance criteria, contributor rewards and a dispute policy.

Funds are deposited into Solana escrow. Contributors submit work. Automated checks identify obvious defects, duplication and missing information. A designated reviewer or buyer then accepts qualifying submissions.

When the applicable acceptance conditions are satisfied, the smart contract distributes the rewards.

For example:

| Item                       | Amount   |
| -------------------------- | -------- |
| Completed bounty           | 500 USDC |
| EdgeBounty commission (6%) | 30 USDC  |
| Contributor rewards        | 470 USDC |

This example assumes the fee is deducted from the funded amount. The exact fee payer must be defined consistently in the product's terms and smart contracts.

For rejected work or unresolved disputes, funds remain governed by the escrow and refund rules rather than being released automatically.

### Scenario C — Buying a trained AI model

A developer uploads a trained computer-vision model, such as an ONNX or PyTorch model, with its description, architecture, intended use and license.

Potential buyers can inspect information about:

- Input and output formats.
- Supported tasks.
- Model size and dependencies.
- Evaluation benchmarks and supporting evidence.
- Licensing and commercial-use restrictions.
- Available security and verification reports.

The buyer purchases access through the marketplace.

Important: An uploaded trained model is an artifact for sale, not a model that EdgeBounty must automatically train. EdgeBounty should not execute unknown uploaded model code on the application server.

## 4. Final technical architecture

The architecture must separate the control plane from the data plane.

The control plane makes decisions about identities, access, purchases, billing and metadata.

The data plane moves potentially hundreds of gigabytes of files.

EdgeBounty Web Application

Search • Upload • Purchase • Download • Bounties

Metadata / authorization

AWS EC2

Fastify, business rules, upload sessions, payment verification

PostgreSQL

Direct file transfers

Cloudflare R2

Private object storage, multipart uploads, signed access

Cloudflare Worker

Paid download gateway

Solana / Anchor

Escrow • USDC • Settlement

Verification Services

NVIDIA MVP • Gemini production

### Technology stack

| Component              | Technology               | Purpose                            |
| ---------------------- | ------------------------ | ---------------------------------- |
| Frontend               | Existing web application | User interface                     |
| Backend                | Node.js, Fastify         | Business logic and authorization   |
| Database               | PostgreSQL               | Users, purchases, quotas, datasets |
| Main storage           | Cloudflare R2            | Dataset and model files            |
| Storage fallback       | AWS S3                   | Compatibility during migration     |
| API hosting            | AWS EC2                  | Application server                 |
| HTTPS                  | Caddy                    | TLS and reverse proxy              |
| Containers             | Docker                   | Deployment                         |
| Blockchain             | Solana                   | On-chain transactions              |
| Contracts              | Rust, Anchor             | Escrow, settlements                |
| Currency               | USDC                     | Marketplace payments               |
| Authentication         | Sign-In With Solana      | Wallet-based identity              |
| MVP AI                 | NVIDIA API               | Optional bounded AI checks         |
| Production AI          | Google Gemini            | Multimodal verification            |
| Vector search          | PostgreSQL + pgvector    | Similarity and duplicate detection |
| Download authorization | Cloudflare Worker        | Metered private downloads          |

These are the target technology choices. Individual components still require implementation and end-to-end verification.

### The most important infrastructure rule

Upload: Browser → Cloudflare R2

Download: Cloudflare R2 / Worker → Browser

Authorization: Browser → AWS EC2 → Database

Never proxy complete datasets through EC2.

This allows EC2 to remain relatively small while large-file traffic scales independently.

## 5. Cloudflare R2 storage strategy

Cloudflare R2 is our preferred production storage service because it offers low-cost object storage and zero internet egress bandwidth charges.

As of October 2026, Cloudflare's published R2 Standard rates are:

| Resource                       | Cloudflare R2 cost          |
| ------------------------------ | --------------------------- |
| Storage                        | $0.015/GB-month             |
| Upload bandwidth               | No ingress bandwidth charge |
| Internet download bandwidth    | $0 egress                   |
| Class A operations             | $4.50 / million             |
| Class B operations             | $0.36 / million             |
| Free monthly storage allowance | 10 GB-month                 |

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Cloudflare R2 docs

+1

R2 is not entirely free: object operations still cost money, and Cloudflare Workers can add request and execution charges. For frequently accessed marketplace files, R2 Standard is the initial preference. Infrequent Access has lower storage pricing but retrieval charges and a minimum storage duration.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Cloudflare R2 docs



### 5.1 Direct uploads

For small files, the backend creates a short-lived presigned PUT URL. The browser uploads directly to R2.

For large files, the frontend uses resumable multipart uploads with parallel parts, retries, progress reporting and cancellation.

Cloudflare R2 supports objects up to approximately 5 TiB through multipart uploads with up to 10,000 parts.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Cloudflare R2 docs

+1



A 500 GB dataset should therefore be technically feasible without using EC2 as a data relay.

The complete upload workflow:

1. The user selects a file.
2. Fastify verifies identity, quota and permitted file size.
3. PostgreSQL reserves sufficient storage capacity.
4. The backend creates a unique upload session and object key.
5. The browser uploads the file or multipart chunks directly to R2.
6. Failed parts are retried without restarting the entire upload.
7. The backend securely finalizes the session and independently checks the stored object.
8. The reservation becomes recorded storage usage after validation.
9. Expired or incomplete uploads are cleaned up.

The backend must validate completion rather than trusting the browser's success message.

### 5.2 Secure paid downloads

Marketplace files must be stored in private buckets.

For straightforward access, the backend can issue short-lived presigned GET URLs after verifying ownership or a valid purchase.

However, signed URLs are reusable until expiration. Therefore, they do not reliably enforce one-time download limits. Cloudflare documents these URLs as bearer credentials.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Cloudflare R2 docs



For stronger control, use a Cloudflare Worker with a private R2 binding.

The Worker should verify an authorization token, confirm the allowed dataset version, enforce the applicable download policy and stream the object directly from R2.

Download accounting must distinguish between:

- Authorized requests.
- Started transfers.
- Completed downloads, where completion can be reliably established.
- Actual bytes transferred, if accurately measured.

Resumed downloads using HTTP Range requests must be supported without creating accidental duplicate charges.

### 5.3 Storage quotas

The free tier remains 1 GB per eligible customer, with anti-abuse limits.

Paid customers can buy additional capacity, while marketplace hosting has a separate billing and quota policy.

A customer's private storage quota should not automatically include marketplace files when the seller has paid for separate marketplace hosting.

Database reservations must prevent simultaneous uploads from bypassing quota limits.

### 5.4 Data retention

Paid marketplace hosting can use prepaid durations of one or three months.

When a plan expires, the system should apply an explicitly documented retention policy: notify the owner, suspend access when appropriate, allow renewal or recovery during any grace period, and delete only when retention and refund obligations permit it.

Deletion must also reconcile database usage and billing records.

## 6. Complete business and monetization plan

EdgeBounty should generate revenue from marketplace commissions, storage hosting and optional infrastructure or verification services.

Our financial priority is to avoid creating services that cost more to deliver than the revenue they produce.

### 6.1 Recommended pricing

| Revenue source           | Planned price              | Status                 |
| ------------------------ | -------------------------- | ---------------------- |
| Dataset sales            | 6% commission              | Keep                   |
| AI model sales           | 6% commission              | Keep                   |
| Completed bounties       | 6% commission              | Keep                   |
| Paid marketplace hosting | $0.045/GB/month            | Proposed               |
| Minimum paid hosting     | $0.30/month                | Proposed               |
| Free personal storage    | 1 GB                       | Keep with restrictions |
| Extra download volume    | $0.15/GB                   | Keep initially; review |
| Basic file validation    | Included within limits     | Recommended            |
| Advanced AI verification | Prepaid, separately priced | Proposed               |
| GPU-based training       | Not included in MVP        | Defer                  |

The commission is 6%, not the previous 5%. No additional flat marketplace commission is assumed.

### 6.2 Marketplace commission

\\[ C\_{\text{sale}}=0.06P \\]

\\[ S\_{\text{seller}}=0.94P \\]

Where \\(P\\) is the completed transaction value, before any separately disclosed charges.

| Sale price | EdgeBounty earns | Seller receives |
| ---------- | ---------------- | --------------- |
| $10        | $0.60            | $9.40           |
| $25        | $1.50            | $23.50          |
| $50        | $3.00            | $47.00          |
| $100       | $6.00            | $94.00          |
| $500       | $30.00           | $470.00         |
| $1,000     | $60.00           | $940.00         |

The commission should be earned when settlement occurs, not simply when a buyer creates an order.

For bounties, the same principle applies: the commission is deducted when funds are legitimately released for accepted work. Dispute and refund workflows must explicitly account for platform fees.

### 6.3 Hosting charges

Our proposed rate is three times the base R2 Standard storage rate:

\\[ 0.015\times3=\\$0.045/\text{GB-month} \\]

The prepaid hosting charge is:

\\[ H=M\times\max(0.30,\\;0.045G) \\]

Where:

- \\(H\\) = hosting fee.
- \\(G\\) = billable storage in GB.
- \\(M\\) = number of prepaid months.

## Interactive hosting price calculator

Storage size

### 1,000 GB

Prepaid duration

1 month3 months

Customer pays

# $45.00

Gross storage margin

# $30.00

Estimated R2 storage cost

$15.00

Illustrative estimate before API requests, Worker costs, rounding, free-tier allocation, tax and other expenses. Assumes constant storage usage throughout the selected period.

Some standard storage examples:

| Stored data | Customer/month | R2 base/month | Gross difference |
| ----------- | -------------- | ------------- | ---------------- |
| 1 GB        | $0.30          | $0.015        | $0.285           |
| 10 GB       | $0.45          | $0.15         | $0.30            |
| 100 GB      | $4.50          | $1.50         | $3.00            |
| 500 GB      | $22.50         | $7.50         | $15.00           |
| 1,000 GB    | $45.00         | $15.00        | $30.00           |

These are gross storage differences, not total profit. The 3× price should be tested against actual operation, download-gateway, billing and support costs before being treated as a guaranteed margin.

### 6.4 Download fees

We previously planned $0.15 per GB for billable extra downloads.

Cloudflare R2 changes the economics because direct internet download bandwidth does not have an R2 egress charge.

There are three possible models:

| Model                                     | Benefits                            | Drawbacks                                                    |
| ----------------------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| $0.15/GB extra downloads                  | Predictable additional revenue      | Could discourage repeat purchases and reduce competitiveness |
| Free included downloads + paid extras     | User-friendly with usage protection | Requires allowance tracking                                  |
| Free downloads with fair-use restrictions | Simple buyer experience             | More infrastructure expense absorbed by platform             |

Recommended launch policy: Preserve the existing included-download rules and the $0.15/GB extra-download price until real usage data is available. Then evaluate lowering or removing the extra-download fee.

Keep included download allowances associated with the purchased product and hosting duration, rather than silently introducing unlimited consumption.

### 6.5 AI verification pricing

Basic checks should be included within reasonable limits.

Advanced checks requiring external AI APIs or substantial compute should be optional and prepaid.

A starting formula is:

\\[ V\_{\text{price}}\geq1.25\times V\_{\text{estimated cost}} \\]

This is a pricing floor, not a guarantee of profit. Add reserves for retries, failures, processing overhead and support.

Verification is charged once per unique dataset version and requested verification level, not once per buyer. If multiple customers purchase an already-verified version, the platform should reuse the cached result.

A new or materially changed version may require fresh verification.

## 7. Profitability calculations

The important financial distinction is between contribution margin and actual company profit.

\\[ \begin{aligned} \text{Net Profit}={}&\text{Commission Revenue}\\\ &+\text{Hosting Revenue}\\\ &+\text{Download Revenue}\\\ &+\text{Verification Revenue}\\\ &-\text{Variable Costs}\\\ &-\text{Fixed Operating Costs} \end{aligned} \\]

Variable costs include R2 storage and operations, Workers, paid AI processing, any platform-paid blockchain fees, and transaction-related costs.

Fixed costs include EC2, database hosting where applicable, backups, domain services, monitoring and other recurring infrastructure expenses.

### Example — A $100 dataset sale

Suppose a seller hosts a 100 GB dataset for one month and sells it for $100.

Illustrative transaction economics

| Marketplace commission                | +$6.00 |
| ------------------------------------- | ------ |
| Hosting revenue                       | +$4.50 |
| R2 storage                            | −$1.50 |
| Assumed transaction and request costs | −$0.25 |

Contribution before fixed costs

# $8.75

Assumes the seller separately pays hosting and the $0.25 variable-cost estimate is sufficient for this particular transaction. Does not include optional AI processing or unusual download consumption.

The seller receives $94 from the sale before separately charged hosting or other seller-side expenses.

### Monthly break-even calculator

Suppose the backend and other fixed expenses total $80 monthly, and each marketplace sale incurs $0.25 in variable costs.

Average sale price ($)

Monthly fixed costs ($)

Variable cost per sale ($)

Contribution per sale

# $5.75

Sales required to break even

# 14

Illustrative marketplace-only break-even. Excludes storage/download margins, taxes, refunds and additional expenses not entered above.

With the initial assumptions, 14 sales at $100 each would cover $80 of fixed costs.

This is why we need to measure real revenue, customer usage and variable costs, rather than assuming the 6% commission makes the marketplace profitable automatically.

## 8. AI Verification strategy

EdgeBounty should not attempt to train or run large proprietary AI models on dedicated GPUs during the MVP.

Instead, use a cost-controlled verification architecture.

There are three separate levels of verification.

### Level 1 — Basic technical validation

MVP priority

This is the cheapest and most important initial layer.

It can verify:

- File extension and detected format.
- File size and archive structure.
- Corruption where reliably detectable.
- Metadata consistency.
- Declared file counts.
- Cryptographic hashes.
- Exact duplicates where hashes are available.
- Basic manifest and dataset structure.

These checks should be subject to CPU, memory, file-count and time limits.

A technical validation report does not establish that the content itself is accurate, legal or suitable for training.

### Level 2 — Sample-based AI verification

Optional MVP / Early production

The system selects a bounded, representative sample of dataset items.

For an image dataset, it may inspect a sample and determine whether the contents appear consistent with the seller's description.

For an audio dataset, it may check samples for speech, language and obvious quality problems.

For video, it may analyze selected clips or frames.

AI verification should report:

- Number of submitted files.
- Number of files actually examined.
- Sampling method.
- Detected issues.
- Model and verification version.
- Confidence and limitations.

A dataset with 100,000 images and 500 inspected samples must be labelled Sample-verified, not fully verified.

### Level 3 — Advanced dataset verification

Production roadmap

Advanced checks can involve:

- Larger or complete scans.
- Semantic duplicate detection.
- Multimodal classification.
- Audio transcription and language assessment.
- Video analysis.
- Consistency checks on annotations.
- Model-artifact analysis.
- More extensive statistical quality reports.

These jobs should be prepaid and capped.

AI should help reviewers make decisions, but it should not automatically resolve contractual disputes involving uncertain quality, intellectual property or fraud.

### 8.1 NVIDIA for MVP, Gemini for production

| Stage                         | Provider                  | Role                                             |
| ----------------------------- | ------------------------- | ------------------------------------------------ |
| Basic MVP                     | CPU-based tools           | Format, metadata, simple integrity checks        |
| Optional MVP AI               | NVIDIA API                | Bounded AI analysis, where available             |
| Production                    | Google Gemini             | Image, audio, video and text analysis            |
| Production duplicate search   | Hashes and embeddings     | Detect repeated and semantically similar content |
| Full specialized verification | Selected compute provider | Only when justified by cost and customer demand  |

The earlier assumption that Gemini 1.5 or 2.0 Flash would verify 10,000 images for less than $0.50 should not be used as a reliable production estimate.

Google's current pricing page lists Gemini 3.1 Flash-Lite at $0.25 per million image/text/video input tokens and $1.50 per million output tokens, with separate audio pricing.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://ai.google.dev\&sz=32)

ai.google.dev



An illustrative calculation:

Assume each image requires 300 input tokens and 50 output tokens.

\\[ \begin{aligned} C\_{10k}={}&(3{,}000{,}000/10^6)\times0.25\\\ &+(500{,}000/10^6)\times1.50\\\ ={}&\\$1.50 \end{aligned} \\]

Under those assumptions, 100,000 images would cost $15.00.

Actual costs can be different because image tokenization, resolution, prompts, output length, repeated requests and model behavior affect token usage. Audio and video should be priced independently based on measured workloads.

### 8.2 Verification caching

Every published dataset should have an immutable version identifier.

For example:

`dataset-102 / version-3 / verification-profile-standard-v1`

The verification cache key should incorporate dataset content identity, verification policy and model/configuration version.

Once verified, a result can be reused across purchases of that unchanged dataset version.

Reevaluation is required when the content or verification requirements change materially.

This reduces repeated AI spending and improves the economics of selling the same dataset to multiple buyers.

### 8.3 Avoid transferring huge datasets for verification

The following pattern must be avoided:

`R2 → EC2 downloads 500 GB → AI processing → EC2 uploads 500 GB to R2`

Instead:

1. Inspect metadata and manifests first.
2. Verify hashes and declared structure where possible.
3. Read bounded samples using targeted object access.
4. Process those samples using an appropriate external service.
5. Store the results in PostgreSQL.
6. For full-content checks, schedule a separate job with a measured compute and network budget.

If a verification method requires reading the full 500 GB, the platform must disclose that and account for the necessary transfer and processing costs.

## 9. Why Solana is essential

EdgeBounty combines a centralized web application and storage system with decentralized financial settlement.

It would be misleading to describe the entire platform as completely decentralized because PostgreSQL, Cloudflare R2, the backend and AI services remain centrally operated.

The decentralized component is specifically the blockchain payment and escrow layer.

### 9.1 Why not use a normal payment database?

A database can record that someone paid $500, but the operator can also modify its records.

A properly designed and deployed escrow smart contract can enforce payment-release rules without depending solely on the platform's internal database.

This reduces certain kinds of counterparty risk.

It does not eliminate all trust: acceptance decisions, dispute resolution, smart-contract administration and security assumptions still matter.

### 9.2 How bounty escrow should work

Buyer deposits 500 USDC

Solana escrow PDA

Funds held under programmed release rules

Submission → Verification → Acceptance

Accepted work

470 USDC

Contributors

6% commission

30 USDC

EdgeBounty

Smart contracts should support order creation, escrow funding, settlement, cancellation, refunds and defined dispute resolution.

The contract should prevent double releases and unauthorized withdrawals.

The application must also handle finality, transaction retries, chain/RPC inconsistencies and idempotency.

Solana network fees are paid in SOL, even when the transfer involves USDC, and failed transactions can still incur fees.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://solana.com\&sz=32)

Solana



### 9.3 What belongs on-chain?

| On Solana                        | In PostgreSQL or R2            |
| -------------------------------- | ------------------------------ |
| Escrow identities                | Dataset descriptions           |
| Payment amounts                  | Private files                  |
| Settlement state                 | Search indexes                 |
| Payout rules                     | AI verification details        |
| Necessary transaction references | User preferences and analytics |
| Payment commitments              | Private business metadata      |

Only the minimum required financial state belongs on-chain.

Publishing entire datasets or sensitive buyer information to a public blockchain would be inappropriate.

## 10. Security architecture

EdgeBounty handles payments, customer data, potentially sensitive datasets and large files. Security must be built into the application rather than added after launch.

### Upload security

Use private R2 buckets, server-generated object keys, short-lived signed URLs, strict ownership checks and multipart upload authorization.

Do not expose R2 API keys to the frontend.

Enforce file size limits, quota reservations, upload expiration and concurrency controls. Multipart completion must be validated on the server.

### Download security

Only owners or customers with valid purchase entitlements should access private assets.

Tokens should bind access to a specific user or authorized session, object and immutable dataset version.

Where strict metering is needed, the Worker must prevent replay-based quota bypasses and concurrent overspending.

Do not enable shared public caching of paid/private responses unless the cache authorization model is explicitly secure.

### File security

Treat uploaded archives, executable models, serialized machine-learning artifacts and dataset contents as untrusted.

Potentially dangerous analysis should run in appropriately isolated workers with strict resource and network limits.

Do not load unknown model files using unsafe deserialization on the primary EC2 server.

Malware detection, archive-bomb protection, format inspection and quarantine should be proportional to the risk.

### Financial security

Smart-contract protections should include authorization, replay protection, duplicate-settlement prevention, checked arithmetic, safe account constraints and dispute handling.

Contracts holding real funds require thorough testing and an independent security review before meaningful production custody.

### Legal and data rights

AI datasets may contain copyrighted, private or personal information.

Sellers should have to declare ownership or sufficient licensing rights, and buyers should receive clear usage terms.

The platform needs mechanisms for reporting infringement, removing prohibited content and handling privacy or consent issues.

AI quality verification cannot establish legal ownership.

## 11. Database architecture

PostgreSQL should remain the source of truth for off-chain application state.

Suggested logical entities:

| Entity                | Important information                       |
| --------------------- | ------------------------------------------- |
| Users                 | ID, wallet identity, status                 |
| Wallet sessions       | Nonces, authentication expiry               |
| Datasets              | Owner, description, category                |
| Dataset versions      | Immutable version identity, manifest        |
| Dataset files         | R2 key, size, checksum, status              |
| Upload sessions       | Reservation, part state, expiration         |
| Storage subscriptions | Plan, billing term, expiration              |
| Storage usage ledger  | Reserved and committed capacity             |
| Purchases             | Buyer, product, settlement state            |
| Download entitlements | Access permissions and limits               |
| Download sessions     | Authorized attempts, usage counters         |
| Bounties              | Requirements, funding, deadline             |
| Bounty submissions    | Contributor, files, review status           |
| Escrow records        | Program accounts and transaction references |
| Verification jobs     | Provider, status, costs, results            |
| Verification cache    | Version and verification policy             |
| Billing ledger        | Charges, credits, refunds, adjustments      |
| Audit log             | Security-sensitive actions                  |

All financial operations should have durable, idempotent identifiers.

Database updates and blockchain operations are not one atomic transaction. The application therefore needs a reconciliation process to detect incomplete or inconsistent workflows.

## 12. System boundaries and reliability

A clean architecture separates six responsibilities:

| Subsystem    | Primary responsibility            |
| ------------ | --------------------------------- |
| API          | Authentication and business logic |
| Storage      | Upload, download, deletion        |
| Marketplace  | Listings, purchases, entitlements |
| Billing      | Usage, pricing, invoicing         |
| Blockchain   | Escrow, settlement, refunds       |
| Verification | Dataset inspection and reports    |

A failed AI verification request should not corrupt an uploaded dataset.

A failed billing update should not silently permit unauthorized access.

A temporary R2 outage should not damage Solana escrow state.

A blockchain RPC outage should not cause duplicate payment submissions.

For asynchronous processing, use durable jobs with retries and dead-letter handling where appropriate. Ensure all critical operations are recoverable after process restarts.

## 13. MVP versus production: what to build first

The biggest danger for EdgeBounty is trying to finish a complete enterprise platform before confirming that buyers and sellers actually want it.

The MVP should prove that someone can upload a legitimate dataset, publish it, sell it, and receive USDC while the platform earns its 6% commission.

### Phase 1 — Functional marketplace MVP

Priority: Critical

- Wallet-based authentication works reliably.
- Users can create dataset and AI model listings.
- Sellers can upload files securely.
- Buyers can browse and purchase datasets.
- Buyers receive access only after payment authorization.
- The 6% commission is calculated correctly.
- USDC settlement is reconciled with database records.
- Storage quotas and paid hosting are enforced.
- Basic file validation reports are available.
- Failed transactions and uploads can recover safely.

Acceptance criterion: A complete sale succeeds, including file delivery and correct payment distribution.

### Phase 2 — Cloudflare R2 migration

Priority: High

- Storage-provider abstraction supports both AWS S3 and R2.
- New uploads can use private R2 buckets.
- Browser uploads bypass EC2.
- Resumable multipart uploads support large datasets.
- Uploads above quotas are rejected.
- Paid downloads bypass EC2.
- Cloudflare Workers enforce stricter download policies.
- R2 operation costs and usage are measured.
- Existing AWS S3 workflows remain available.
- Migration and rollback are tested.

Acceptance criterion: A simulated 500 GB multipart transfer demonstrates the control flow without proxying dataset bytes through EC2. Use mock parts and small real integration fixtures rather than paying to upload 500 GB during testing.

Do not automatically delete or migrate existing S3 files.

### Phase 3 — Bounty infrastructure

Priority: High

- Buyer creates and funds a bounty.
- Required work and acceptance criteria are recorded.
- Funds remain in escrow until valid release conditions.
- Contributors submit work.
- Reviewers can accept or reject submissions.
- Payments are distributed correctly.
- Rejected work and disputes are handled.
- Refunds and cancellations have defined rules.
- Every on-chain settlement is reconciled.

Acceptance criterion: A funded bounty can progress from creation to legitimate contributor payment with consistent on-chain and off-chain state.

### Phase 4 — Production AI Verification

Priority: Medium

- Implement configurable Gemini-based verification.
- Support image, text, audio and video sampling.
- Add representative sampling and explicit confidence limits.
- Add exact hashing and semantic duplicate detection.
- Use pgvector where vector similarity is justified.
- Maintain verification results per immutable dataset version.
- Estimate costs before expensive jobs.
- Limit external API consumption.
- Add prepaid advanced verification.
- Compare model accuracy and cost on real datasets.

Acceptance criterion: A customer receives an accurately labelled quality report without EdgeBounty repeatedly paying to inspect unchanged datasets.

### Phase 5 — Commercial growth

Priority: After first successful transactions

Focus on discovery, trust and retention.

Important investments include better search, seller reputation, verified purchase reviews, dataset previews, collections, APIs for business customers, analytics and automated invoice records.

More advanced compute services, such as training or fine-tuning customer models, should be considered only after demand and unit economics have been validated.

## 14. Should EdgeBounty offer GPU training?

Not as a default MVP feature.

Buying a dedicated GPU would introduce a new category of costs and operational responsibilities.

We would need to manage compute scheduling, customer code execution, GPU utilization, isolation, storage access, checkpoints, failures, job cancellation and billing.

A marketplace for AI models does not automatically need to train those models.

| Option                                    | Initial recommendation   |
| ----------------------------------------- | ------------------------ |
| Customer trains externally, uploads model | Support                  |
| External API verifies model or dataset    | Support within limits    |
| Dedicated GPU purchased by EdgeBounty     | Defer                    |
| Customer-paid on-demand GPU job           | Evaluate later           |
| Full AI training platform                 | Long-term expansion only |

For future compute jobs, use a prepaid job-based model.

Before execution, estimate the maximum compute duration and cost. Reserve the customer's budget and stop processing when the limit is reached.

A safer pricing approach is:

\\[ P\_{\text{job}}\geq C\_{\text{compute}}+C\_{\text{storage}}+C\_{\text{operations}}+\text{required margin} \\]

Avoid a fixed unlimited training subscription before resource usage is understood.

## 15. Operating costs and financial projections

R2 can make large-file hosting economical, but the platform will still have monthly expenses.

Below is an illustrative planning scenario, not an observed AWS or Cloudflare bill.

### Monthly fixed-cost planning

| Expense                                        | Illustrative monthly budget |
| ---------------------------------------------- | --------------------------- |
| AWS EC2                                        | $50                         |
| Backups and monitoring                         | $10                         |
| Domain, supporting services and other overhead | $10                         |
| Cloudflare Worker base budget                  | $5                          |
| Contingency                                    | $5                          |
| Total                                          | $80                         |

This assumes the EC2 instance can also support the current database workload. A separately managed PostgreSQL service, additional infrastructure, taxes or higher real usage may increase costs substantially.

### Three revenue scenarios

Assumptions: $100 average sale price, $0.25 variable expense per sale, storage sold at $0.045/GB-month, R2 base storage cost of $0.015/GB-month, and $80 fixed monthly operating expenses. Other costs and download income are excluded.

| Metric                         | Early   | Growing  | Larger    |
| ------------------------------ | ------- | -------- | --------- |
| Completed monthly sales        | 10      | 100      | 500       |
| Marketplace volume             | $1,000  | $10,000  | $50,000   |
| Commission revenue             | $60     | $600     | $3,000    |
| Paid storage                   | 100 GB  | 1,000 GB | 10,000 GB |
| Hosting revenue                | $4.50   | $45      | $450      |
| R2 base storage expense        | $1.50   | $15      | $150      |
| Assumed sale variable expenses | $2.50   | $25      | $125      |
| Fixed expenses                 | $80     | $80      | $80       |
| Illustrative operating result  | −$19.50 | +$525    | +$3,095   |

These projections assume completed, nonrefunded purchases and exclude taxes, development compensation, support labor, unmodeled verification, download and Worker costs, and any changes in fixed infrastructure required for scaling.

They demonstrate that marketplace volume is the primary revenue driver, while paid hosting provides an additional margin.

Illustrative monthly operating result

USD, based on the three planning scenarios above

$-1.5K$0$1.5K$3K$4.5KEarlyGrowingLarger

The key objective is not to maximize revenue immediately. It is to demonstrate positive unit economics and then increase transaction volume.

## 16. Business risks and how to control them

| Risk                              | Mitigation                                        |
| --------------------------------- | ------------------------------------------------- |
| Low marketplace demand            | Recruit initial buyers and sellers before scaling |
| Storage abuse                     | Prepaid hosting, quotas, account restrictions     |
| Unexpected download costs         | R2 Standard, request limits and monitoring        |
| Expensive AI verification         | Prepayment, budgets, caching                      |
| Low-quality datasets              | Transparent verification levels and reviews       |
| Copyright violations              | Licensing requirements and takedown process       |
| Fraudulent sales                  | Entitlement checks, disputes and risk controls    |
| Smart-contract vulnerability      | Testing, review and controlled rollout            |
| Cloud service outage              | Retries, backups, recovery procedures             |
| Transaction and accounting errors | Durable ledgers and reconciliation                |
| Excessive free usage              | Limited 1 GB tier and abuse controls              |
| Vendor dependency                 | Storage abstraction and configurable AI providers |

The highest business risk is insufficient marketplace liquidity: buyers need worthwhile datasets, while sellers need enough customers to justify publishing their work.

The highest technical risks involve escrow correctness, data security, unauthorized file access and financial accounting.

Both sets of risks should receive attention before adding expensive advanced features.

## 17. What metrics EdgeBounty must track

A useful dashboard should measure both marketplace growth and the infrastructure needed to support it.

| Category     | Core metrics                                   |
| ------------ | ---------------------------------------------- |
| Marketplace  | GMV, completed sales, average sale size        |
| Revenue      | Commission revenue, hosting revenue            |
| Margins      | Contribution per transaction, per customer     |
| Storage      | Stored GB-months, reserved and committed bytes |
| Downloading  | Authorized downloads, transferred bytes        |
| Verification | Jobs, actual API cost, cache hit rate          |
| Bounties     | Funded, completed, disputed, refunded          |
| Reliability  | Upload success rate, transfer errors           |
| Security     | Unauthorized attempts, rate-limit events       |
| Customers    | Active buyers, sellers, repeat purchases       |

In particular, calculate:

\\[ \text{Commission Revenue}=0.06\times\text{Completed GMV} \\]

\\[ \text{Contribution Margin}= \text{Revenue}-\text{Variable Costs} \\]

\\[ \text{Contribution Margin Rate}= \frac{\text{Contribution Margin}}{\text{Revenue}}\times100\\% \\]

These measurements will tell us whether the pricing actually works.

## 18. What EdgeBounty should not build yet

To keep development focused, postpone features that are not required to prove the marketplace business model.

| Feature                               | Decision              | Reason                          |
| ------------------------------------- | --------------------- | ------------------------------- |
| Own GPU servers                       | Defer                 | Capital and operational expense |
| Unlimited free AI analysis            | Avoid                 | Uncontrolled API spending       |
| Full model-training infrastructure    | Defer                 | Separate complex product        |
| Custom blockchain token               | Not needed            | USDC is sufficient initially    |
| Full DAO governance                   | Defer                 | Not required to validate demand |
| Running arbitrary customer models     | Avoid in main backend | Serious security concerns       |
| Migrating all S3 data immediately     | Avoid                 | Migration risk                  |
| Building a replacement cloud provider | Avoid                 | Focus on marketplace value      |

Every feature should have a clear relationship to customer acquisition, transaction completion, retention, safety or financial sustainability.

## 19. Hackathon presentation strategy

For a hackathon, the strongest presentation shows a simple, complete workflow.

A judge should understand within the first minute:

What is the problem? AI teams struggle to obtain trustworthy, specialized datasets.

What is the solution? EdgeBounty lets customers buy data, commission new data and compensate contributors.

Why Solana? Escrow and programmable USDC settlement.

How does EdgeBounty make money? A 6% commission and separately charged infrastructure services.

### Recommended live demo sequence

1

Introduce the problem

Explain why AI companies need reliable, specialized datasets.

2

Show the marketplace

Navigate to dataset listings and explain how buyers discover products.

3

Demonstrate an upload

Show the listing creation and file upload workflow.

4

Show the purchase process

Demonstrate a purchase, entitlement check and download, using real working functionality.

5

Demonstrate a bounty

Show funding and contributor submission if that workflow is implemented.

6

Explain the technical advantage

Show where Solana, AI verification and cloud storage fit.

7

Finish with the business model

Explain the 6% commission, paid hosting and cost-controlled architecture.

Do not claim that Cloudflare R2, Gemini verification or all escrow dispute functions are live unless they have actually been implemented and tested. For the demo, distinguish working functionality from the production roadmap.

### Short Russian explanation for judges

EdgeBounty — это маркетплейс AI-датасетов и моделей, построенный с использованием блокчейна Solana.

Наша платформа позволяет разработчикам продавать готовые наборы данных, а компаниям — создавать заказы на сбор специализированных данных и финансировать их через USDC.

Главная проблема, которую мы решаем, — это доверие между покупателями и продавцами AI-данных. Покупатели хотят получать качественные датасеты, а исполнители хотят быть уверены, что их работа будет оплачена.

Для решения этой проблемы мы объединяем три технологии.

Первая — Solana. Она обеспечивает программируемое эскроу и прозрачное распределение платежей.

Вторая — облачная инфраструктура. Мы используем AWS для backend-сервисов и планируем Cloudflare R2 для хранения больших файлов. Это позволяет избежать дорогостоящей передачи датасетов через основной сервер.

Третья — искусственный интеллект. Мы используем автоматизированные проверки данных, а в production-версии планируем мультимодальную верификацию через Google Gemini.

Наша бизнес-модель включает комиссию 6% с завершённых сделок, платное хранение данных и дополнительные услуги проверки.

Главная цель EdgeBounty — создать доступный, прозрачный и экономически эффективный рынок, где качественные AI-данные можно покупать, продавать и заказывать.

## 20. Final decisions — EdgeBounty Master Plan

| Area                        | Decision                                                |
| --------------------------- | ------------------------------------------------------- |
| Product                     | Marketplace for AI datasets, models and custom bounties |
| Primary blockchain          | Solana                                                  |
| Payment currency            | USDC                                                    |
| Smart contracts             | Rust + Anchor                                           |
| Marketplace commission      | 6%                                                      |
| Main backend                | Node.js + Fastify                                       |
| Application hosting         | AWS EC2                                                 |
| Database                    | PostgreSQL                                              |
| Primary production storage  | Cloudflare R2                                           |
| Existing storage fallback   | AWS S3                                                  |
| Upload architecture         | Browser → R2                                            |
| Download architecture       | R2 / Worker → Browser                                   |
| Personal free tier          | 1 GB with limits                                        |
| Paid hosting rate           | $0.045/GB/month                                         |
| Minimum paid hosting        | $0.30/month                                             |
| Hosting durations           | 1 or 3 months                                           |
| Extra download pricing      | $0.15/GB initially, subject to review                   |
| Basic file checks           | Included within limits                                  |
| MVP AI provider             | NVIDIA API when needed and available                    |
| Production AI provider      | Google Gemini                                           |
| Duplicate detection         | File hashes, embeddings, pgvector                       |
| Advanced verification       | Separately prepaid, cost-limited                        |
| Verification billing        | Once per unique dataset version and verification level  |
| Dedicated GPUs              | Not required for MVP                                    |
| Large file transfer via EC2 | Prohibited                                              |
| Production priority         | Security, reliable settlement, positive unit economics  |

## 21. Final conclusion

The long-term goal of EdgeBounty is to become a trusted infrastructure layer for the AI-data economy.

The product must solve three problems simultaneously.

First: Create value for customers. Buyers should be able to find trustworthy datasets or commission new ones. Sellers and contributors should have practical ways to earn money.

Second: Build reliable infrastructure. Large files must be stored and transferred efficiently, payments must be securely settled, and verification results must accurately describe what was checked.

Third: Build a sustainable business. Every transaction should have controlled variable costs. Storage should be prepaid, expensive AI operations should be separately funded, and the 6% commission should contribute toward fixed platform expenses.

We do not need to own GPU servers, train our own large language models or build complicated infrastructure before we have customers.

We need one excellent end-to-end marketplace experience.

## The central EdgeBounty principle

A buyer can pay for AI data, a seller can deliver it securely, and the platform can earn revenue without paying more to fulfill the transaction than it collects.

Once this process works reliably, EdgeBounty can expand into specialized bounties, advanced verification, reputation systems and eventually paid AI compute.

This is the recommended strategic baseline for EdgeBounty as of October 17, 2026. It consolidates the intended architecture and pricing, not a claim that every planned component has already been deployed.