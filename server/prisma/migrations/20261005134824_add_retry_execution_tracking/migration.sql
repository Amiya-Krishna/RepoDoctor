-- CreateTable
CREATE TABLE "DockerTestRun" (
    "id" TEXT NOT NULL,
    "repositoryPath" TEXT NOT NULL,
    "testCommand" JSONB NOT NULL,
    "success" BOOLEAN NOT NULL,
    "exitCode" INTEGER,
    "stdout" TEXT NOT NULL,
    "stderr" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "timedOut" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DockerTestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairAttempt" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "fixProposalId" TEXT,
    "dockerTestRunId" TEXT,
    "verificationResultId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DockerTestRun_success_idx" ON "DockerTestRun"("success");

-- CreateIndex
CREATE INDEX "DockerTestRun_timedOut_idx" ON "DockerTestRun"("timedOut");

-- CreateIndex
CREATE INDEX "RepairAttempt_analysisId_idx" ON "RepairAttempt"("analysisId");

-- CreateIndex
CREATE INDEX "RepairAttempt_findingId_idx" ON "RepairAttempt"("findingId");

-- CreateIndex
CREATE INDEX "RepairAttempt_attemptNumber_idx" ON "RepairAttempt"("attemptNumber");

-- CreateIndex
CREATE INDEX "RepairAttempt_status_idx" ON "RepairAttempt"("status");
