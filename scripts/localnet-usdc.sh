#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
PROGRAM_ID="$(solana-keygen pubkey "$REPO/keys/edgebounty_marketplace-keypair.json")"
# Persistent and isolated: no --reset, deletion, or reuse of an earlier ledger.
exec solana-test-validator --ledger "$HOME/.edgebounty-usdc-20261017" \
  --mint "$(solana-keygen pubkey "$REPO/keys/localnet-authority.json")" \
  --bind-address 127.0.0.1 --rpc-port 8901 --faucet-port 9901 --gossip-port 13200 --dynamic-port-range 13000-13100 \
  --limit-blockstore-size 100000 \
  --bpf-program "$PROGRAM_ID" "$REPO/target/deploy/edgebounty_marketplace.so"
