import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { redisConnection } from "./scan.queue.js";

export const REPAIR_QUEUE_NAME = "autonomous-repair";

export interface AutonomousRepairJobData {
  userId: string;
  repositoryId: string;
  analysisId: string;
  findingId: string;
  testCommand: string[];
  workingDirectory?: string;
}

export interface AutonomousRepairJobResult {
  repairJobId?: string;
  analysisId: string;
  findingId: string;
  status: string;
  /** Human-readable reason from the last attempt (why no pull request was created). */
  summary?: string;
  pullRequest?: {
    number: number;
    url: string;
    branchName: string;
    commitSha: string;
  };
}

export const repairQueue = new Queue<
  AutonomousRepairJobData,
  AutonomousRepairJobResult,
  "repair"
>(REPAIR_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    // The repair service itself enforces MAX_ATTEMPTS=3. Avoid rerunning the
    // entire repair loop at the queue level and creating duplicate attempts.
    attempts: 1,
    removeOnComplete: { age: 86_400, count: 2_000 },
    removeOnFail: { age: 7 * 86_400, count: 5_000 },
  },
});

export async function queueAutonomousRepair(data: AutonomousRepairJobData, jobId?: string) {
  const job = await repairQueue.add("repair", data, {
    jobId: jobId ?? `repair-${randomUUID()}`,
  });
  return { jobId: String(job.id), job };
}

export async function getAutonomousRepairQueueJob(jobId: string) {
  return repairQueue.getJob(jobId);
}

export async function closeRepairQueue() {
  await repairQueue.close();
  await publishQueue.close();
}

// ---------------------------------------------------------------------------
// Publication queue: a separate queue so an approved publish can never be
// confused with (or deduplicated against) an analysis-time repair job.
// ---------------------------------------------------------------------------

export const PUBLISH_QUEUE_NAME = "repair-publish";

export interface PublishJobData {
  repairJobId: string;
  userId: string;
}

export const publishQueue = new Queue<PublishJobData, { status: string; pullRequestUrl?: string }, "publish">(
  PUBLISH_QUEUE_NAME,
  {
    connection: redisConnection,
    defaultJobOptions: {
      // Publication is guarded by an atomic APPROVED -> PUBLISHING transition and a
      // unique (analysis, finding) pull request row, so a redelivery is harmless;
      // automatic retries are not used because a half-finished push needs a human.
      attempts: 1,
      removeOnComplete: { age: 86_400, count: 2_000 },
      removeOnFail: { age: 7 * 86_400, count: 5_000 },
    },
  },
);

export async function queuePublish(data: PublishJobData) {
  // Deterministic id: a double-click or retried HTTP request enqueues once.
  const job = await publishQueue.add("publish", data, { jobId: `publish-${data.repairJobId}` });
  return { jobId: String(job.id) };
}

export async function closePublishQueue() {
  await publishQueue.close();
}
