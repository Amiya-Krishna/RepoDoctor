-- Corrective migration (forward-only; no earlier migration was edited).
--
-- "PullRequestDuplicateArchive" holds pull-request rows that were set aside when an existing installation
-- contained several rows for one (analysisId, findingId) before the unique index could be created.
-- Installations that needed that step ran scripts/pre-migrate-archive-duplicate-pull-requests.sql BEFORE
-- migration 20261031000000. This migration only guarantees the table exists everywhere, and is idempotent:
-- it does nothing where the table was already created by that script.
CREATE TABLE IF NOT EXISTS "PullRequestDuplicateArchive" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "fixProposalId" TEXT NOT NULL,
    "verificationResultId" TEXT NOT NULL,
    "repositoryOwner" TEXT NOT NULL,
    "repositoryName" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "pullRequestNumber" INTEGER NOT NULL,
    "pullRequestUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "keptPullRequestId" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,

    CONSTRAINT "PullRequestDuplicateArchive_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PullRequestDuplicateArchive_analysisId_findingId_idx" ON "PullRequestDuplicateArchive"("analysisId", "findingId");
CREATE INDEX IF NOT EXISTS "PullRequestDuplicateArchive_keptPullRequestId_idx" ON "PullRequestDuplicateArchive"("keptPullRequestId");
