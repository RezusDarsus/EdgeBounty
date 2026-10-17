#!/usr/bin/env bash
# Execute inside a NEW release directory. The running SOL release and its databases are preserved.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$PWD"
case "$REPO" in /home/ubuntu/edgebounty-usdc-*) ;; *) echo 'Use a separate edgebounty-usdc-* release directory'; exit 1;; esac
mkdir -p keys
cp -n /home/ubuntu/edgebounty/keys/localnet-authority.json keys/ || true
cp -n /home/ubuntu/edgebounty/keys/edgebounty_marketplace-keypair.json keys/ || true
chmod 700 keys
chmod 600 keys/*.json apps/api/.env
if [ ! -d .venv ]; then ln -s /home/ubuntu/edgebounty/.venv .venv; fi
npm ci --ignore-scripts --no-audit --no-fund
if ! pm2 describe validator-usdc >/dev/null 2>&1; then pm2 start bash --name validator-usdc -- scripts/localnet-usdc.sh; fi
for _ in $(seq 1 30); do
  if curl -fsS -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' http://127.0.0.1:8901 | grep -q 'ok'; then break; fi
  sleep 2
done
npx tsx scripts/usdc-bootstrap.ts
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const host = 'preview.13-61-207-211.sslip.io';
const path = 'apps/api/.env';
const values = { APP_DOMAIN: host, CORS_ORIGINS: `https://${host}`, PORT: '4003', HOST: '127.0.0.1' };
const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line && !Object.hasOwn(values, line.split('=')[0]));
writeFileSync(path, [...lines, ...Object.entries(values).map(([k,v]) => `${k}=${v}`), ''].join('\n'), { mode: 0o600 });
writeFileSync('apps/web/.env.local', `NEXT_PUBLIC_PAYMENT_CURRENCY=USDC\nNEXT_PUBLIC_SOLANA_RPC_URL=https://rpc.${host}\nNEXT_PUBLIC_API_URL=https://api.${host}\nNEXT_PUBLIC_DEV_BURNER=1\n`);
JS
npx tsx scripts/usdc-e2e.ts
npm run build -w @edgebounty/web
if pm2 describe api-usdc >/dev/null 2>&1; then pm2 restart api-usdc; else pm2 start node --name api-usdc -- node_modules/tsx/dist/cli.mjs apps/api/src/server.ts; fi
if pm2 describe web-usdc >/dev/null 2>&1; then pm2 restart web-usdc; else pm2 start node --name web-usdc -- node_modules/next/dist/bin/next start apps/web -p 3003; fi
pm2 save
echo 'USDC demo staged on loopback API 4003, web 3003, RPC 8901. Existing public SOL routes unchanged.'
