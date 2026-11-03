/**
 * Pure decision logic for repair requests, approvals and publication.
 * No I/O: the controllers/workers feed it database facts, tests feed it fakes.
 */
import type { VerificationResult } from "../agents/verification.types.js";

export const ACTIVE_REPAIR_STATUSES = [
  "QUEUED", "RUNNING", "AWAITING_APPROVAL", "APPROVED", "PUBLISHING",
  "REVALIDATING", "TESTING", "BRANCH_PUSHED", "PR_CREATED", "PUBLISH_FAILED_RETRYABLE", "NEEDS_REAPPROVAL",
] as const;

/** Publication stages in which approval may still be revoked (nothing is on GitHub yet). */
export const REVOCABLE_STATUSES = ["APPROVED", "REVALIDATING", "TESTING"] as const;

export type RepairRequestDecision =
  | { ok: true }
  | { ok: false; status: 409; code: "REPAIR_ALREADY_ACTIVE" | "PULL_REQUEST_EXISTS"; message: string; existingJobId?: string; pullRequestUrl?: string };

export function decideRepairRequest(facts: {
  activeJob?: { id: string; status: string } | null;
  existingPullRequest?: { url: string } | null;
}): RepairRequestDecision {
  if (facts.existingPullRequest) {
    return {
      ok: false, status: 409, code: "PULL_REQUEST_EXISTS",
      message: "A pull request already exists for this finding.",
      pullRequestUrl: facts.existingPullRequest.url,
    };
  }
  if (facts.activeJob) {
    return {
      ok: false, status: 409, code: "REPAIR_ALREADY_ACTIVE",
      message: `A repair for this finding is already ${facts.activeJob.status.toLowerCase().replace(/_/g, " ")}.`,
      existingJobId: facts.activeJob.id,
    };
  }
  return { ok: true };
}

/**
 * Deterministic queue job id. Two concurrent requests for the same finding
 * and generation produce the same id, so the queue itself rejects the second
 * (the DB check above is the friendly path; this closes the race).
 */
export const repairQueueJobId = (analysisId: string, findingId: string, generation: number) =>
  `repair-${analysisId}-${findingId}-${generation}`;

export const publishQueueJobId = (repairJobId: string, generation = 0) => `publish-${repairJobId}-${generation}`;

export type ApprovalDecision =
  | { ok: true }
  | { ok: false; status: 403 | 404 | 409 | 422; message: string };

export function decideApproval(facts: {
  actorId: string;
  repositoryOwnerId: string | null;
  job: { status: string; verificationResultId?: string | null; fixProposalId?: string | null } | null;
}): ApprovalDecision {
  // Unknown job and someone else's job look identical to the caller (no existence oracle).
  if (!facts.job || facts.repositoryOwnerId === null || facts.repositoryOwnerId !== facts.actorId) {
    return { ok: false, status: 404, message: "Repair not found" };
  }
  if (facts.job.status !== "AWAITING_APPROVAL" && facts.job.status !== "NEEDS_REAPPROVAL") {
    return { ok: false, status: 409, message: `Only a verified repair that is awaiting approval can be approved (current status: ${facts.job.status}).` };
  }
  if (!facts.job.verificationResultId || !facts.job.fixProposalId) {
    return { ok: false, status: 422, message: "This repair has no stored verification evidence." };
  }
  return { ok: true };
}

export interface ReverificationEvidence {
  exitCode: number | null;
  timedOut: boolean;
  success: boolean;
}

/**
 * Last gate before anything is pushed. The stored verdict is not trusted on its
 * own: the patch was re-applied to a fresh clone and the tests were executed
 * again, and only that fresh execution evidence can authorise publication.
 */
export function decidePublication(
  stored: VerificationResult,
  rerun: ReverificationEvidence,
): { ok: true; verification: VerificationResult } | { ok: false; reason: string } {
  if (stored.status !== "VERIFIED") return { ok: false, reason: `Stored verification is ${stored.status}, not VERIFIED.` };
  if (stored.regressionDetected) return { ok: false, reason: "A regression was recorded for this repair." };
  if (!(rerun.success && rerun.exitCode === 0 && !rerun.timedOut)) {
    return {
      ok: false,
      reason: rerun.timedOut
        ? "Tests timed out when the patch was re-run before publishing."
        : `Tests did not pass when the patch was re-run before publishing (exit code ${rerun.exitCode ?? "none"}). The repository may have changed since verification.`,
    };
  }
  return {
    ok: true,
    verification: {
      ...stored,
      testPassed: true,
      evidence: [...stored.evidence, "Pre-publication re-run: tests passed (exit code 0) on a fresh clone with the approved patch applied."],
    },
  };
}
