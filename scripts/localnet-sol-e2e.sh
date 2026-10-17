#!/usr/bin/env bash
# Starts a fresh, separate wrapped-SOL validator for the end-to-end suite. It never touches the
# legacy demo ledger (~/.edgebounty-ledger, port 8899).
# Usage: wsl -d Ubuntu -- bash -l scripts/localnet-sol-e2e.sh
# Then:  SOLANA_RPC_URL=http://127.0.0.1:8999 npx vitest run tests/end-to-end
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SO="$REPO/target/deploy/edgebounty_marketplace.so"
PROGRAM_ID="$(solana-keygen pubkey "$REPO/keys/edgebounty_marketplace-keypair.json")"
AUTH="$REPO/keys/localnet-authority.json"
[ -f "$AUTH" ] || solana-keygen new --no-bip39-passphrase --silent -o "$AUTH"
LEDGER="$HOME/.edgebounty-sol-e2e-ledger"
rm -rf "$LEDGER"
rm -f "$REPO/keys/e2e-dispute-authority-8999.json"
echo "program $PROGRAM_ID, faucet mint authority $(solana-keygen pubkey "$AUTH"), rpc 8999"
exec solana-test-validator --reset --ledger "$LEDGER" \
  --mint "$(solana-keygen pubkey "$AUTH")" \
  --bind-address 127.0.0.1 --rpc-port 8999 --faucet-port 9990 --gossip-port 11000 --dynamic-port-range 11001-11100 \
  --bpf-program "$PROGRAM_ID" "$SO" >"$HOME/.edgebounty-sol-e2e-validator.log" 2>&1
