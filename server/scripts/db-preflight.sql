-- Read-only pre-flight for the privacy/reliability migrations. Run BEFORE `prisma migrate deploy`:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/db-preflight.sql
-- It changes nothing. Review every result. "duplicate_pull_requests" > 0 means migration 20261031000000 WILL FAIL
-- (atomically) unless you first run scripts/pre-migrate-archive-duplicate-pull-requests.sql, which keeps the EARLIEST
-- row per (analysisId, findingId) and archives the rest. Skip that only if 20261031000000 is already applied.
\echo '== duplicate PullRequest rows per (analysisId, findingId)'
SELECT count(*) AS duplicate_groups, coalesce(sum(n - 1), 0) AS duplicate_pull_requests
FROM (SELECT count(*) AS n FROM "PullRequest" GROUP BY "analysisId", "findingId" HAVING count(*) > 1) d;

\echo '== plaintext GitHub tokens (must be migrated with: npm run tokens:migrate -- --i-have-a-backup)'
SELECT count(*) FILTER (WHERE "githubAccessToken" IS NOT NULL AND "githubAccessToken" NOT LIKE 'v1:%' AND "githubAccessToken" NOT LIKE '%.%.%') AS plaintext_tokens,
       count(*) FILTER (WHERE "githubAccessToken" LIKE '%.%.%' AND "githubAccessToken" NOT LIKE 'v1:%') AS legacy_gcm_tokens,
       count(*) FILTER (WHERE "githubAccessToken" LIKE 'v1:%') AS v1_tokens
FROM users;

\echo '== RepairJob rows by status (APPROVED rows will be reset to AWAITING_APPROVAL; PUBLISHED becomes COMPLETED)'
SELECT status, count(*) FROM "RepairJob" GROUP BY status ORDER BY status;

\echo '== table sizes'
SELECT relname AS table, pg_size_pretty(pg_total_relation_size(c.oid)) AS size
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 10;

\echo '== applied migrations'
SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations ORDER BY started_at;
