# Database migrations: safety, rehearsal, backup and restore

Everything below marked **executed** was run against a real PostgreSQL 16 in the build environment (not the native Prisma engine; see `OPERATIONS_SECURITY.md` §17).

## Rules

1. Migrations are forward-only. Roll back by restoring a backup.
2. Back up and rehearse on a restored copy before every production migration.
3. Never edit a migration that has shipped; `prisma/SHIPPED_MIGRATIONS.sha256` and a test enforce it. `20261031000000` had been edited in an earlier remediation build; it is restored to the original and the fix now lives in the corrective migration `20261102000000` plus `scripts/pre-migrate-archive-duplicate-pull-requests.sql`. Install and upgrade procedures: `DEPLOYMENT.md` §2a.

## Pre-flight (read-only)

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/scripts/db-preflight.sql     # or: cd server && npm run db:preflight
DATABASE_URL=... server/scripts/migration-checksum-check.sh                  # which text of each migration the database applied
```
Pre-flight reports duplicate `PullRequest` groups, plaintext/legacy/v1 token counts, `RepairJob` statuses, table sizes and applied migrations; **executed** on a populated old-schema database (found the seeded duplicate group and the plaintext token). The checksum script was **executed** against two synthetic migration histories and correctly reported `applied ORIGINAL text` versus `MISMATCH … applied EDITED variant`.

## Backup and restore (executed)

```bash
pg_dump -Fc -f repodoctor.dump "$DATABASE_URL"
createdb repodoctor_rehearsal
pg_restore --exit-on-error -d repodoctor_rehearsal repodoctor.dump
# verify row counts match, then rehearse the migration on the copy:
DATABASE_URL=postgresql://.../repodoctor_rehearsal npx prisma migrate deploy
```
**Executed** (earlier build): dump → restore into a fresh database → identical row counts → migrations applied to the restored copy. That rehearsal used the previously edited migration; the equivalent paths for the restored original are now covered by `migration-upgrade.test.ts`. The dump/restore commands themselves are unchanged.

## What the tests prove (`server/src/tests/migration-upgrade.test.ts`, `db-lifecycle.test.ts`)

- Immutability: every originally shipped migration matches its pinned sha256; the restored 20261031 contains no archive logic; the corrective migration sorts last.
- Five install paths on real PostgreSQL: fresh; upgrade without duplicates; duplicates **without** the pre-deploy script (original migration fails atomically, no row lost, nothing half-applied); duplicates **with** it (earliest kept, rest archived, idempotent, then all migrations apply); already applied with the original text; already applied with the edited variant (corrective migration is a no-op, archived rows survive).
- Unique constraint enforced afterwards; users/tokens/audit rows preserved.
- `PUBLISHED` → `COMPLETED`; unbound `APPROVED` → `AWAITING_APPROVAL`.
- Audit table is append-only (UPDATE always rejected; DELETE rejected under 365 days, allowed beyond).
- Fresh database: all migrations apply in order; a failing migration leaves nothing behind.
- Schema/database agreement: every model column exists in the migrated database and vice versa (a stand-in for `prisma migrate diff`, which could not run here; CI runs the real one).
- Retention and deletion remove every dependent row (including string-keyed tables), are scoped to the owner, are idempotent, and protect repairs awaiting the owner; concurrent deletes and concurrent claims have exactly one winner.

## Not done here

`prisma migrate deploy` and `prisma migrate diff` (engine download blocked): run them in CI (`migrations` job) and in staging before production.
