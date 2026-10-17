#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { sudo apt-get update -qq; sudo apt-get install -y -qq docker.io; }
sudo systemctl enable --now docker
mkdir -p .data/operations
chmod 700 .data/operations
node --input-type=module <<'JS'
import {existsSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
if (!existsSync('.data/operations/postgres.env')) {
 const admin=randomBytes(32).toString('hex'), app=randomBytes(32).toString('hex');
 writeFileSync('.data/operations/postgres.env',`POSTGRES_DB=edgebounty_usdc\nPOSTGRES_USER=edgebounty\nPOSTGRES_PASSWORD=${admin}\n`,{mode:0o600});
 writeFileSync('.data/operations/postgres-app.env',`DATABASE_URL=postgres://edgebounty_app:${app}@127.0.0.1:5433/edgebounty_usdc\n`,{mode:0o600});
 writeFileSync('.data/operations/create-role.sql',`CREATE ROLE edgebounty_app LOGIN PASSWORD '${app}';\nGRANT CONNECT, CREATE ON DATABASE edgebounty_usdc TO edgebounty_app;\nGRANT USAGE, CREATE ON SCHEMA public TO edgebounty_app;\nCREATE EXTENSION IF NOT EXISTS vector;\n`,{mode:0o600});
}
JS
if ! sudo docker container inspect edgebounty-postgres >/dev/null 2>&1; then
 sudo docker run -d --name edgebounty-postgres --restart unless-stopped --memory 768m --cpus 0.75 \
  --log-opt max-size=10m --log-opt max-file=3 --publish 127.0.0.1:5433:5432 \
  --env-file .data/operations/postgres.env --volume edgebounty_pgdata:/var/lib/postgresql/data \
  pgvector/pgvector:0.8.7-pg17-trixie >/dev/null
fi
for _ in $(seq 1 30); do
 if sudo docker exec edgebounty-postgres pg_isready -U edgebounty -d edgebounty_usdc >/dev/null 2>&1; then break; fi
 sleep 2
done
if ! sudo docker exec edgebounty-postgres psql -U edgebounty -d edgebounty_usdc -tAc "select 1 from pg_roles where rolname='edgebounty_app'" | grep -q 1; then
 sudo docker exec -i edgebounty-postgres psql -v ON_ERROR_STOP=1 -U edgebounty -d edgebounty_usdc < .data/operations/create-role.sql >/dev/null
fi
sudo docker exec edgebounty-postgres psql -v ON_ERROR_STOP=1 -U edgebounty -d edgebounty_usdc -tAc "select extversion from pg_extension where extname='vector'"
echo 'PostgreSQL and pgvector ready on loopback 5433; credentials withheld.'
