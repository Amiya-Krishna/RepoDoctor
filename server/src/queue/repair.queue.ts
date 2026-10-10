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
}

export interface AutonomousRepairJobResult {
  repairJobId?: string;
  analysisId: string;
  findingId: string;
  status: string;
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

export async function queueAutonomousRepair(data: AutonomousRepairJobData) {
  const job = await repairQueue.add("repair", data, {
    jobId: `repair-${randomUUID()}`,
  });
  return { jobId: String(job.id), job };
}

export async function getAutonomousRepairQueueJob(jobId: string) {
  return repairQueue.getJob(jobId);
}

export async function closeRepairQueue() {
  await repairQueue.close();
}
