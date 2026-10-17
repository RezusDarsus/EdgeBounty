#!/usr/bin/env bash
# Build + test the Anchor program inside WSL/Linux.
# Usage (from Windows): wsl -d Ubuntu -- bash -l scripts/build-program.sh [build|test|all]
# Sources are mirrored into ~/edgebounty-build (native FS is much faster than /mnt/c).
set -euo pipefail
MODE="${1:-all}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$HOME/edgebounty-build"
mkdir -p "$WORK" "$REPO/keys" "$REPO/target/deploy" "$REPO/target/idl" "$REPO/target/types"

rsync -a --delete --exclude target \
  "$REPO/programs" "$REPO/Cargo.toml" "$REPO/Anchor.toml" "$REPO/rust-toolchain.toml" "$WORK/"
[ -f "$REPO/Cargo.lock" ] && cp "$REPO/Cargo.lock" "$WORK/"

KP="$REPO/keys/edgebounty_marketplace-keypair.json"
if [ ! -f "$KP" ]; then
  solana-keygen new --no-bip39-passphrase --silent -o "$KP"
fi
mkdir -p "$WORK/target/deploy"
cp "$KP" "$WORK/target/deploy/edgebounty_marketplace-keypair.json"

cd "$WORK"
PROGRAM_ID="$(solana-keygen pubkey target/deploy/edgebounty_marketplace-keypair.json)"
# keep declare_id!/Anchor.toml in sync with the keypair (also in the repo copy)
for f in programs/edgebounty-marketplace/src/lib.rs "$REPO/programs/edgebounty-marketplace/src/lib.rs"; do
  sed -i "s/declare_id!(\"[A-Za-z0-9]*\")/declare_id!(\"$PROGRAM_ID\")/" "$f"
done
for f in Anchor.toml "$REPO/Anchor.toml"; do
  sed -i "s/^edgebounty_marketplace = \"[A-Za-z0-9]*\"/edgebounty_marketplace = \"$PROGRAM_ID\"/" "$f"
done

if [ "$MODE" = "build" ] || [ "$MODE" = "all" ]; then
  anchor build 2>&1 | grep -vE "^\s+Compiling " || true
  test -f target/deploy/edgebounty_marketplace.so
  cp target/deploy/edgebounty_marketplace.so "$REPO/target/deploy/"
  cp target/idl/edgebounty_marketplace.json "$REPO/target/idl/"
  cp target/types/edgebounty_marketplace.ts "$REPO/target/types/" 2>/dev/null || true
  cp Cargo.lock "$REPO/Cargo.lock"
fi
if [ "$MODE" = "test" ] || [ "$MODE" = "all" ]; then
  cargo test 2>&1 | grep -vE "^\s+Compiling "
fi
echo "PROGRAM_ID=$PROGRAM_ID"
