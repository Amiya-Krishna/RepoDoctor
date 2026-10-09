-- CreateTable
CREATE TABLE "RepairJob" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentAttempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepairJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepairJob_analysisId_idx" ON "RepairJob"("analysisId");

-- CreateIndex
CREATE INDEX "RepairJob_findingId_idx" ON "RepairJob"("findingId");

-- CreateIndex
CREATE INDEX "RepairJob_status_idx" ON "RepairJob"("status");

-- AddForeignKey
ALTER TABLE "RepairJob" ADD CONSTRAINT "RepairJob_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
