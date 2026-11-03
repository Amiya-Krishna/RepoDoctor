import "dotenv/config";
import { Worker, UnrecoverableError } from "bullmq";
import { connectDatabase, disconnectDatabase, prisma } from "../config/prisma.js";
import {
  SCAN_QUEUE_NAME,
  redisConnection,
  closeScanQueue,
  type RepositoryScanJobData,
  type RepositoryScanResult,
} from "../queue/scan.queue.js";
import { ingestRepository } from "../services/ingestion.service.js";
import { revealToken } from "../security/token-encryption.js";
import { assertTokenStoreSecure } from "../security/token-migration.js";
import { assertSecureConfiguration } from "../config/startup-checks.js";
import { startMaintenanceScheduler } from "./maintenance.scheduler.js";
import { startWebhookRecoveryLoop } from "../github/webhook-recovery.js";
import { notifyUser } from "../services/notification.service.js";
import { findPrivacyPolicyError } from "../privacy/privacy.policy.js";

async function notifyScanResult(userId: string, repositoryId: string, analysisId: string) {
  const [bug, sec, prefs] = await Promise.all([
    prisma.bugFinding.count({ where: { analysisId, severity: "CRITICAL" } }),
    prisma.securityFinding.count({ where: { analysisId, severity: "CRITICAL" } }),
    prisma.privacySettings.findUnique({ where: { userId }, select: { notifyOnCritical: true } }),
  ]);
  const critical = bug + sec;
  if (critical > 0 && (prefs?.notifyOnCritical ?? true)) {
    await notifyUser({
      userId, type: "CRITICAL_FINDING", severity: "CRITICAL", repositoryId,
      title: `${critical} critical finding${critical === 1 ? "" : "s"}`,
      message: "The latest scan found critical issues. Open the repository to review them and start a verified repair.",
    });
  } else {
    await notifyUser({ userId, type: "SCAN_COMPLETED", repositoryId, title: "Scan completed", message: "Your repository scan finished. Open it to review findings." });
  }
}

const start = async () => {
  assertSecureConfiguration("scan-worker");
  await connectDatabase();
  // Production refuses to start while any stored GitHub token is plaintext or unreadable.
  await assertTokenStoreSecure();
  const stopScheduler = startMaintenanceScheduler();
  // Finishes webhook deliveries that were durably recorded but not yet queued (Redis outage, crash, expired lease).
  const stopWebhookRecovery = await startWebhookRecoveryLoop();

  const worker = new Worker<RepositoryScanJobData, RepositoryScanResult>(
    SCAN_QUEUE_NAME,
    async (job) => {
      const { repositoryId, userId, trigger, ref } = job.data;
      let analysisId = job.data.analysisId;

      const progress = async (stage: string, message: string, percent: number) => {
        await job.updateProgress({
          jobId: String(job.id),
          userId,
          repositoryId,
          ...(analysisId ? { analysisId } : {}),
          stage,
          message,
          percent,
        });
      };

      await progress("starting", "Loading repository connection", 1);

      const repository = await prisma.repository.findFirst({
        where: { id: repositoryId, userId },
      });

      if (!repository) {
        throw new Error("Repository is not connected to this account");
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { githubAccessToken: true },
      });

      if (!user?.githubAccessToken) {
        throw new Error("GitHub connection is missing or expired");
      }

      if (!analysisId) {
        const analysis = await prisma.analysis.create({
          data: { repositoryId, status: "PENDING" },
          select: { id: true },
        });
        analysisId = analysis.id;
        await job.updateData({ ...job.data, analysisId });
      }

      try {
        const result = await ingestRepository({
          repositoryId,
          cloneUrl: repository.cloneUrl,
          accessToken: revealToken(user.githubAccessToken),
          defaultBranch: ref || repository.defaultBranch,
          sourceRef: ref || repository.defaultBranch,
          analysisId,
          onProgress: progress,
        });

        await progress("completed", "Repository analysis completed", 100);
        await notifyScanResult(userId, repositoryId, result.analysisId);

        return {
          repositoryId,
          analysisId: result.analysisId,
          status: "COMPLETED",
          trigger,
        };
      } catch (error) {
        // A privacy block is deterministic: retrying cannot fix it, so stop retrying
        // and tell the user exactly what to change.
        const privacyError = findPrivacyPolicyError(error); // also when consent was withdrawn mid-analysis (wrapped by the pipeline)
        if (privacyError) {
          await prisma.analysis.updateMany({ where: { id: analysisId, repositoryId }, data: { status: "FAILED", completedAt: new Date() } });
          await notifyUser({
            userId, type: "PRIVACY_BLOCKED", severity: "WARNING", repositoryId,
            title: "Analysis not started: privacy settings",
            message: `${privacyError.message} ${privacyError.recovery}`,
          });
          throw new UnrecoverableError(`${privacyError.message} ${privacyError.recovery}`);
        }
        const maxAttempts = job.opts.attempts ?? 1;
        if (analysisId && job.attemptsMade + 1 >= maxAttempts) {
          await prisma.analysis.updateMany({
            where: { id: analysisId, repositoryId },
            data: { status: "FAILED", completedAt: new Date() },
          });
        }
        throw error;
      }
    },
    {
      connection: redisConnection,
      concurrency: Math.max(1, Number(process.env.SCAN_WORKER_CONCURRENCY ?? 2)),
    },
  );

  worker.on("failed", (job, error) => {
    console.error("Repository scan job failed", {
      jobId: job?.id,
      message: error.message,
    });
  });

  worker.on("error", (error) => {
    console.error("Repository scan worker error", error.message);
  });

  const shutdown = async () => {
    stopScheduler();
    stopWebhookRecovery();
    await worker.close();
    await closeScanQueue();
    await disconnectDatabase();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  console.log("RepoDoctor scan worker started");
};

start().catch(async (error) => {
  console.error("Failed to start scan worker", error);
  await closeScanQueue().catch(() => undefined);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
