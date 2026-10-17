#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
sudo install -m 644 infrastructure/operations/edgebounty-* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now edgebounty-backup.timer edgebounty-health.timer
for _ in $(seq 1 30); do
 if curl -fsS http://127.0.0.1:4003/health/ready >/dev/null 2>&1; then break; fi
 sleep 1
done
sudo systemctl start edgebounty-health.service
sudo systemctl start edgebounty-backup.service
