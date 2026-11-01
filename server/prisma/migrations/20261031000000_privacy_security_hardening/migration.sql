-- Privacy settings (default NONE: no code is sent to any LLM until the user opts in)
CREATE TABLE "PrivacySettings" (
    "userId" TEXT NOT NULL,
    "dataMode" TEXT NOT NULL DEFAULT 'NONE',
    "consentVersion" INTEGER,
    "consentedAt" TIMESTAMP(3),
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "notifyOnCritical" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrivacySettings_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "PrivacySettings" ADD CONSTRAINT "PrivacySettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Webhook replay protection
CREATE TABLE "WebhookDelivery" (
    "deliveryId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("deliveryId")
);
CREATE INDEX "WebhookDelivery_receivedAt_idx" ON "WebhookDelivery"("receivedAt");

-- Notifications
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "repositoryId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Repository: a GitHub repository may be connected by several users; each gets an isolated row.
DROP INDEX "Repository_githubId_key";
CREATE UNIQUE INDEX "Repository_userId_githubId_key" ON "Repository"("userId", "githubId");
CREATE INDEX "Repository_githubId_idx" ON "Repository"("githubId");
ALTER TABLE "Repository" ADD COLUMN "autoScan" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Repository" ADD COLUMN "lastScheduledScanAt" TIMESTAMP(3);

-- Docker run evidence can be tied to an analysis so retention/deletion can reach it
ALTER TABLE "DockerTestRun" ADD COLUMN "analysisId" TEXT;
CREATE INDEX "DockerTestRun_analysisId_idx" ON "DockerTestRun"("analysisId");

-- At most one pull request per finding
CREATE UNIQUE INDEX "PullRequest_analysisId_findingId_key" ON "PullRequest"("analysisId", "findingId");

-- Repair approval gate
ALTER TABLE "RepairJob" ADD COLUMN "fixProposalId" TEXT;
ALTER TABLE "RepairJob" ADD COLUMN "verificationResultId" TEXT;
ALTER TABLE "RepairJob" ADD COLUMN "testCommand" JSONB;
ALTER TABLE "RepairJob" ADD COLUMN "workingDirectory" TEXT;
ALTER TABLE "RepairJob" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "RepairJob" ADD COLUMN "approvedBy" TEXT;
ALTER TABLE "RepairJob" ADD COLUMN "pullRequestUrl" TEXT;

-- Deletion controls: repair history must be deletable with the analysis
ALTER TABLE "RepairJob" DROP CONSTRAINT "RepairJob_analysisId_fkey";
ALTER TABLE "RepairJob" ADD CONSTRAINT "RepairJob_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
