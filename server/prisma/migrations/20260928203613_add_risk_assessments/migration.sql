-- CreateTable
CREATE TABLE "RiskAssessment" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "factors" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiskAssessment_analysisId_idx" ON "RiskAssessment"("analysisId");

-- CreateIndex
CREATE INDEX "RiskAssessment_findingId_idx" ON "RiskAssessment"("findingId");

-- CreateIndex
CREATE INDEX "RiskAssessment_level_idx" ON "RiskAssessment"("level");

-- CreateIndex
CREATE INDEX "RiskAssessment_priority_idx" ON "RiskAssessment"("priority");

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
