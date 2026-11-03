import { prisma } from "../config/prisma.js";
import { recordAudit, sanitizeDetails } from "../audit/audit.service.js";
import { DAY_MS, retentionCutoff } from "./maintenance.js";
import { purgeOldWebhookDeliveries } from "../github/webhook-store.js";
import { DEFAULT_RETENTION_DAYS } from "../privacy/privacy.policy.js";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Deletes analyses (and everything hanging off them) by id, including tables that only store the id as a string. */
async function deleteAnalysesIn(tx: Tx, analysisIds: string[]): Promise<number> {
  if (analysisIds.length === 0) return 0;
  await tx.repairAttempt.deleteMany({ where: { analysisId: { in: analysisIds } } });
  await tx.dockerTestRun.deleteMany({ where: { analysisId: { in: analysisIds } } });
  await tx.analysis.deleteMany({ where: { id: { in: analysisIds } } }); // cascades findings, proposals, verifications, PRs, repair jobs
  return analysisIds.length;
}

const deleteAnalyses = (analysisIds: string[]) => prisma.$transaction((tx) => deleteAnalysesIn(tx, analysisIds));

const auditIn = (tx: Tx, event: { eventType: string; actorId: string; repositoryId?: string; details: Record<string, unknown> }) =>
  tx.securityAuditEvent.create({
    data: {
      eventType: event.eventType,
      outcome: "SUCCESS",
      actorId: event.actorId,
      repositoryId: event.repositoryId ?? null,
      details: JSON.parse(JSON.stringify(sanitizeDetails(event.details) ?? {})),
    },
  });

/**
 * Deletion and its audit record commit together: if the audit event cannot be stored the data
 * is NOT deleted (and the caller sees an error), so a deletion can never go unrecorded.
 */
export async function deleteRepositoryData(userId: string, repositoryId: string): Promise<boolean> {
  const repository = await prisma.repository.findFirst({ where: { id: repositoryId, userId }, select: { id: true } });
  if (!repository) return false;
  await recordAudit({ eventType: "DATA_DELETION_REQUESTED", outcome: "SUCCESS", actorId: userId, repositoryId, details: { scope: "repository" } }, { failClosed: true });
  await prisma.$transaction(async (tx) => {
    const analyses = await tx.analysis.findMany({ where: { repositoryId }, select: { id: true } });
    await deleteAnalysesIn(tx, analyses.map((a: { id: string }) => a.id));
    await tx.repository.delete({ where: { id: repositoryId } }); // cascades memory chunks
    await auditIn(tx, { eventType: "DATA_DELETED", actorId: userId, repositoryId, details: { scope: "repository", analyses: analyses.length } });
  });
  return true;
}

export async function deleteAllUserData(userId: string, options: { deleteAccount: boolean }): Promise<void> {
  await recordAudit(
    { eventType: "DATA_DELETION_REQUESTED", outcome: "SUCCESS", actorId: userId, details: { scope: options.deleteAccount ? "account" : "all-analysis-data" } },
    { failClosed: true },
  );
  await prisma.$transaction(async (tx) => {
    const repositories = await tx.repository.findMany({ where: { userId }, select: { id: true } });
    const analyses = await tx.analysis.findMany({ where: { repositoryId: { in: repositories.map((r: { id: string }) => r.id) } }, select: { id: true } });
    await deleteAnalysesIn(tx, analyses.map((a: { id: string }) => a.id));
    await tx.repository.deleteMany({ where: { userId } });
    await tx.notification.deleteMany({ where: { userId } });
    await auditIn(tx, {
      eventType: "DATA_DELETED",
      actorId: userId,
      details: { scope: options.deleteAccount ? "account" : "all-analysis-data", repositories: repositories.length, analyses: analyses.length },
    });
    if (options.deleteAccount) {
      await tx.user.delete({ where: { id: userId } }); // cascades privacy settings
    } else {
      // Withdraw the GitHub connection and consent as well: nothing keeps working in the background.
      await tx.user.update({ where: { id: userId }, data: { githubAccessToken: null, githubId: null, githubUsername: null } });
      await tx.privacySettings.deleteMany({ where: { userId } });
    }
  });
}

/** Applies each user's retention period. Safe to run repeatedly. */
export async function purgeExpiredData(now = new Date()): Promise<{ analysesDeleted: number }> {
  const users = await prisma.user.findMany({
    select: { id: true, privacySettings: { select: { retentionDays: true } } },
  });
  let analysesDeleted = 0;

  for (const user of users as { id: string; privacySettings: { retentionDays: number } | null }[]) {
    const cutoff = retentionCutoff(now, user.privacySettings?.retentionDays ?? DEFAULT_RETENTION_DAYS);
    const expired = await prisma.analysis.findMany({
      where: { createdAt: { lt: cutoff }, repository: { userId: user.id } },
      select: { id: true },
    });
    // Keep an analysis that still has a verified repair waiting for the owner's decision.
    const pending = await prisma.repairJob.findMany({
      where: { analysisId: { in: expired.map((a: { id: string }) => a.id) }, status: { in: ["AWAITING_APPROVAL", "APPROVED", "PUBLISHING", "REVALIDATING", "TESTING", "BRANCH_PUSHED", "PR_CREATED", "PUBLISH_FAILED_RETRYABLE", "NEEDS_REAPPROVAL"] } },
      select: { analysisId: true },
    });
    const keep = new Set(pending.map((p: { analysisId: string }) => p.analysisId));
    const ids = expired.map((a: { id: string }) => a.id).filter((id: string) => !keep.has(id));
    analysesDeleted += await deleteAnalyses(ids);
  }

  await purgeOldWebhookDeliveries(now); // terminal deliveries only, kept WEBHOOK_RETENTION_DAYS (replay protection window)
  await prisma.notification.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * DAY_MS) } } });
  await prisma.securityAuditEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 365 * DAY_MS) } } });

  if (analysesDeleted > 0) {
    await recordAudit({ eventType: "RETENTION_PURGE", outcome: "SUCCESS", details: { analysesDeleted } });
  }
  return { analysesDeleted };
}
