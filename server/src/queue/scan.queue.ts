import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";

export const SCAN_QUEUE_NAME = "repository-scan";

export interface RepositoryScanJobData {
  repositoryId: string;
  userId: string;
  trigger: "manual" | "github-webhook";
  ref?: string;
  deliveryId?: string;
  analysisId?: string;
}

export interface RepositoryScanProgress {
  userId: string;
  repositoryId: string;
  jobId: string;
  stage: string;
  message: string;
  percent: number;
  analysisId?: string;
}

export interface RepositoryScanResult {
  repositoryId: string;
  analysisId: string;
  status: "COMPLETED";
  trigger: RepositoryScanJobData["trigger"];
}

export const redisConnection = {
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: Number(process.env.REDIS_PORT ?? 6379),
  ...(process.env.REDIS_USERNAME ? { username: process.env.REDIS_USERNAME } : {}),
  ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
  maxRetriesPerRequest: null,
};

export const scanQueue = new Queue<
  RepositoryScanJobData,
  RepositoryScanResult,
  "scan"
>(SCAN_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2_000 },
    removeOnComplete: { age: 86_400, count: 2_000 },
    removeOnFail: { age: 7 * 86_400, count: 5_000 },
  },
});

export async function queueRepositoryScan(
  data: RepositoryScanJobData,
  jobId?: string,
) {
  const safeJobId = jobId ?? `manual-${randomUUID()}`;
  const job = await scanQueue.add("scan", data, { jobId: safeJobId });
  return { jobId: String(job.id), job };
}

export async function getRepositoryScanJob(jobId: string) {
  return scanQueue.getJob(jobId);
}

export async function closeScanQueue() {
  await scanQueue.close();
}
