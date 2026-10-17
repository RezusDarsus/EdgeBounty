# EdgeBounty pricing and fees

This guide explains the charges shown in EdgeBounty checkout. The checkout quote for the specific asset and term is authoritative and is shown before a wallet transaction is signed. Prices below are this test-network MVP's configured USD rates; USD service charges convert to SOL using the rate locked in each quote. Marketplace sale proceeds are denominated in USDC. Solana network transaction fees are separate and paid in SOL.

## Marketplace sales and funded requests

The 6% commission is deducted from the settled sale reward. The seller receives the other 94%. There is no flat commission and no minimum commission. For a 100 USDC sale: the seller receives 94 USDC and EdgeBounty receives 6 USDC. The buyer's escrow payment is still 100 USDC; any separately quoted hosting, download or verification services appear as separate line items.

## Storage and hosting

There is no free storage allowance. Customer uploads, including listing assets, require paid storage capacity. Listing versions also need funded hosting coverage before they can remain available for sale. Existing active orders and disputes retain their access under their terms.

Hosting is prepaid for 30-day months. The monthly charge for an asset is the greater of the $0.30 monthly minimum or $0.045 multiplied by the number of started GiB. One GiB is 1,073,741,824 bytes, and any positive file size below one GiB is billed as one GiB.

| Stored asset size | Monthly hosting charge |
| --- | ---: |
| Up to 1 GiB | $0.30 minimum |
| 10 GiB | $0.45 |
| 100 GiB | $4.50 |
| 500 GiB | $22.50 |

The storage page quotes available capacity and term before payment. Unused paid storage is capacity, not a cash balance. When hosting expires, the asset enters the stated read-only grace period and may then be removed, except where active orders, listings or disputes require retention.

## Buyer access and downloads

Checkout can include hosting for periods that are not already covered by seller prepayment or earlier funded hosting. It does not charge buyers again for an already funded hosting interval.

Download capacity is based on complete copies of the purchased asset: one copy for 1-month access, two copies for 3-month access, and three copies for 6-month access. Each included copy is charged at $0.15 per started GiB. For a 10 GiB asset, the download line is $1.50, $3.00 or $4.50 for 1, 3 or 6 months, respectively. Additional capacity can be prepaid at $0.15 per started GiB. The exact capacity and amount are listed in the checkout quote.

Downloads can be resumed with byte-range requests. The gateway reserves requested bytes as it serves them; if a connection is interrupted, some reserved bytes may still count. The authorization record proves how many bytes the service allowed or sent, not that the user's device saved a complete file.

## Verification and processing

L1 technical checks are included with listing verification, within the published limits. L2–L3 sampled reviews are quoted before starting, prepaid, and capped to the item count, runtime and materialization limit in the quote. L4 human review is quoted individually. A cached result can be reused for the same immutable version and settings without another verification run charge. Full scans beyond the deployment's capacity are declined until separately budgeted processing capacity is available.

An AI draft or explanation does not sign transactions or change a listing, verification outcome, bounty budget or escrow. Provider usage is subject to the configured account and daily request limits; no user-facing AI charge is added by the current assistant.

## Network fees, refunds and quote review

Wallet transactions require SOL for Solana network fees. These are charged by the network and may vary; they are not included in the USD service rates. Read the locked exchange rate, service items, total and any access or usage limits before signing. If the quote does not match your intent, do not sign it.

Refunds and disputes follow the order terms and escrow state. A network transaction fee already paid to validators is not an EdgeBounty service charge and is not returned by the platform.

## Support

For help understanding a quote, storage plan, upload or transaction, contact [darsavelidzerezo@gmail.com](mailto:darsavelidzerezo@gmail.com). Include the relevant page or public transaction signature. Never send a wallet seed phrase or private key.

Prices and policy can change; the quote displayed for a transaction records the rates and terms that apply to that transaction. This MVP currently uses mock USDC on a private test validator and is not a Mainnet service.
