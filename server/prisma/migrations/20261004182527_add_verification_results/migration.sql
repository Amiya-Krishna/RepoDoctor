-- CreateTable
CREATE TABLE "VerificationResult" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "fixProposalId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL,
    "reasoning" TEXT NOT NULL,
    "testPassed" BOOLEAN NOT NULL,
    "regressionDetected" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationResult_analysisId_idx" ON "VerificationResult"("analysisId");

-- CreateIndex
CREATE INDEX "VerificationResult_findingId_idx" ON "VerificationResult"("findingId");

-- CreateIndex
CREATE INDEX "VerificationResult_fixProposalId_idx" ON "VerificationResult"("fixProposalId");

-- CreateIndex
CREATE INDEX "VerificationResult_status_idx" ON "VerificationResult"("status");

-- AddForeignKey
ALTER TABLE "VerificationResult" ADD CONSTRAINT "VerificationResult_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
