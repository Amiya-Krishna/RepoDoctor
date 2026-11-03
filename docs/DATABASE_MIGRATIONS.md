# Database migrations: safety, rehearsal, backup and restore

Everything below marked **executed** was run against a real PostgreSQL 16 in the build environment (not the native Prisma engine; see `OPERATIONS_SECURITY.md` §17).

## Rules

1. Migrations are forward-only. Roll back by restoring a backup.
2. Back up and rehearse on a restored copy before every production migration.
3. Never edit a migration that has shipped. (`20261031000000_privacy_security_hardening` was edited once because its original form fails on data with duplicate pull requests; see the caveat in `DEPLOYMENT.md` §2a.)

## Pre-flight (read-only)

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/scripts/db-preflight.sql     # or: cd server && npm run db:preflight
```
Reports duplicate `PullRequest` groups, plaintext/legacy/v1 token counts, `RepairJob` statuses, table sizes and applied migrations. **Executed** on a populated old-schema database: it found the seeded duplicate group and the plaintext token.

## Backup and restore (executed)

```bash
pg_dump -Fc -f repodoctor.dump "$DATABASE_URL"
createdb repodoctor_rehearsal
pg_restore --exit-on-error -d repodoctor_rehearsal repodoctor.dump
# verify row counts match, then rehearse the migration on the copy:
DATABASE_URL=postgresql://.../repodoctor_rehearsal npx prisma migrate deploy
```
**Executed:** dump → restore into a fresh database → identical row counts (1 user, 2 pull requests, 1 analysis) → the two new migrations applied to the restored copy → 2 pull requests became 1 kept + 1 archived.

## What the tests prove (`server/src/tests/migration-upgrade.test.ts`, `db-lifecycle.test.ts`)

- The unique index alone fails on duplicate pull requests (the failure the old migration would have hit).
- Upgrading a populated old-schema database: duplicates archived with the kept row id and a reason, newest kept, unrelated rows untouched, every row either kept or archived, unique constraint enforced afterwards, users/tokens/audit rows preserved.
- `PUBLISHED` → `COMPLETED`; unbound `APPROVED` → `AWAITING_APPROVAL`.
- Audit table is append-only (UPDATE always rejected; DELETE rejected under 365 days, allowed beyond).
- Fresh database: all migrations apply in order; a failing migration leaves nothing behind.
- Schema/database agreement: every model column exists in the migrated database and vice versa (a stand-in for `prisma migrate diff`, which could not run here; CI runs the real one).
- Retention and deletion remove every dependent row (including string-keyed tables), are scoped to the owner, are idempotent, and protect repairs awaiting the owner; concurrent deletes and concurrent claims have exactly one winner.

## Not done here

`prisma migrate deploy` and `prisma migrate diff` (engine download blocked): run them in CI (`migrations` job) and in staging before production.
