import "dotenv/config";
import { Worker } from "bullmq";
import { connectDatabase, disconnectDatabase, prisma } from "../config/prisma.js";
import {
  SCAN_QUEUE_NAME,
  redisConnection,
  closeScanQueue,
  type RepositoryScanJobData,
  type RepositoryScanResult,
} from "../queue/scan.queue.js";
import { ingestRepository } from "../services/ingestion.service.js";

const start = async () => {
  await connectDatabase();

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
          accessToken: user.githubAccessToken,
          defaultBranch: ref || repository.defaultBranch,
          sourceRef: ref || repository.defaultBranch,
          analysisId,
          onProgress: progress,
        });

        await progress("completed", "Repository analysis completed", 100);

        return {
          repositoryId,
          analysisId: result.analysisId,
          status: "COMPLETED",
          trigger,
        };
      } catch (error) {
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
