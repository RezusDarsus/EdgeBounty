#!/usr/bin/env bash
# Disk watchdog for the EC2 demo box. Run from cron every 5 minutes.
# Above THRESHOLD % it frees space that is safe to lose (text logs, caches) and logs a
# warning to syslog (tag: disk-watchdog) and ~/disk-watchdog.log.
# Never touches chain data (rocksdb, accounts, snapshots), the database, uploads,
# or the preserved USDC ledger (~/.edgebounty-ledger).
set -u
THRESHOLD=${THRESHOLD:-85}
CRITICAL=${CRITICAL:-95}
SOL_LEDGER=${SOL_LEDGER:-$HOME/.edgebounty-sol-ledger-20261015}
LOG=$HOME/disk-watchdog.log

used() { df --output=pcent / | tail -1 | tr -dc '0-9'; }
say() {
  echo "$(date -u +%FT%TZ) $*" >> "$LOG"
  logger -t disk-watchdog "$*"
}

before=$(used)
[ "$before" -lt "$THRESHOLD" ] && exit 0

say "WARNING disk at ${before}% (threshold ${THRESHOLD}%), cleaning"

# 1. Validator text logs (validator-<ts>.log), keeping the one validator.log points at.
current=$(readlink "$SOL_LEDGER/validator.log" 2>/dev/null || true)
find "$SOL_LEDGER" -maxdepth 1 -name 'validator-*.log' ! -name "${current:-none}" -delete 2>/dev/null
[ -n "$current" ] && : > "$SOL_LEDGER/$current"

# 2. PM2: drop rotated copies, truncate any live log above 50 MB.
find "$HOME/.pm2/logs" -name '*__*.log*' -delete 2>/dev/null
find "$HOME/.pm2/logs" -name '*.log' -size +50M -exec truncate -s 0 {} + 2>/dev/null

# 3. System caches and journal.
sudo -n apt-get clean >/dev/null 2>&1
sudo -n journalctl --vacuum-size=100M >/dev/null 2>&1
rm -rf "$HOME/.npm/_cacache" 2>/dev/null

after=$(used)
if [ "$after" -ge "$CRITICAL" ]; then
  say "CRITICAL disk still at ${after}% after cleanup (was ${before}%). Chain data is likely the cause: grow the EBS volume."
else
  say "cleaned: ${before}% -> ${after}%"
fi
