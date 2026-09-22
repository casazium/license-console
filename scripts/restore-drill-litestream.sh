#!/bin/sh
# scripts/restore-drill-litestream.sh
#
# Litestream-specific restore drill (TASK_LITESTREAM_HA.md's own "what
# done looks like" requirement). scripts/restore-drill.mjs and
# scripts/restore-drill-from-b2.sh only ever exercise the daily-snapshot
# path (backup-db.mjs -> rclone -> B2) and would never catch a regression
# specific to Litestream's own replication/restore mechanism - a
# completely separate code path with its own config, credentials, and
# on-disk format. This script is that missing verification: a real
# `litestream restore` against the actual configured replica destination,
# into a throwaway scratch location that never touches DB_FILE or the
# live database, handed off to restore-drill.mjs's existing
# integrity/row-count/migration checks afterward rather than duplicating
# them. Mirrors casazium/license's own restore-drill-litestream.sh, with
# the two-way (not three-way) mode branch and .mjs invocation this repo
# already uses elsewhere.
#
# Safe to run on the live host as its own Coolify Scheduled Task, same
# posture as restore-drill-from-b2.sh - read-only against the replica,
# never writes to DB_FILE.
#
# Only meaningful when Litestream is actually enabled - running this on a
# deployment that never set LITESTREAM_REPLICA_BUCKET has nothing to
# drill against and exits with a clear error rather than a confusing
# litestream error about a missing/empty config.
set -e

if [ -z "$LITESTREAM_REPLICA_BUCKET" ]; then
  echo "LITESTREAM_REPLICA_BUCKET is not set on this deployment - Litestream replication isn't enabled, so there's nothing to drill. See DEPLOYMENT.md's Litestream section to enable it first." >&2
  exit 1
fi

# Same derivation as scripts/start.sh and scripts/backup-and-push.sh -
# kept in sync by hand across all three, following this repo's own
# restore-drill-from-b2.sh precedent for not extracting a short branch
# into a shared file.
if [ "$MULTI_TENANT" = "true" ]; then
  export LITESTREAM_REPLICA_MODE="saas"
else
  export LITESTREAM_REPLICA_MODE="standalone"
fi

SCRATCH_DIR=$(mktemp -d)
trap 'rm -rf "$SCRATCH_DIR"' EXIT
SCRATCH_DB="$SCRATCH_DIR/litestream-restore-test.db"

echo "Restoring from the real Litestream replica (bucket=$LITESTREAM_REPLICA_BUCKET, mode=$LITESTREAM_REPLICA_MODE) -> $SCRATCH_DB (scratch copy; live DB is never touched)..."
litestream restore -config /app/litestream.yml -o "$SCRATCH_DB" "$DB_FILE"

node scripts/restore-drill.mjs "$SCRATCH_DB"
