#!/usr/bin/env bash
# One-box hackathon demo on an Ubuntu EC2 instance:
#   solana-test-validator (program preloaded) + API + web, behind Caddy with automatic HTTPS
#   on free <ip>.sslip.io hostnames. Run from the repo root on the server:
#     bash infrastructure/ec2/setup.sh
# Safe to re-run (it rebuilds and restarts everything; chain + data are kept).
# DEMO ONLY: localnet chain with a public faucet. Not for real funds.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"

# ---- public hostname -------------------------------------------------------
if [ -z "${PUBLIC_IP:-}" ]; then
  TOKEN=$(curl -sX PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
  PUBLIC_IP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4)
fi
HOST="${PUBLIC_IP//./-}.sslip.io"
echo "==> public host: https://$HOST"

# ---- system packages (first run only) -------------------------------------
if ! command -v node >/dev/null || ! node -v | grep -q "^v2[6-9]"; then
  echo "==> installing Node 26 (same major as dev; Node 22 cannot see @anchor-lang/core named exports like BN)"
  curl -fsSL https://deb.nodesource.com/setup_26.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo apt-get update -y
sudo apt-get install -y python3-venv python3-pip bzip2 build-essential curl debian-keyring debian-archive-keyring apt-transport-https
if ! command -v caddy >/dev/null; then
  echo "==> installing Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update -y && sudo apt-get install -y caddy
fi
command -v pm2 >/dev/null || sudo npm install -g pm2
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
if ! command -v solana-test-validator >/dev/null; then
  echo "==> installing Solana CLI"
  sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
fi
# swap so next build + validator fit on small instances
if [ ! -f /swapfile ]; then
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

# ---- app dependencies ------------------------------------------------------
echo "==> npm install + python venv"
npm install
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q pillow numpy pyarrow onnx onnxruntime

# ---- Solana validator (persistent ledger, survives restarts) --------------
SO="$REPO/target/deploy/edgebounty_marketplace.so"
[ -f "$SO" ] || { echo "missing $SO - upload target/deploy/edgebounty_marketplace.so"; exit 1; }
PROGRAM_ID="$(solana-keygen pubkey keys/edgebounty_marketplace-keypair.json)"
[ -f keys/localnet-authority.json ] || solana-keygen new --no-bip39-passphrase --silent -o keys/localnet-authority.json
pm2 delete validator >/dev/null 2>&1 || true
pm2 start "$(command -v solana-test-validator)" --name validator -- \
  --ledger "$HOME/.edgebounty-ledger" \
  --mint "$(solana-keygen pubkey keys/localnet-authority.json)" \
  --bind-address 127.0.0.1 --rpc-port 8899 \
  --upgradeable-program "$PROGRAM_ID" "$SO" keys/localnet-authority.json
echo "==> waiting for validator"
for _ in $(seq 1 60); do
  curl -s -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' http://127.0.0.1:8899 | grep -q ok && break
  sleep 2
done

# ---- platform bootstrap + env files ---------------------------------------
echo "==> bootstrapping platform"
APP_DOMAIN="$HOST" CORS_ORIGINS="https://$HOST" \
PUBLIC_API_URL="https://api.$HOST" PUBLIC_RPC_URL="https://rpc.$HOST" \
  npx tsx scripts/dev-setup.ts
grep -q '^NVIDIA_API_KEY=.' apps/api/.env || echo "WARNING: NVIDIA_API_KEY missing in apps/api/.env - AI (Level 3) checks will be off"

set_env() { # set_env KEY VALUE -> replace or append in apps/api/.env
  local f=apps/api/.env
  grep -v "^$1=" "$f" > "$f.tmp" || true
  echo "$1=$2" >> "$f.tmp" && mv "$f.tmp" "$f" && chmod 600 "$f"
}

# ---- PostgreSQL (local, loopback only) -------------------------------------
if ! command -v psql >/dev/null; then
  echo "==> installing PostgreSQL"
  sudo apt-get install -y postgresql
fi
PG_PASS_FILE="$HOME/.edgebounty-pg-password"
[ -f "$PG_PASS_FILE" ] || { openssl rand -hex 24 > "$PG_PASS_FILE"; chmod 600 "$PG_PASS_FILE"; }
PG_PASS="$(cat "$PG_PASS_FILE")"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'edgebounty') THEN CREATE ROLE edgebounty LOGIN PASSWORD '$PG_PASS';
  ELSE ALTER ROLE edgebounty PASSWORD '$PG_PASS'; END IF;
END \$\$;
SQL
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='edgebounty'" | grep -q 1 || sudo -u postgres createdb -O edgebounty edgebounty
set_env DATABASE_URL "postgres://edgebounty:$PG_PASS@127.0.0.1:5432/edgebounty"

# ---- S3 object storage via the EC2 instance role (no access keys) ----------
# opt in with: S3_BUCKET=edgebounty-uploads-rezus-2026 AWS_REGION=eu-north-1 bash infrastructure/ec2/setup.sh
if [ -n "${S3_BUCKET:-}" ]; then
  echo "==> object storage: s3://$S3_BUCKET (${AWS_REGION:-eu-north-1}, instance role credentials)"
  set_env STORAGE_DRIVER s3
  set_env S3_BUCKET "$S3_BUCKET"
  set_env S3_REGION "${AWS_REGION:-eu-north-1}"
fi

# ---- API + web -------------------------------------------------------------
echo "==> building web"
npm run build -w @edgebounty/web
pm2 delete api web >/dev/null 2>&1 || true
(cd apps/api && pm2 start npx --name api -- tsx src/server.ts)
pm2 start npm --name web -- run start -w @edgebounty/web
pm2 save
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null

# ---- HTTPS ----------------------------------------------------------------
sed "s/{HOST}/$HOST/g" infrastructure/ec2/Caddyfile | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo systemctl reload caddy || sudo systemctl restart caddy

echo
echo "Done. Open https://$HOST  (API: https://api.$HOST/health, logs: pm2 logs)"
