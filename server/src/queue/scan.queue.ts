import { randomUUID } from "node:crypto";
import { Queue, type ConnectionOptions } from "bullmq";

export const SCAN_QUEUE_NAME = "repository-scan";

export interface RepositoryScanJobData {
  repositoryId: string;
  userId: string;
  trigger: "manual" | "github-webhook" | "scheduled";
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

/**
 * Factory so tests (and the webhook recovery loop) can point at another
 * connection or a unique key prefix. Production uses the default `scanQueue`.
 */
export const createScanQueue = (options: { connection?: ConnectionOptions; prefix?: string } = {}) =>
  new Queue<RepositoryScanJobData, RepositoryScanResult, "scan">(SCAN_QUEUE_NAME, {
    connection: options.connection ?? redisConnection,
    ...(options.prefix ? { prefix: options.prefix } : {}),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { age: 86_400, count: 2_000 },
      removeOnFail: { age: 7 * 86_400, count: 5_000 },
    },
  });

export type ScanQueue = ReturnType<typeof createScanQueue>;

export const scanQueue: ScanQueue = createScanQueue();

/**
 * With an explicit jobId BullMQ's `add` is idempotent: if a job with that id
 * already exists the existing job is returned and nothing is enqueued twice.
 */
export async function queueRepositoryScan(
  data: RepositoryScanJobData,
  jobId?: string,
  queue: ScanQueue = scanQueue,
) {
  const safeJobId = jobId ?? `manual-${randomUUID()}`;
  const job = await queue.add("scan", data, { jobId: safeJobId });
  return { jobId: String(job.id), job };
}

export async function getRepositoryScanJob(jobId: string) {
  return scanQueue.getJob(jobId);
}

export async function closeScanQueue() {
  await scanQueue.close();
}
