import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { Worker } from "bullmq";
import { connectDatabase, disconnectDatabase, prisma } from "../config/prisma.js";
import {
  REPAIR_QUEUE_NAME,
  repairQueue,
  type AutonomousRepairJobData,
  type AutonomousRepairJobResult,
} from "../queue/repair.queue.js";
import { redisConnection, closeScanQueue } from "../queue/scan.queue.js";
import { createWorkspace, removeWorkspace } from "../services/workspace.service.js";
import { runAutonomousRepair } from "../services/autonomous-repair.service.js";
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

const cloneEnvironment = (token: string): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
  GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
});

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

const start = async () => {
  await connectDatabase();

  const worker = new Worker<AutonomousRepairJobData, AutonomousRepairJobResult>(
    REPAIR_QUEUE_NAME,
    async (job) => {
      const { userId, repositoryId, analysisId, findingId, testCommand } = job.data;
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
            env: cloneEnvironment(user.githubAccessToken),
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
          testCommand,
          publication: {
            owner: analysis.repository.ownerLogin,
            repo: analysis.repository.name,
            token: user.githubAccessToken,
            baseBranch: analysis.repository.defaultBranch,
          },
          onProgress: progress,
        });

        return {
          repairJobId: result.repairJobId,
          analysisId,
          findingId,
          status: result.status,
          ...(result.pullRequest ? { pullRequest: result.pullRequest } : {}),
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

  worker.on("failed", (job, error) => {
    console.error("Autonomous repair queue job failed", {
      jobId: job?.id,
      message: error.message,
    });
  });
  worker.on("error", (error) => console.error("Autonomous repair worker error", error.message));

  const shutdown = async () => {
    await worker.close();
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
