-- CreateTable
CREATE TABLE "GeneratedTest" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "targetFunction" TEXT,
    "testCode" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedTest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeneratedTest_analysisId_idx" ON "GeneratedTest"("analysisId");

-- CreateIndex
CREATE INDEX "GeneratedTest_type_idx" ON "GeneratedTest"("type");

-- AddForeignKey
ALTER TABLE "GeneratedTest" ADD CONSTRAINT "GeneratedTest_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
