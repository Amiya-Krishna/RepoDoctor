import { prisma } from "../config/prisma.js";
import { classifyStaleRepairJob } from "./maintenance.js";
import { notifyUser } from "./notification.service.js";

const PUBLISH_STAGES = ["REVALIDATING", "TESTING", "BRANCH_PUSHED", "PR_CREATED", "PUBLISH_FAILED_RETRYABLE"];

/**
 * Run at worker start and periodically.
 *  - RUNNING repair loops orphaned by a crash -> INTERRUPTED (the owner is told; nothing was pushed).
 *  - APPROVED approvals whose queue message was lost -> re-enqueued.
 *  - Publication stages whose lease expired (worker died mid-publish) -> re-enqueued with the next
 *    generation job id; the publication itself re-derives its position from persisted + remote facts.
 *  - After too many recoveries -> PUBLISH_BLOCKED with an honest message about any branch left on GitHub.
 */
export async function recoverStaleRepairJobs(
  requeuePublish: (data: { repairJobId: string; userId: string }, generation?: number) => Promise<unknown>,
  now = new Date(),
  thresholds = { runningMs: 45 * 60_000, approvedMs: 2 * 60_000 },
): Promise<{ interrupted: number; requeued: number; blocked: number }> {
  const candidates = await prisma.repairJob.findMany({
    where: {
      OR: [
        { status: { in: ["RUNNING", "APPROVED"] }, updatedAt: { lt: new Date(now.getTime() - thresholds.approvedMs) } },
        { status: { in: PUBLISH_STAGES }, OR: [{ publishLockedUntil: null }, { publishLockedUntil: { lt: now } }] },
      ],
    },
    include: { analysis: { select: { repository: { select: { id: true, userId: true } } } } },
  });

  let interrupted = 0, requeued = 0, blocked = 0;
  for (const job of candidates) {
    const owner = job.analysis.repository;
    const age = now.getTime() - job.updatedAt.getTime();
    const action = classifyStaleRepairJob(job.status, age, thresholds, job.publishAttempts);
    if (action === "REQUEUE_PUBLISH") {
      await requeuePublish({ repairJobId: job.id, userId: owner.userId }, job.publishAttempts);
      requeued++;
    } else if (action === "MARK_INTERRUPTED") {
      const claimed = await prisma.repairJob.updateMany({
        where: { id: job.id, status: job.status },
        data: { status: "INTERRUPTED", errorMessage: "The worker stopped before this job finished. Nothing was pushed to GitHub." },
      });
      if (claimed.count === 1) {
        interrupted++;
        await notifyUser({
          userId: owner.userId, type: "JOB_INTERRUPTED", severity: "WARNING", repositoryId: owner.id,
          title: "A repair was interrupted",
          message: "The worker restarted while this repair was running. Start the repair again from the finding; no changes were made to your repository.",
        });
      }
    } else if (action === "BLOCK_PUBLISH_EXHAUSTED") {
      const pushed = Boolean(job.headCommitSha);
      const claimed = await prisma.repairJob.updateMany({
        where: { id: job.id, status: job.status },
        data: { status: "PUBLISH_BLOCKED", publishLockedUntil: null, errorMessage: "Publishing did not complete after repeated attempts." },
      });
      if (claimed.count === 1) {
        blocked++;
        await notifyUser({
          userId: owner.userId, type: "REPAIR_FAILED", severity: "WARNING", repositoryId: owner.id,
          title: "Pull request could not be completed",
          message: pushed
            ? `Publishing did not complete after repeated attempts. The branch ${job.branchName ?? ""} exists on GitHub; you can open the pull request from it manually. RepoDoctor never merges.`
            : "Publishing did not complete after repeated attempts and nothing was pushed to your repository. Start the repair again from the finding.",
        });
      }
    }
  }
  return { interrupted, requeued, blocked };
}
