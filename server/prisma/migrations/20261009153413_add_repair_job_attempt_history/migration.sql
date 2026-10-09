-- CreateTable
CREATE TABLE "RepairJobAttempt" (
    "id" TEXT NOT NULL,
    "repairJobId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "testPassed" BOOLEAN NOT NULL,
    "verificationStatus" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairJobAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepairJobAttempt_repairJobId_createdAt_idx" ON "RepairJobAttempt"("repairJobId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RepairJobAttempt_repairJobId_attemptNumber_key" ON "RepairJobAttempt"("repairJobId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "RepairJobAttempt" ADD CONSTRAINT "RepairJobAttempt_repairJobId_fkey" FOREIGN KEY ("repairJobId") REFERENCES "RepairJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
