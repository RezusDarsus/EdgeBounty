#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
PROGRAM_ID="$(solana-keygen pubkey "$REPO/keys/edgebounty_marketplace-keypair.json")"
# Persistent and isolated: no --reset, deletion, or reuse of an earlier ledger.
# Genesis program flags are ignored for an existing ledger; a fresh one gets an upgradeable program whose
# upgrade authority is the localnet authority, which initialize_platform requires.
# Info-level logs grew ~170 MB/hour and filled the 29 GB disk on 2026-10-17; keep warnings and errors only.
export RUST_LOG="${RUST_LOG:-solana=warn,agave=warn}"
exec solana-test-validator --ledger "$HOME/.edgebounty-usdc-20261017" \
  --mint "$(solana-keygen pubkey "$REPO/keys/localnet-authority.json")" \
  --bind-address 127.0.0.1 --rpc-port 8901 --faucet-port 9901 --gossip-port 13200 --dynamic-port-range 13000-13100 \
  --limit-blockstore-size 100000 \
  --upgradeable-program "$PROGRAM_ID" "$REPO/target/deploy/edgebounty_marketplace.so" "$REPO/keys/localnet-authority.json"
