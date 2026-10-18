# EdgeBounty

**A marketplace for AI data and work, built on Solana.**

EdgeBounty helps people who need useful data or AI work meet the people who can provide it. A buyer can purchase a dataset or model, or fund a request for new work. Sellers publish what they offer and its terms. The platform checks files and records delivery and review steps, while payment is held until the order is completed under its agreed rules.

Think of Solana as a shared public record book that many independent computers keep in sync. Apps such as EdgeBounty use it to record payments and agreements. It is one part of a much larger ecosystem that includes wallets, digital currencies, marketplaces, games, finance apps and payment services.

## Solana, in a few words

- **SOL** is Solana's main digital currency. A wallet needs a small amount of SOL to pay the network for actions such as approving a purchase.
- **USDC** is a digital currency designed to track the US dollar. EdgeBounty's current demo uses *mock USDC* on a private test network; it has no real-world cash value.
- **Wallets** such as Phantom, Solflare and Backpack let a person connect to an app and approve a transaction. The wallet owner reviews and signs each payment.
- **Apps and programs** provide services on Solana. EdgeBounty uses its on-chain program for agreed payment and escrow steps; its website and private file storage handle the rest.
- **Validators** are independent computers that check and record network activity. Their work is supported by network fees paid in SOL.

Solana supports many independent projects. EdgeBounty is one small project in that ecosystem, focused on AI datasets, models and funded work.

## What you can do with EdgeBounty

- **Buy or sell AI assets:** browse datasets and models with descriptions, version details, license declarations and available checks.
- **Fund a request:** post a bounty for work you need, agree on what counts as complete, and fund it through the order flow.
- **Check a delivery:** the platform can run technical checks and bounded reviews. A check report is useful evidence, but it cannot prove that a seller owns the content or that it will work for every purpose.
- **Work together:** the newest collaborative bounty pilot lets multiple contributors coordinate on one request. It tracks accepted contributions and proposes how the reward could be divided. The existing Solana escrow pays one seller at a time: after buyer approval, a settlement plan creates designated contributor contracts funded and settled with explicit wallet signatures. The feature is opt-in and defaults off in local configuration.
- **Get help from the assistant:** the assistant can help discover listings, plan a bounty, and review or draft metadata. People remain responsible for decisions and wallet approvals.

## Fees, simply explained

The checkout page shows the quote and terms before you approve a wallet transaction. The exact quote is the one to follow.

| Charge | How it works |
| --- | --- |
| Marketplace commission | 6% of the completed sale or bounty reward. On a 100 USDC reward, the seller receives 94 USDC and EdgeBounty receives 6 USDC. |
| Storage and hosting | Paid in advance. The current rate is $0.045 per started GiB for each 30-day month, with a $0.30 monthly minimum per asset. |
| Downloads | The quote depends on file size and access period. Included download capacity is $0.15 per started GiB for each included copy. |
| Verification | Basic technical checks are included within their limits. More extensive sampled or human reviews may have a separate quoted charge. |
| Solana network fee | A small, variable fee paid in SOL for network actions. It is separate from EdgeBounty's charges and is not refunded by EdgeBounty. |

The marketplace commission is separate from any quoted storage, download or verification charge. For example, a 100 USDC bounty reward is still 100 USDC funded by the buyer; after settlement, 94 USDC goes to the seller and 6 USDC is the platform commission. Network fees still require SOL in the wallet.

## Current status

This project includes a working marketplace, a Solana payment program, private file storage, verification tools and a web app. The recent work also adds a collaborative bounty pilot. Some features and integrations are still limited to local or controlled demonstrations.

**The current USDC demo runs on a private test network and uses mock USDC. It is not a public Solana Mainnet service, and it is not ready for real funds.** The project has not completed an independent security audit. Verification reports and seller license statements are not guarantees of ownership, quality or legal rights.

## Try the demo

The demo is intended for someone setting up the project, rather than a public signup. It uses a local Solana test network and test tokens.

Requirements: Node.js 26 or newer, Python 3.12 or newer, and Rust/Solana/Anchor tools. On Windows, the Solana program build and test steps run in WSL with Ubuntu.

```bash
npm install
```

In a separate terminal, start the private test network and create its mock-USDC setup:

```bash
bash scripts/localnet-usdc.sh
npx tsx scripts/usdc-bootstrap.ts
```

Then start the API and website in separate terminals:

```bash
npx tsx apps/api/src/server.ts
```

```bash
npm run dev -w @edgebounty/web
```

Open [http://localhost:3000](http://localhost:3000), connect the local demo wallet, and use the test faucet. Never put a wallet recovery phrase or private key in the project or share it with anyone.

For an isolated collaborative bounty walkthrough, run `npm run demo:collaboration -- --serve` and open [http://127.0.0.1:4010](http://127.0.0.1:4010). This uses demonstration data and does not move funds.

## Learn more

- [Fees and checkout details](docs/PRICING_AND_FEES.md)
- [Collaborative bounties: pilot, demo and limitations](docs/COLLABORATIVE_BOUNTIES.md)
- [How the platform works](docs/PRODUCT.md)
- [Project implementation status and evidence](docs/MASTER_PLAN_IMPLEMENTATION.md)
- [Security and trust limitations](docs/threat-model/threat-model.md)
