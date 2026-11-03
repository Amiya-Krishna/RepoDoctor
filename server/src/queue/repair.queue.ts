import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { redisConnection } from "./scan.queue.js";
import { publishQueueJobId } from "../repair/repair-guard.js";

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
      // Publication is guarded by persisted compare-and-set transitions, a lease, a unique
      // (analysis, finding) pull request row and remote-state checks, so a redelivery is harmless.
      // Retries come from the recovery sweep (bounded), not from BullMQ.
      attempts: 1,
      removeOnComplete: { age: 86_400, count: 2_000 },
      removeOnFail: { age: 7 * 86_400, count: 5_000 },
    },
  },
);

export async function queuePublish(data: PublishJobData, generation = 0) {
  // Deterministic id per (repair, generation): a double-click or retried HTTP request enqueues once, while a
  // recovery attempt uses the next generation (BullMQ refuses to re-add an id it still retains).
  const job = await publishQueue.add("publish", data, { jobId: publishQueueJobId(data.repairJobId, generation) });
  return { jobId: String(job.id) };
}

export async function closePublishQueue() {
  await publishQueue.close();
}
