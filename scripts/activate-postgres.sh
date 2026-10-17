#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup=".data/operations/pre-postgres-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$backup"
cp apps/api/.env "$backup/api.env"
pm2 stop api-usdc >/dev/null
trap 'pm2 restart api-usdc >/dev/null' EXIT
cp -a .data/usdc/db "$backup/db"
set -a
source .data/operations/postgres-app.env
set +a
npx tsx scripts/migrate-pglite-to-postgres.ts "$backup/db"
node --input-type=module <<'NODE'
import fs from 'node:fs';
const p='apps/api/.env';
let s=fs.readFileSync(p,'utf8');
const value=fs.readFileSync('.data/operations/postgres-app.env','utf8').trim().slice('DATABASE_URL='.length);
s=s.replace(/^DATABASE_URL=.*\r?$/m, `DATABASE_URL=${value}`);
fs.writeFileSync(p,s,{mode:0o600});
NODE
pm2 restart api-usdc >/dev/null
trap - EXIT
echo "PostgreSQL activated. Original embedded database and configuration preserved at $backup"
