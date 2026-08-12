#!/bin/sh
# scripts/backup-and-push.sh
#
# Wraps backup-db.mjs + the off-box push to B2 in a real script file
# rather than an inline Coolify Scheduled Task command. After repeated
# failures getting Coolify to correctly execute a `&&`-chained, quoted
# inline command (rclone never actually ran - no trace at all in the
# task log, not even its own unconditional startup NOTICE line, even
# after explicitly wrapping the whole thing in `sh -c "..."`), the
# robust fix is to remove Coolify's own command-field parsing from the
# equation entirely: the Scheduled Task's command becomes just
# `sh scripts/backup-and-push.sh`, with no shell operators or quoting
# left in that field for any wrapping layer to mishandle.
set -e

node scripts/backup-db.mjs
rclone copy /app/backups ":b2,account=$blazeKeyID,key=$blazeLicenseServerAppKey:licenseServer/console/"
