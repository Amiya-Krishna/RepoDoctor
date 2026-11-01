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

export type StaleAction = "NONE" | "MARK_INTERRUPTED" | "MARK_PUBLISH_INTERRUPTED" | "REQUEUE_PUBLISH";

/**
 * What to do with a repair job whose row has not changed for `ageMs`.
 * RUNNING/PUBLISHING rows that stopped moving belong to a worker that died;
 * an APPROVED row that never started publishing lost its queue message.
 */
export function classifyStaleRepairJob(status: string, ageMs: number, thresholds: { runningMs: number; approvedMs: number }): StaleAction {
  if (status === "RUNNING" && ageMs > thresholds.runningMs) return "MARK_INTERRUPTED";
  if (status === "PUBLISHING" && ageMs > thresholds.runningMs) return "MARK_PUBLISH_INTERRUPTED";
  if (status === "APPROVED" && ageMs > thresholds.approvedMs) return "REQUEUE_PUBLISH";
  return "NONE";
}
