-- RUN BEFORE `prisma migrate deploy` ONLY on an installation that has NOT yet applied migration
-- 20261031000000_privacy_security_hardening AND whose pre-flight (db-preflight.sql) reports duplicate pull requests.
-- That migration creates a unique index on "PullRequest"(analysisId, findingId) and cannot succeed while duplicates exist.
-- This script keeps the EARLIEST row per (analysisId, findingId) (createdAt, then id) and copies every other row to
-- "PullRequestDuplicateArchive" before removing it. Nothing is discarded. One transaction: all or nothing. Idempotent.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/pre-migrate-archive-duplicate-pull-requests.sql
BEGIN;
CREATE TABLE IF NOT EXISTS "PullRequestDuplicateArchive" (
    "id" TEXT NOT NULL, "analysisId" TEXT NOT NULL, "findingId" TEXT NOT NULL, "fixProposalId" TEXT NOT NULL,
    "verificationResultId" TEXT NOT NULL, "repositoryOwner" TEXT NOT NULL, "repositoryName" TEXT NOT NULL,
    "branchName" TEXT NOT NULL, "baseBranch" TEXT NOT NULL, "commitSha" TEXT NOT NULL, "pullRequestNumber" INTEGER NOT NULL,
    "pullRequestUrl" TEXT NOT NULL, "title" TEXT NOT NULL, "status" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL,
    "keptPullRequestId" TEXT NOT NULL, "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reason" TEXT NOT NULL,
    CONSTRAINT "PullRequestDuplicateArchive_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PullRequestDuplicateArchive_analysisId_findingId_idx" ON "PullRequestDuplicateArchive"("analysisId", "findingId");
CREATE INDEX IF NOT EXISTS "PullRequestDuplicateArchive_keptPullRequestId_idx" ON "PullRequestDuplicateArchive"("keptPullRequestId");

WITH ranked AS (
    SELECT pr.*,
           ROW_NUMBER() OVER (PARTITION BY pr."analysisId", pr."findingId" ORDER BY pr."createdAt" ASC, pr."id" ASC) AS rn,
           FIRST_VALUE(pr."id") OVER (PARTITION BY pr."analysisId", pr."findingId" ORDER BY pr."createdAt" ASC, pr."id" ASC) AS kept_id
    FROM "PullRequest" pr
), archived AS (
    INSERT INTO "PullRequestDuplicateArchive" (
        "id","analysisId","findingId","fixProposalId","verificationResultId","repositoryOwner","repositoryName",
        "branchName","baseBranch","commitSha","pullRequestNumber","pullRequestUrl","title","status","createdAt","keptPullRequestId","reason")
    SELECT r."id", r."analysisId", r."findingId", r."fixProposalId", r."verificationResultId", r."repositoryOwner", r."repositoryName",
           r."branchName", r."baseBranch", r."commitSha", r."pullRequestNumber", r."pullRequestUrl", r."title", r."status", r."createdAt",
           r.kept_id, 'duplicate (analysisId, findingId); earliest createdAt (then lowest id) kept'
    FROM ranked r WHERE r.rn > 1
    ON CONFLICT ("id") DO NOTHING
    RETURNING "id"
)
DELETE FROM "PullRequest" WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);
COMMIT;
