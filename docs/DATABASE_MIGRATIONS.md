# Database migrations: safety, rehearsal, backup and restore

The procedures below are covered by integration tests against a real PostgreSQL 16 (`server/src/tests/migration-upgrade.test.ts`, `db-lifecycle.test.ts`).

## Rules

1. Migrations are forward-only. Roll back by restoring a backup.
2. Back up and rehearse on a restored copy before every production migration.
3. Never edit a migration that has shipped; `prisma/SHIPPED_MIGRATIONS.sha256` and a test enforce it. The pull request de-duplication fix lives in the corrective migration `20261102000000` plus `scripts/pre-migrate-archive-duplicate-pull-requests.sql`; `20261031000000` stays in its original form. Install and upgrade procedures: `DEPLOYMENT.md` §2a.
4. Migration files are hashed byte for byte (by Prisma and by the manifest), so line endings matter. The root `.gitattributes` marks `migration.sql` files as `-text` so git never converts them; do not re-save a shipped migration with different line endings. After adding that attribute to an existing clone, run `git add --renormalize server/prisma/migrations`.

## Pre-flight (read-only)

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/scripts/db-preflight.sql     # or: cd server && npm run db:preflight
DATABASE_URL=... server/scripts/migration-checksum-check.sh                  # which text of each migration the database applied
```
Pre-flight reports duplicate `PullRequest` groups, plaintext/legacy/v1 token counts, `RepairJob` statuses, table sizes and applied migrations; tested on a populated old-schema database (it finds duplicate groups and plaintext tokens). The checksum script reports `applied ORIGINAL text` or `MISMATCH … applied EDITED variant` for each migration; the edited variant is kept in `docs/migration-variants/` so the upgrade path from it stays tested.

## Backup and restore

```bash
pg_dump -Fc -f repodoctor.dump "$DATABASE_URL"
createdb repodoctor_rehearsal
pg_restore --exit-on-error -d repodoctor_rehearsal repodoctor.dump
# verify row counts match, then rehearse the migration on the copy:
DATABASE_URL=postgresql://.../repodoctor_rehearsal npx prisma migrate deploy
```
After the restore, row counts should match the source database before you rehearse the migration.

## What the tests prove (`server/src/tests/migration-upgrade.test.ts`, `db-lifecycle.test.ts`)

- Immutability: every originally shipped migration matches its pinned sha256; the restored 20261031 contains no archive logic; the corrective migration sorts last.
- Five install paths on real PostgreSQL: fresh; upgrade without duplicates; duplicates **without** the pre-deploy script (original migration fails atomically, no row lost, nothing half-applied); duplicates **with** it (earliest kept, rest archived, idempotent, then all migrations apply); already applied with the original text; already applied with the edited variant (corrective migration is a no-op, archived rows survive).
- Unique constraint enforced afterwards; users/tokens/audit rows preserved.
- `PUBLISHED` → `COMPLETED`; unbound `APPROVED` → `AWAITING_APPROVAL`.
- Audit table is append-only (UPDATE always rejected; DELETE rejected under 365 days, allowed beyond).
- Fresh database: all migrations apply in order; a failing migration leaves nothing behind.
- Schema/database agreement: every model column exists in the migrated database and vice versa (a lightweight stand-in for `prisma migrate diff`; CI runs the real one).
- Retention and deletion remove every dependent row (including string-keyed tables), are scoped to the owner, are idempotent, and protect repairs awaiting the owner; concurrent deletes and concurrent claims have exactly one winner.

## Also run in CI

`prisma migrate deploy` and `prisma migrate diff` run in the CI `migrations` job; run them again against a restored copy in staging before production.
