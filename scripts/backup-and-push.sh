#!/bin/sh
# scripts/backup-and-push.sh
#
# Wraps backup-db.mjs + the off-box push to B2 in a real script file
# rather than an inline Coolify Scheduled Task command - kept as a
# script even though the original reason for switching to one turned
# out to be a red herring. What actually happened: `rclone copy` prints
# nothing at all on a clean, successful run, and Coolify's Scheduled
# Task log only ever showed output during the earlier *failed* attempts
# (rclone's own NOTICE/CRITICAL lines) - once the B2 credentials were
# fixed, rclone started succeeding silently, which looked identical to
# "never ran" in a log that had only ever shown failure output.
# Confirmed directly against the B2 bucket contents, not just inferred.
# Keeping this as a real file anyway - it's a cleaner pattern than an
# inline chained command regardless of the actual root cause.
#
# Destination path distinguishes standalone from SaaS-tier - both run
# from this same image/script, and without this, backups from both
# instances would land in the same bucket path with only a timestamp to
# tell them apart, a real risk if a restore ever needs to target the
# right instance. Reuses MULTI_TENANT rather than a new variable - it's
# already set correctly and differently on this repo's two resources,
# so no new per-resource Coolify configuration is needed.
#
# Retention: backup-db.mjs already prunes anything older than
# BACKUP_RETENTION_DAYS (default 14) from the LOCAL /app/backups folder,
# but nothing pruned what had already been pushed to B2 - remote storage
# would otherwise grow forever, one snapshot per scheduled run,
# indefinitely (confirmed as a real, not hypothetical, problem - a single
# afternoon of manual debugging runs alone produced 6). Reuses the same
# BACKUP_RETENTION_DAYS variable rather than a second one, so local and
# remote retention can never drift out of sync with each other. Runs
# after the push, not before, so an interrupted run never leaves the
# remote with zero backups.
set -e

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

if [ "$MULTI_TENANT" = "true" ]; then
  REMOTE_MODE="saas"
else
  REMOTE_MODE="standalone"
fi

REMOTE_PATH=":b2,account=$blazeKeyID,key=$blazeLicenseServerAppKey:licenseServer/console/$REMOTE_MODE/"

node scripts/backup-db.mjs
rclone copy /app/backups "$REMOTE_PATH"
rclone delete "$REMOTE_PATH" --min-age "${RETENTION_DAYS}d"
