-- CreateTable
CREATE TABLE "BugFinding" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "lineStart" INTEGER NOT NULL,
    "lineEnd" INTEGER NOT NULL,
    "evidence" TEXT NOT NULL,
    "suggestedFix" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BugFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BugFinding_analysisId_idx" ON "BugFinding"("analysisId");

-- CreateIndex
CREATE INDEX "BugFinding_severity_idx" ON "BugFinding"("severity");

-- AddForeignKey
ALTER TABLE "BugFinding" ADD CONSTRAINT "BugFinding_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
