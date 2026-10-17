#!/usr/bin/env bash
# Starts a fresh solana-test-validator with the EdgeBounty program preloaded.
# Usage: wsl -d Ubuntu -- bash -l scripts/localnet.sh
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SO="$REPO/target/deploy/edgebounty_marketplace.so"
PROGRAM_ID="$(solana-keygen pubkey "$REPO/keys/edgebounty_marketplace-keypair.json")"
AUTH="$REPO/keys/localnet-authority.json"
[ -f "$AUTH" ] || solana-keygen new --no-bip39-passphrase --silent -o "$AUTH"
LEDGER="$HOME/.edgebounty-ledger"
rm -rf "$LEDGER"
echo "program $PROGRAM_ID, faucet mint authority $(solana-keygen pubkey "$AUTH")"
exec solana-test-validator --reset --ledger "$LEDGER" \
  --mint "$(solana-keygen pubkey "$AUTH")" \
  --bind-address 127.0.0.1 --rpc-port 8899 \
  --upgradeable-program "$PROGRAM_ID" "$SO" "$AUTH" >"$HOME/.edgebounty-validator.log" 2>&1
