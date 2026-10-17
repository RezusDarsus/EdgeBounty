# Privacy, retention & compliance notes

**Not legal advice. A launch requires review by qualified counsel** (privacy, copyright and
database rights, consumer/digital goods, tax, virtual-asset/escrow regulation, sanctions).

## Data collected
wallet address, alias, optional public profile fields, listings, orders, asset references,
verification results, billing status, security events.

## Not collected by default
advertising trackers, third-party analytics, device fingerprints, identity documents.
Uploaded private data is never used to train unrelated models.

## Retention
| Data | Retention |
|---|---|
| Auth nonces | 5 minutes |
| IP addresses (rate limiting) | in-memory only, ≤ 1 hour |
| Security/audit events | 1 year |
| Incomplete uploads | 24 hours |
| Preview artefacts | until listing removed + 7 days |
| Expired storage allocation | 14-day grace then deletion; backups age out in 30 days |
| Delivery events / purchase records | 7 years (accounting) |
| Deleted account | profile erased; on-chain records are public and immutable |

## Pseudonymity limits
Solana transactions are public: wallet activity and amounts are visible. Pseudonymity is
not anonymity; EdgeBounty never promises untraceable payments.
