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
# The live mock-USDC validator (added 2026-10-18 after its text logs filled the disk again).
USDC_LEDGER=${USDC_LEDGER:-$HOME/.edgebounty-usdc-20261017}
LOG=$HOME/disk-watchdog.log

used() { df --output=pcent / | tail -1 | tr -dc '0-9'; }
say() {
  echo "$(date -u +%FT%TZ) $*" >> "$LOG"
  logger -t disk-watchdog "$*"
}

# 0. The test validator's RocksDB never deletes its write-ahead logs (rocksdb/*.log) while it runs:
#    ~90 MB/minute of them piled up on 2026-10-18 even though old slots were purged. A restart flushes
#    them (3.6 GB -> 0.6 GB, chain back in ~8 s), so restart once they pass WAL_LIMIT_MB.
WAL_LIMIT_MB=${WAL_LIMIT_MB:-8192}
wal_mb=$(du -cm "$USDC_LEDGER"/rocksdb/*.log 2>/dev/null | tail -1 | cut -f1)
if [ "${wal_mb:-0}" -gt "$WAL_LIMIT_MB" ]; then
  say "validator RocksDB WAL at ${wal_mb} MB (limit ${WAL_LIMIT_MB} MB): restarting validator-usdc"
  /usr/bin/pm2 restart validator-usdc >/dev/null 2>&1 || say "ERROR pm2 restart validator-usdc failed"
fi

before=$(used)
[ "$before" -lt "$THRESHOLD" ] && exit 0

say "WARNING disk at ${before}% (threshold ${THRESHOLD}%), cleaning"

# 1. Validator text logs (validator-<ts>.log) in each ledger: delete old ones and empty the newest
#    (truncating frees space even while the validator still holds the file open).
for ledger in "$SOL_LEDGER" "$USDC_LEDGER"; do
  [ -d "$ledger" ] || continue
  current=$(readlink "$ledger/validator.log" 2>/dev/null || ls -t "$ledger"/validator-*.log 2>/dev/null | head -1 | xargs -r basename)
  find "$ledger" -maxdepth 1 -name 'validator-*.log' ! -name "${current:-none}" -delete 2>/dev/null
  [ -n "$current" ] && : > "$ledger/$current"
done

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
