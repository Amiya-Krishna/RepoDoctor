-- CreateTable
CREATE TABLE "FixProposal" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FixProposal_analysisId_idx" ON "FixProposal"("analysisId");

-- CreateIndex
CREATE INDEX "FixProposal_findingId_idx" ON "FixProposal"("findingId");

-- CreateIndex
CREATE INDEX "FixProposal_status_idx" ON "FixProposal"("status");

-- AddForeignKey
ALTER TABLE "FixProposal" ADD CONSTRAINT "FixProposal_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
