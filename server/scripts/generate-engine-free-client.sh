#!/usr/bin/env bash
# Generates a Prisma Client that needs NO native query-engine download, for
# environments where binaries.prisma.sh is unreachable (air-gapped CI, sandboxes).
#
# The client uses the pure-JS PostgreSQL driver adapter. Enable it at runtime with
# PRISMA_DRIVER_ADAPTER=pg (see src/config/prisma.ts). Production images keep using
# the normal `prisma generate`; this script is only for tests in restricted networks.
#
# Limitation: `prisma migrate` still needs the schema engine, which cannot be fetched
# either. Apply migrations with the test helper (src/tests/db.ts) or psql instead.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .local-prisma
sed 's/provider = "prisma-client-js"/provider = "prisma-client-js"\n  previewFeatures = ["queryCompiler", "driverAdapters"]\n  engineType = "client"/' \
  prisma/schema.prisma > .local-prisma/schema.prisma
# `generate` only needs the engine files to exist, not to run; the placeholders are never executed
# because engineType = "client" has no native engine.
PRISMA_SCHEMA_ENGINE_BINARY=/bin/true PRISMA_QUERY_ENGINE_LIBRARY=/bin/true PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 \
  npx prisma generate --schema .local-prisma/schema.prisma
