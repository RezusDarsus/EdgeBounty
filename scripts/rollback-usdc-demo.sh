#!/usr/bin/env bash
# Restore the preserved SOL demo and its original public routes. USDC files/state stay intact.
set -euo pipefail
test -f /etc/caddy/Caddyfile.pre-usdc-20261017
pm2 start validator-sol
pm2 start api-sol web-sol
sudo caddy validate --config /etc/caddy/Caddyfile.pre-usdc-20261017 --adapter caddyfile
sudo install -m 644 /etc/caddy/Caddyfile.pre-usdc-20261017 /etc/caddy/Caddyfile
sudo systemctl reload caddy
pm2 stop api-usdc web-usdc validator-usdc
pm2 save
