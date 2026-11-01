import { prisma } from "../config/prisma.js";
import { recordAudit } from "../audit/audit.service.js";
import { DAY_MS, classifyStaleRepairJob, retentionCutoff } from "./maintenance.js";
import { notifyUser } from "./notification.service.js";
import { DEFAULT_RETENTION_DAYS } from "../privacy/privacy.policy.js";

/** Deletes analyses (and everything hanging off them) by id, including tables that only store the id as a string. */
async function deleteAnalyses(analysisIds: string[]): Promise<number> {
  if (analysisIds.length === 0) return 0;
  await prisma.$transaction([
    prisma.repairAttempt.deleteMany({ where: { analysisId: { in: analysisIds } } }),
    prisma.dockerTestRun.deleteMany({ where: { analysisId: { in: analysisIds } } }),
    prisma.analysis.deleteMany({ where: { id: { in: analysisIds } } }), // cascades findings, proposals, verifications, PRs, repair jobs
  ]);
  return analysisIds.length;
}

export async function deleteRepositoryData(userId: string, repositoryId: string): Promise<boolean> {
  const repository = await prisma.repository.findFirst({ where: { id: repositoryId, userId }, select: { id: true } });
  if (!repository) return false;
  const analyses = await prisma.analysis.findMany({ where: { repositoryId }, select: { id: true } });
  await deleteAnalyses(analyses.map((a: { id: string }) => a.id));
  await prisma.repository.delete({ where: { id: repositoryId } }); // cascades memory chunks
  await recordAudit({ eventType: "DATA_DELETED", outcome: "SUCCESS", actorId: userId, repositoryId, details: { scope: "repository", analyses: analyses.length } }, { failClosed: true });
  return true;
}

export async function deleteAllUserData(userId: string, options: { deleteAccount: boolean }): Promise<void> {
  const repositories = await prisma.repository.findMany({ where: { userId }, select: { id: true } });
  const analyses = await prisma.analysis.findMany({ where: { repositoryId: { in: repositories.map((r: { id: string }) => r.id) } }, select: { id: true } });
  await deleteAnalyses(analyses.map((a: { id: string }) => a.id));
  await prisma.repository.deleteMany({ where: { userId } });
  await prisma.notification.deleteMany({ where: { userId } });
  await recordAudit(
    { eventType: "DATA_DELETED", outcome: "SUCCESS", actorId: userId, details: { scope: options.deleteAccount ? "account" : "all-analysis-data", repositories: repositories.length, analyses: analyses.length } },
    { failClosed: true },
  );
  if (options.deleteAccount) {
    await prisma.user.delete({ where: { id: userId } }); // cascades privacy settings
  } else {
    // Withdraw the GitHub connection and consent as well: nothing keeps working in the background.
    await prisma.user.update({ where: { id: userId }, data: { githubAccessToken: null, githubId: null, githubUsername: null } });
    await prisma.privacySettings.deleteMany({ where: { userId } });
  }
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
      where: { analysisId: { in: expired.map((a: { id: string }) => a.id) }, status: { in: ["AWAITING_APPROVAL", "APPROVED", "PUBLISHING"] } },
      select: { analysisId: true },
    });
    const keep = new Set(pending.map((p: { analysisId: string }) => p.analysisId));
    const ids = expired.map((a: { id: string }) => a.id).filter((id: string) => !keep.has(id));
    analysesDeleted += await deleteAnalyses(ids);
  }

  await prisma.webhookDelivery.deleteMany({ where: { receivedAt: { lt: new Date(now.getTime() - 7 * DAY_MS) } } });
  await prisma.notification.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * DAY_MS) } } });
  await prisma.securityAuditEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 365 * DAY_MS) } } });

  if (analysesDeleted > 0) {
    await recordAudit({ eventType: "RETENTION_PURGE", outcome: "SUCCESS", details: { analysesDeleted } });
  }
  return { analysesDeleted };
}

/** Marks repair jobs orphaned by a crashed worker and re-enqueues lost approvals. Run at worker start and periodically. */
export async function recoverStaleRepairJobs(
  requeuePublish: (data: { repairJobId: string; userId: string }) => Promise<unknown>,
  now = new Date(),
  thresholds = { runningMs: 45 * 60_000, approvedMs: 2 * 60_000 },
): Promise<{ interrupted: number; requeued: number }> {
  const candidates = await prisma.repairJob.findMany({
    where: { status: { in: ["RUNNING", "PUBLISHING", "APPROVED"] }, updatedAt: { lt: new Date(now.getTime() - thresholds.approvedMs) } },
    include: { analysis: { select: { repository: { select: { id: true, userId: true } } } } },
  });

  let interrupted = 0;
  let requeued = 0;
  for (const job of candidates) {
    const action = classifyStaleRepairJob(job.status, now.getTime() - job.updatedAt.getTime(), thresholds);
    const owner = job.analysis.repository;
    if (action === "REQUEUE_PUBLISH") {
      await requeuePublish({ repairJobId: job.id, userId: owner.userId });
      requeued++;
    } else if (action === "MARK_INTERRUPTED" || action === "MARK_PUBLISH_INTERRUPTED") {
      const status = action === "MARK_INTERRUPTED" ? "INTERRUPTED" : "PUBLISH_INTERRUPTED";
      const claimed = await prisma.repairJob.updateMany({
        where: { id: job.id, status: job.status },
        data: { status, errorMessage: "The worker stopped before this job finished. Nothing was pushed to GitHub." },
      });
      if (claimed.count === 1) {
        interrupted++;
        await notifyUser({
          userId: owner.userId, type: "JOB_INTERRUPTED", severity: "WARNING", repositoryId: owner.id,
          title: "A repair was interrupted",
          message: "The worker restarted while this repair was running. Start the repair again from the finding; no changes were made to your repository.",
        });
      }
    }
  }
  return { interrupted, requeued };
}
