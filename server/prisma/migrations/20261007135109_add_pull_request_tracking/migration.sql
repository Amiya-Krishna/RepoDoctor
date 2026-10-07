-- CreateTable
CREATE TABLE "PullRequest" (
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
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PullRequest_analysisId_idx" ON "PullRequest"("analysisId");

-- CreateIndex
CREATE INDEX "PullRequest_findingId_idx" ON "PullRequest"("findingId");

-- CreateIndex
CREATE INDEX "PullRequest_fixProposalId_idx" ON "PullRequest"("fixProposalId");

-- CreateIndex
CREATE INDEX "PullRequest_verificationResultId_idx" ON "PullRequest"("verificationResultId");

-- CreateIndex
CREATE INDEX "PullRequest_status_idx" ON "PullRequest"("status");

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
