#!/bin/sh
# scripts/restore-drill-from-b2.sh
#
# Pulls the most recent backup actually sitting in B2 (not the local
# /app/backups copy, which only proves the backup step + local disk are
# fine) and runs restore-drill.mjs against it - the whole point is
# verifying the thing that would actually be reached for in a real
# outage: the off-box copy, after it has genuinely round-tripped through
# rclone/B2. Safe to run on the same schedule/container as
# backup-and-push.sh (Coolify Scheduled Task) - restore-drill.mjs never
# touches DB_FILE or the live database, only a throwaway scratch copy.
#
# Same REMOTE_PATH construction as backup-and-push.sh (MULTI_TENANT ->
# saas/standalone) - deliberately not shared as a third file, since both
# scripts are already this short and a shared file would add more
# indirection than it'd save.
set -e

if [ "$MULTI_TENANT" = "true" ]; then
  REMOTE_MODE="saas"
else
  REMOTE_MODE="standalone"
fi

REMOTE_PATH=":b2,account=$blazeKeyID,key=$blazeLicenseServerAppKey:licenseServer/console/$REMOTE_MODE/"

# Only bare .db files - the -shm/-wal sidecars occasionally present
# alongside a backup (created transiently by backup-db.mjs's own verify
# step, see that script's header) aren't needed to restore a backup that
# was itself produced by better-sqlite3's online backup API, and aren't
# useful to fetch here. Filenames are ISO-8601 timestamped
# (console-<timestamp>.db), so a plain sort is chronological.
LATEST=$(rclone lsf --files-only "$REMOTE_PATH" | grep '\.db$' | sort | tail -1)
if [ -z "$LATEST" ]; then
  echo "No backups found at $REMOTE_PATH" >&2
  exit 1
fi

FETCH_DIR=$(mktemp -d)
trap 'rm -rf "$FETCH_DIR"' EXIT

echo "Fetching $LATEST from B2 for restore drill..."
rclone copyto "${REMOTE_PATH}${LATEST}" "$FETCH_DIR/$LATEST"

node scripts/restore-drill.mjs "$FETCH_DIR/$LATEST"
