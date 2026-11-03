-- Reliability hardening (additive; safe on populated databases).
--   1. Durable webhook lifecycle + transactional outbox
--   2. Repair publication state machine and approval binding columns
--   3. Audit log: actor index and append-only protection

-- 1. Webhook lifecycle ------------------------------------------------------
-- Rows written by the previous code were "claimed" before anything was queued, so
-- their real outcome is unknown. They are marked LEGACY_CLAIMED (terminal, never
-- resumed) and the column default is then switched to PENDING for new rows.
ALTER TABLE "WebhookDelivery" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'LEGACY_CLAIMED';
ALTER TABLE "WebhookDelivery" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "WebhookDelivery" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WebhookDelivery" ADD COLUMN "lockedUntil" TIMESTAMP(3);
ALTER TABLE "WebhookDelivery" ADD COLUMN "lastError" TEXT;
ALTER TABLE "WebhookDelivery" ADD COLUMN "githubRepositoryId" TEXT;
ALTER TABLE "WebhookDelivery" ADD COLUMN "ref" TEXT;
ALTER TABLE "WebhookDelivery" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "WebhookDelivery" ADD COLUMN "completedAt" TIMESTAMP(3);
CREATE INDEX "WebhookDelivery_status_updatedAt_idx" ON "WebhookDelivery"("status", "updatedAt");

CREATE TABLE "WebhookScanOutbox" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ref" TEXT,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "enqueuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookScanOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebhookScanOutbox_deliveryId_repositoryId_key" ON "WebhookScanOutbox"("deliveryId", "repositoryId");
CREATE INDEX "WebhookScanOutbox_status_updatedAt_idx" ON "WebhookScanOutbox"("status", "updatedAt");
ALTER TABLE "WebhookScanOutbox" ADD CONSTRAINT "WebhookScanOutbox_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "WebhookDelivery"("deliveryId") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Repair publication ------------------------------------------------------
ALTER TABLE "RepairJob" ADD COLUMN "patchHash" TEXT;
ALTER TABLE "RepairJob" ADD COLUMN "baseCommitSha" TEXT;
ALTER TABLE "RepairJob" ADD COLUMN "preImageHashes" JSONB;
ALTER TABLE "RepairJob" ADD COLUMN "approvedPatchHash" TEXT;
ALTER TABLE "RepairJob" ADD COLUMN "approvedBaseCommitSha" TEXT;
ALTER TABLE "RepairJob" ADD COLUMN "branchName" TEXT;
ALTER TABLE "RepairJob" ADD COLUMN "headCommitSha" TEXT;
ALTER TABLE "RepairJob" ADD COLUMN "pullRequestNumber" INTEGER;
ALTER TABLE "RepairJob" ADD COLUMN "publishAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RepairJob" ADD COLUMN "publishLockedUntil" TIMESTAMP(3);
CREATE INDEX "RepairJob_status_publishLockedUntil_idx" ON "RepairJob"("status", "publishLockedUntil");

-- Terminal success state is now COMPLETED (PUBLISHED was the pre-state-machine name).
-- Jobs that already finished keep their pull request URL; only the label changes.
UPDATE "RepairJob" SET "status" = 'COMPLETED' WHERE "status" = 'PUBLISHED';
-- Jobs approved before approval binding existed carry no recorded patch hash/base commit.
-- They cannot be published safely, so they must be approved again (the UI offers this).
UPDATE "RepairJob" SET "status" = 'AWAITING_APPROVAL', "approvedAt" = NULL, "approvedBy" = NULL
WHERE "status" IN ('APPROVED', 'PUBLISHING') AND "patchHash" IS NULL;

-- 3. Audit log ---------------------------------------------------------------
CREATE INDEX "SecurityAuditEvent_actorId_createdAt_idx" ON "SecurityAuditEvent"("actorId", "createdAt");

-- Append-only: audit rows can be inserted, never edited, and only deleted by the
-- retention purge once they are older than the retention floor (365 days).
CREATE OR REPLACE FUNCTION repodoctor_audit_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'SecurityAuditEvent rows are append-only' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD."createdAt" > (CURRENT_TIMESTAMP - INTERVAL '365 days') THEN
      RAISE EXCEPTION 'SecurityAuditEvent rows newer than 365 days cannot be deleted' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SecurityAuditEvent_append_only"
  BEFORE UPDATE OR DELETE ON "SecurityAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION repodoctor_audit_append_only();
