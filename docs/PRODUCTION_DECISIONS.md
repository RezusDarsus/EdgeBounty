# Operator decisions — October 17, 2026

## Deployment authorization

Continue development and testing on Devnet. Mainnet deployment and financial operations are explicitly unauthorized. The provisional ceiling is 5 SOL, not a spending target or permission to spend. Before any mainnet deployment, estimate program/ProgramData accounts, rent-exempt balances, initialization accounts and transaction fees using current network data and obtain explicit operator approval.

Operator-supplied Solana CLI configuration location: `/home/rezus/.config/solana/cli/config.yml`. Its existence and CLI access were verified in WSL. A read-only Devnet request returned genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. No transaction was submitted. Never print its referenced private key, any seed phrase or RPC credentials. Mainnet RPC and dedicated admin/multisig address are not configured.

The existing public MVP is a private test validator, not Devnet. Moving tests to public Devnet requires a separate program deployment and matching database identity; do not repoint or relabel the existing ledger, balances or financial records.

## Business and communications

EdgeBounty is a project name; no legal entity is registered yet. Primary operating jurisdiction: Georgia. Intended audience is international, subject to applicable restrictions; do not implement a Georgia-only customer restriction by default.

Current website: https://13-61-207-211.sslip.io/

Permanent production domain is pending. The operator designated `darsavelidzerezo@gmail.com` for support and security alerts and requested verification. This records authorization; deliverability, mailbox control and alert receipt have not been verified. Do not claim verification based solely on the supplied address. Test messages must be clearly labelled and contain no secrets or customer data.

International payments, sanctions, tax, privacy, digital-marketplace obligations and customer eligibility need jurisdiction-specific review before expanding launch coverage. Do not claim worldwide legal clearance or an incorporated operator.

## Security and launch status

No independent auditor has been selected. Arrange an independent Anchor escrow review before significant real-money transactions. Internal reviews and automated tests do not establish independent audit status. Mainnet RPC, multisig/custody design, branded domain and completed review remain pending.
