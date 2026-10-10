-- CreateTable
CREATE TABLE "SecurityAuditEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorId" TEXT,
    "repositoryId" TEXT,
    "repairJobId" TEXT,
    "outcome" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SecurityAuditEvent_eventType_createdAt_idx" ON "SecurityAuditEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityAuditEvent_repositoryId_createdAt_idx" ON "SecurityAuditEvent"("repositoryId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityAuditEvent_repairJobId_createdAt_idx" ON "SecurityAuditEvent"("repairJobId", "createdAt");
