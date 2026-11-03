import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { Worker, UnrecoverableError } from "bullmq";
import { connectDatabase, disconnectDatabase, prisma } from "../config/prisma.js";
import {
  PUBLISH_QUEUE_NAME,
  publishQueue,
  queuePublish,
  REPAIR_QUEUE_NAME,
  repairQueue,
  type AutonomousRepairJobData,
  type AutonomousRepairJobResult,
} from "../queue/repair.queue.js";
import { redisConnection, closeScanQueue } from "../queue/scan.queue.js";
import { createWorkspace, removeWorkspace } from "../services/workspace.service.js";
import { revealToken } from "../security/token-encryption.js";
import { runAutonomousRepair } from "../services/autonomous-repair.service.js";
import { assertTokenStoreSecure } from "../security/token-migration.js";
import { assertSecureConfiguration } from "../config/startup-checks.js";
import { publishApprovedRepair } from "../services/publish-approved.service.js";
import { recoverStaleRepairJobs } from "../services/repair-recovery.service.js";
import { notifyUser } from "../services/notification.service.js";
import { recordAudit } from "../audit/audit.service.js";
import { validateTestCommand } from "../security/test-command-policy.js";

import { gitAuthEnvironment } from "../github/git-env.js";
import { findPrivacyPolicyError } from "../privacy/privacy.policy.js";
import type { BugFinding, BugCategory, BugSeverity } from "../agents/bug-detection.types.js";
import type { SecurityFinding, SecurityCategory, SecuritySeverity } from "../agents/security.types.js";

const execFileAsync = promisify(execFile);
const bugCategories = new Set(["LOGIC", "RUNTIME", "TYPE", "ASYNC", "SECURITY", "PERFORMANCE", "OTHER"]);
const securityCategories = new Set([
  "SECRET_EXPOSURE", "INJECTION", "AUTHENTICATION", "AUTHORIZATION",
  "CRYPTOGRAPHY", "INPUT_VALIDATION", "PATH_TRAVERSAL", "SSRF",
  "COMMAND_EXECUTION", "DATA_EXPOSURE", "INSECURE_CONFIGURATION", "DEPENDENCY", "OTHER",
]);
const severities = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

async function loadFinding(analysisId: string, findingId: string) {
  const bug = await prisma.bugFinding.findFirst({ where: { id: findingId, analysisId } });
  if (bug) {
    if (!bugCategories.has(bug.category) || !severities.has(bug.severity)) {
      throw new Error("Stored bug finding has an unsupported category or severity");
    }
    const finding: BugFinding = {
      title: bug.title,
      description: bug.description,
      category: bug.category as BugCategory,
      severity: bug.severity as BugSeverity,
      filePath: bug.filePath,
      lineStart: bug.lineStart,
      lineEnd: bug.lineEnd,
      evidence: bug.evidence,
      suggestedFix: bug.suggestedFix,
      confidence: bug.confidence,
    };
    return finding;
  }

  const security = await prisma.securityFinding.findFirst({ where: { id: findingId, analysisId } });
  if (!security) throw new Error("Finding not found for the requested analysis");
  if (!securityCategories.has(security.category) || !severities.has(security.severity)) {
    throw new Error("Stored security finding has an unsupported category or severity");
  }

  const finding: SecurityFinding = {
    title: security.title,
    description: security.description,
    category: security.category as SecurityCategory,
    severity: security.severity as SecuritySeverity,
    filePath: security.filePath,
    lineStart: security.lineStart,
    lineEnd: security.lineEnd,
    evidence: security.evidence,
    suggestedFix: security.suggestedFix,
    confidence: security.confidence,
  };
  return finding;
}

async function announceOutcome(userId: string, repositoryId: string, status: string) {
  if (status === "VERIFIED") {
    await recordAudit({ eventType: "REPAIR_VERIFIED", outcome: "SUCCESS", actorId: userId, repositoryId });
    await notifyUser({
      userId, type: "REPAIR_VERIFIED", repositoryId,
      title: "A verified fix is ready for your approval",
      message: "The patch passed the tests in an isolated sandbox. Review the diff and the test evidence, then approve to open a pull request.",
    });
  } else {
    await recordAudit({ eventType: "REPAIR_NOT_VERIFIED", outcome: "DENIED", actorId: userId, repositoryId, details: { status } });
    await notifyUser({
      userId,
      type: status === "INCONCLUSIVE" ? "REPAIR_INCONCLUSIVE" : "REPAIR_FAILED",
      severity: "WARNING", repositoryId,
      title: status === "INCONCLUSIVE" ? "Repair was inconclusive" : "Repair could not be verified",
      message: "No pull request was created. Open the repair report for the test output and suggested next steps (for example a different test command or project folder).",
    });
  }
}

const start = async () => {
  assertSecureConfiguration("repair-worker");
  await connectDatabase();
  // Production refuses to start while any stored GitHub token is plaintext or unreadable.
  await assertTokenStoreSecure();

  // Resume what a previous worker left behind: mark orphaned jobs (the user is told)
  // and re-enqueue approvals whose queue message was lost.
  const recover = async () => {
    try {
      const r = await recoverStaleRepairJobs(queuePublish);
      if (r.interrupted || r.requeued) console.log("repair job recovery", r);
    } catch (error) {
      console.error("repair job recovery failed", error instanceof Error ? error.name : "unknown");
    }
  };
  await recover();
  const recoveryTimer = setInterval(recover, 5 * 60_000);

  const worker = new Worker<AutonomousRepairJobData, AutonomousRepairJobResult>(
    REPAIR_QUEUE_NAME,
    async (job) => {
      const { userId, repositoryId, analysisId, findingId, testCommand, workingDirectory } = job.data;
      const progress = async (stage: string, message: string, percent: number) => {
        try {
          await job.updateProgress({
            jobId: String(job.id),
            userId,
            repositoryId,
            analysisId,
            findingId,
            stage,
            message,
            percent,
          });
        } catch (error) {
          // A realtime transport failure must not fail the repair itself.
          console.warn("Unable to persist repair progress", error);
        }
      };

      const analysis = await prisma.analysis.findFirst({
        where: { id: analysisId, repositoryId },
        include: { repository: true },
      });
      if (!analysis || analysis.repository.userId !== userId) {
        throw new Error("Analysis not found for this account");
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { githubAccessToken: true },
      });
      if (!user?.githubAccessToken) throw new Error("GitHub connection is missing or expired");
      const githubAccessToken = revealToken(user.githubAccessToken);

      // Defence in depth: the API validated this, but the queue is also an input.
      const command = validateTestCommand(testCommand);
      if (!command.ok) {
        await recordAudit({ eventType: "REPAIR_REJECTED", outcome: "DENIED", actorId: userId, repositoryId, details: { reason: command.reason } });
        throw new UnrecoverableError(`Test command rejected: ${command.reason}`);
      }

      const finding = await loadFinding(analysisId, findingId);
      const sourceWorkspace = await createWorkspace();

      try {
        const sourceRepositoryPath = path.join(sourceWorkspace.path, "repository");
        await progress("source-clone", "Preparing a disposable source clone", 5);

        await execFileAsync(
          "git",
          [
            "clone",
            "--depth", "1",
            "--branch", analysis.sourceRef || analysis.repository.defaultBranch,
            "--",
            analysis.repository.cloneUrl,
            sourceRepositoryPath,
          ],
          {
            env: gitAuthEnvironment(githubAccessToken),
            timeout: 120_000,
            maxBuffer: 10 * 1024 * 1024,
          },
        );

        await progress("repair-loop", "Starting bounded repair and verification loop", 10);

        const result = await runAutonomousRepair({
          analysisId,
          repositoryId,
          findingId,
          finding,
          sourceRepositoryPath,
          testCommand: command.argv,
          workingDirectory,
          onProgress: progress,
        });

        await announceOutcome(userId, repositoryId, result.status);

        return {
          repairJobId: result.repairJobId,
          analysisId,
          findingId,
          status: result.status,
          summary: result.attempts.at(-1)?.summary?.slice(0, 900),
        };
      } finally {
        await removeWorkspace(sourceWorkspace.path);
      }
    },
    {
      connection: redisConnection,
      concurrency: Math.max(1, Number(process.env.REPAIR_WORKER_CONCURRENCY ?? 1)),
    },
  );

  const publishWorker = new Worker(
    PUBLISH_QUEUE_NAME,
    async (job) => {
      const outcome = await publishApprovedRepair({ repairJobId: job.data.repairJobId, userId: job.data.userId });
      return outcome.status === "PUBLISHED" || outcome.status === "ALREADY_PUBLISHED"
        ? { status: outcome.status, pullRequestUrl: outcome.pullRequestUrl }
        : { status: outcome.status }; // RETRYABLE is resumed by the recovery sweep, not by BullMQ
    },
    { connection: redisConnection, concurrency: 1 },
  );
  publishWorker.on("failed", (job, error) => {
    console.error("Publish job failed", { jobId: job?.id, message: error.message });
  });

  worker.on("failed", async (job, error) => {
    const privacyError = findPrivacyPolicyError(error);
    if (job && privacyError) {
      await notifyUser({ userId: job.data.userId, type: "PRIVACY_BLOCKED", severity: "WARNING", title: "Repair not started: privacy settings", message: `${privacyError.message} ${privacyError.recovery}`.slice(0, 600) });
    }
    console.error("Autonomous repair queue job failed", {
      jobId: job?.id,
      message: error.message,
    });
  });
  worker.on("error", (error) => console.error("Autonomous repair worker error", error.message));

  const shutdown = async () => {
    clearInterval(recoveryTimer);
    await worker.close();
    await publishWorker.close();
    await repairQueue.close();
    await closeScanQueue();
    await disconnectDatabase();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  console.log("RepoDoctor autonomous repair worker started");
};

start().catch(async (error) => {
  console.error("Failed to start autonomous repair worker", error);
  await repairQueue.close().catch(() => undefined);
  await closeScanQueue().catch(() => undefined);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
