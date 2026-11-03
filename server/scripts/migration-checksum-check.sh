#!/usr/bin/env bash
# Read-only. Shows, for every migration recorded in the target database, whether the recorded checksum matches the file in
# this checkout, and for 20261031000000 whether the database applied the ORIGINAL text or the EDITED variant that circulated
# in an earlier remediation build. Prisma's checksum is the sha256 (hex) of migration.sql.
#   DATABASE_URL=postgresql://... ./scripts/migration-checksum-check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?set DATABASE_URL}"
EDITED_VARIANT=../docs/migration-variants/20261031_privacy_security_hardening.EDITED-VARIANT.sql
ORIGINAL=$(grep ' 20261031000000_privacy_security_hardening$' prisma/SHIPPED_MIGRATIONS.sha256 | cut -d' ' -f1)
EDITED=$(sha256sum "$EDITED_VARIANT" | cut -d' ' -f1)
echo "original 20261031000000 sha256: $ORIGINAL"; echo "edited-variant sha256:          $EDITED"
psql "$DATABASE_URL" -At -F'|' -v ON_ERROR_STOP=1 -c 'SELECT migration_name, checksum, finished_at IS NOT NULL, rolled_back_at IS NOT NULL FROM _prisma_migrations ORDER BY started_at' |
while IFS='|' read -r name sum finished rolled; do
  file="prisma/migrations/$name/migration.sql"; local_sum=$( [ -f "$file" ] && sha256sum "$file" | cut -d' ' -f1 || echo MISSING-IN-CHECKOUT )
  verdict=OK; [ "$sum" = "$local_sum" ] || verdict=MISMATCH
  note=""; if [ "$name" = 20261031000000_privacy_security_hardening ]; then
    [ "$sum" = "$ORIGINAL" ] && note="applied ORIGINAL text"; [ "$sum" = "$EDITED" ] && note="applied EDITED variant (see docs/DEPLOYMENT.md 2a)"; fi
  echo "$verdict  $name  finished=$finished rolled_back=$rolled  $note"
done
