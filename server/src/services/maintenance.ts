/** Pure helpers for retention, recovery and scheduling so they can be unit tested without a database. */

export const DAY_MS = 24 * 60 * 60 * 1000;

export const retentionCutoff = (now: Date, retentionDays: number): Date =>
  new Date(now.getTime() - retentionDays * DAY_MS);

export const isScanDue = (
  repo: { autoScan: boolean; lastScheduledScanAt: Date | null },
  now: Date,
  intervalMs: number,
): boolean =>
  repo.autoScan && (!repo.lastScheduledScanAt || now.getTime() - repo.lastScheduledScanAt.getTime() >= intervalMs);

/** One job id per repository per interval bucket, so several scheduler replicas enqueue once. */
export const scheduledScanJobId = (repositoryId: string, now: Date, intervalMs: number) =>
  `scheduled-${repositoryId}-${Math.floor(now.getTime() / intervalMs)}`;

export type StaleAction = "NONE" | "MARK_INTERRUPTED" | "REQUEUE_PUBLISH" | "BLOCK_PUBLISH_EXHAUSTED";

export const MAX_PUBLISH_RECOVERIES = 5;
const PUBLISH_STAGES = ["REVALIDATING", "TESTING", "BRANCH_PUSHED", "PR_CREATED", "PUBLISH_FAILED_RETRYABLE"];

/**
 * What to do with a repair job whose row has not changed for `ageMs` (for publication states: whose lease expired).
 * RUNNING rows that stopped moving belong to a worker that died; an APPROVED row that never started publishing
 * lost its queue message; a publication stage whose lease expired is resumed (bounded), never abandoned silently.
 */
export function classifyStaleRepairJob(
  status: string,
  ageMs: number,
  thresholds: { runningMs: number; approvedMs: number },
  publishAttempts = 0,
): StaleAction {
  if (status === "RUNNING" && ageMs > thresholds.runningMs) return "MARK_INTERRUPTED";
  if (status === "APPROVED" && ageMs > thresholds.approvedMs) return "REQUEUE_PUBLISH";
  if (PUBLISH_STAGES.includes(status)) return publishAttempts >= MAX_PUBLISH_RECOVERIES ? "BLOCK_PUBLISH_EXHAUSTED" : "REQUEUE_PUBLISH";
  return "NONE";
}
