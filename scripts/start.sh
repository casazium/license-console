#!/bin/sh
# scripts/start.sh
#
# The container's real CMD (see Dockerfile) - a thin wrapper whose only job
# is the on/off branch for optional Litestream continuous replication
# (TASK_LITESTREAM_HA.md), decided BEFORE litestream is ever invoked.
# Mirrors casazium/license's own scripts/start.sh (same reasoning, same
# structure) with the one real difference that repo's design doc already
# called out: this repo's Dockerfile had no shell wrapper before this file
# existed (`CMD ["node", "server.js"]` execs the standalone server
# directly), so the resulting chain here is two layers
# (start.sh -> litestream replicate -exec "node server.js"), not three -
# there's no separate docker-entrypoint.js underneath to preserve.
#
# This ordering matters: litestream's own S3 replica validates its config
# before launching an `-exec`'d process, so if the on/off decision were
# left to litestream's own config validation instead, an empty/unset
# LITESTREAM_REPLICA_BUCKET would fail the ENTIRE CONTAINER to start - not
# "replication is skipped," but "the console never boots," for every
# self-hosted deployment that exists today, none of which opt into this.
# Putting the branch here, ahead of litestream entirely, is the fix: the
# unset case (every deployment except the SaaS-tier resource) execs
# directly into the exact same command this repo ran before this file
# existed.
set -e

if [ -z "$LITESTREAM_REPLICA_BUCKET" ]; then
  exec node server.js
fi

# Derive the replica path the same way scripts/backup-and-push.sh already
# derives its own B2 destination for the daily snapshot pipeline
# (MULTI_TENANT=true -> saas, else standalone) - never hand-set. A
# hand-set LITESTREAM_REPLICA_PATH was reproduced live, in
# casazium/license, silently destroying two unrelated databases' recovery
# data when they collided on the same replica path (litestream's own
# checkDatabaseBehindReplica logic treats "replica has newer data" as
# "adopt it," correct for restoring a fresh node, actively destructive for
# two databases sharing a path by accident). Only a two-way branch here,
# not that repo's three-way mls/saas/standalone one - this repo has no
# MLS-equivalent concept (TASK_LITESTREAM_HA.md). Kept in sync by hand
# with backup-and-push.sh's own branch, following this repo's existing
# restore-drill-from-b2.sh precedent for not extracting a short branch
# into a third shared file.
if [ "$MULTI_TENANT" = "true" ]; then
  export LITESTREAM_REPLICA_MODE="saas"
else
  export LITESTREAM_REPLICA_MODE="standalone"
fi

# Boot-time reachability/auth check against the configured replica
# destination. Operator-decided default (TASK_LITESTREAM_HA.md): log
# loudly and CONTINUE BOOTING on failure - never refuse to start. A backup-
# configuration problem must never be able to take down this console; this
# subsystem is a backup layer alongside an already-durable primary (the
# existing daily snapshot pipeline), not something this app cannot safely
# run without.
#
# `-if-replica-exists` is what makes this safe to run on a genuinely first
# boot (no snapshot has ever been written yet): it exits 0 with "no
# matching backups found" against an empty-but-reachable destination, and
# only exits nonzero against a destination that's actually broken (bad
# credentials, deleted bucket, unreachable endpoint, malformed config) -
# the exact distinction a boot-time check needs. Note this check exercises
# read/list access, not write access - a read-only credential would pass
# here but still fail to actually replicate; ongoing observability (see
# DEPLOYMENT.md) is what catches that case, not this check.
LITESTREAM_BOOT_CHECK_DB="/tmp/.litestream-boot-check.db"
LITESTREAM_BOOT_CHECK_LOG="/tmp/.litestream-boot-check.log"
rm -f "$LITESTREAM_BOOT_CHECK_DB" "$LITESTREAM_BOOT_CHECK_LOG"
if litestream restore -config /app/litestream.yml -if-replica-exists \
    -o "$LITESTREAM_BOOT_CHECK_DB" "$DB_FILE" >"$LITESTREAM_BOOT_CHECK_LOG" 2>&1; then
  echo "litestream: replica destination reachable (bucket=$LITESTREAM_REPLICA_BUCKET, mode=$LITESTREAM_REPLICA_MODE)"
else
  echo "litestream: WARNING - replica destination unreachable or misconfigured (bucket=$LITESTREAM_REPLICA_BUCKET, mode=$LITESTREAM_REPLICA_MODE) - continuing boot anyway, since this only affects the optional backup layer, not the console itself. Details:"
  cat "$LITESTREAM_BOOT_CHECK_LOG"
fi
rm -f "$LITESTREAM_BOOT_CHECK_DB" "$LITESTREAM_BOOT_CHECK_LOG"

exec litestream replicate -config /app/litestream.yml -exec "node server.js"
