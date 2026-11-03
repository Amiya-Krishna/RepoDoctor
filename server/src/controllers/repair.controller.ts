import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import {
  getAutonomousRepairQueueJob,
  queueAutonomousRepair,
  queuePublish,
} from "../queue/repair.queue.js";
import { validateTestCommand } from "../security/test-command-policy.js";
import { recordAudit } from "../audit/audit.service.js";
import { computePatchHash } from "../repair/patch-hash.js";
import type { FixChange } from "../agents/fix.types.js";
import {
  ACTIVE_REPAIR_STATUSES,
  REVOCABLE_STATUSES,
  decideApproval,
  decideRepairRequest,
  repairQueueJobId,
} from "../repair/repair-guard.js";
import { transitionRepairJob } from "../services/repair-job.service.js";

const uid = (req: Request) => (req as any).user.userId as string;

function validateWorkingDirectory(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 200 || value.includes("\0")) return null;
  const parts = value.replace(/\\/g, "/").split("/").filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === "..") || value.startsWith("/")) return null;
  return parts.join("/");
}

export const queueRepair = async (req: Request, res: Response) => {
  try {
    const userId = uid(req);
    const { analysisId, findingId } = req.body ?? {};
    const command = validateTestCommand(req.body?.testCommand);
    const workingDirectory = validateWorkingDirectory(req.body?.workingDirectory);

    if (typeof analysisId !== "string" || !analysisId.trim()
      || typeof findingId !== "string" || !findingId.trim()) {
      return res.status(400).json({ message: "analysisId and findingId are required" });
    }

    if (workingDirectory === null) {
      return res.status(400).json({ message: "workingDirectory must be a relative folder such as client" });
    }

    if (!command.ok) {
      await recordAudit({ eventType: "REPAIR_REJECTED", outcome: "DENIED", actorId: userId, details: { reason: command.reason } });
      return res.status(400).json({ message: command.reason, code: "TEST_COMMAND_NOT_ALLOWED" });
    }

    const analysis = await prisma.analysis.findFirst({
      where: { id: analysisId },
      include: { repository: { select: { id: true, userId: true } } },
    });

    // Same answer for "does not exist" and "belongs to someone else".
    if (!analysis || analysis.repository.userId !== userId) {
      if (analysis) await recordAudit({ eventType: "AUTHZ_DENIED", outcome: "DENIED", actorId: userId, details: { action: "repair", analysisId } });
      return res.status(404).json({ message: "Analysis not found" });
    }

    const [bugFinding, securityFinding] = await Promise.all([
      prisma.bugFinding.findFirst({ where: { id: findingId, analysisId }, select: { id: true } }),
      prisma.securityFinding.findFirst({ where: { id: findingId, analysisId }, select: { id: true } }),
    ]);

    if (!bugFinding && !securityFinding) {
      return res.status(404).json({ message: "Finding not found in this analysis" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { githubAccessToken: true },
    });
    if (!user?.githubAccessToken) {
      return res.status(400).json({ message: "Connect GitHub before starting a repair" });
    }

    // Duplicate prevention: one live repair and at most one pull request per finding.
    const [activeJob, existingPr, previousJobs] = await Promise.all([
      prisma.repairJob.findFirst({ where: { analysisId, findingId, status: { in: [...ACTIVE_REPAIR_STATUSES] } }, select: { id: true, status: true } }),
      prisma.pullRequest.findFirst({ where: { analysisId, findingId }, select: { pullRequestUrl: true } }),
      prisma.repairJob.count({ where: { analysisId, findingId } }),
    ]);
    const decision = decideRepairRequest({
      activeJob,
      existingPullRequest: existingPr ? { url: existingPr.pullRequestUrl } : null,
    });
    if (!decision.ok) return res.status(decision.status).json(decision);

    const queued = await queueAutonomousRepair(
      {
        userId,
        repositoryId: analysis.repository.id,
        analysisId,
        findingId,
        testCommand: command.argv,
        ...(workingDirectory ? { workingDirectory } : {}),
      },
      // Two simultaneous requests for the same finding get the same id; the queue accepts only one.
      repairQueueJobId(analysisId, findingId, previousJobs),
    );

    await recordAudit({ eventType: "REPAIR_QUEUED", outcome: "SUCCESS", actorId: userId, repositoryId: analysis.repository.id, details: { analysisId, findingId } });

    return res.status(202).json({
      message: "Autonomous repair queued",
      jobId: queued.jobId,
      analysisId,
      findingId,
      status: "QUEUED",
    });
  } catch (error) {
    console.error("Queue autonomous repair failed", error instanceof Error ? error.name : "unknown");
    return res.status(500).json({ message: "Unable to queue repair" });
  }
};

export const getRepairQueueStatus = async (req: Request, res: Response) => {
  try {
    const userId = uid(req);
    const jobId = req.params.jobId as string;
    if (!jobId?.trim()) return res.status(400).json({ message: "jobId is required" });

    const job = await getAutonomousRepairQueueJob(jobId);
    if (!job || job.data.userId !== userId) {
      return res.status(404).json({ message: "Repair job not found" });
    }

    return res.json({
      jobId: String(job.id),
      analysisId: job.data.analysisId,
      findingId: job.data.findingId,
      status: await job.getState(),
      progress: job.progress,
      result: job.returnvalue ?? null,
      failedReason: job.failedReason ?? null,
    });
  } catch (error) {
    console.error("Fetch repair queue status failed", error instanceof Error ? error.name : "unknown");
    return res.status(500).json({ message: "Unable to fetch repair status" });
  }
};

/** GET /api/repairs?analysisId=... — the owner's repair jobs for an analysis. */
export const listRepairs = async (req: Request, res: Response) => {
  const userId = uid(req);
  const analysisId = typeof req.query.analysisId === "string" ? req.query.analysisId : undefined;
  const jobs = await prisma.repairJob.findMany({
    where: { ...(analysisId ? { analysisId } : {}), analysis: { repository: { userId } } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, analysisId: true, findingId: true, status: true, currentAttempt: true, maxAttempts: true, errorMessage: true, pullRequestUrl: true, approvedAt: true, createdAt: true, updatedAt: true },
  });
  return res.json({ repairs: jobs });
};

const repositoryIdOf = (job: { analysis?: { repositoryId?: string } }) => job.analysis?.repositoryId ?? "";

/** GET /api/repairs/:repairJobId — report: patch before/after, test evidence, verification, limitations. */
export const getRepairReport = async (req: Request, res: Response) => {
  const userId = uid(req);
  const job = await prisma.repairJob.findFirst({
    where: { id: req.params.repairJobId as string, analysis: { repository: { userId } } },
    include: { attemptHistory: { orderBy: { attemptNumber: "asc" } }, analysis: { select: { repositoryId: true } } },
  });
  if (!job) return res.status(404).json({ message: "Repair not found" });

  const [proposal, verification, attempt] = await Promise.all([
    job.fixProposalId ? prisma.fixProposal.findFirst({ where: { id: job.fixProposalId, analysisId: job.analysisId } }) : null,
    job.verificationResultId ? prisma.verificationResult.findFirst({ where: { id: job.verificationResultId, analysisId: job.analysisId } }) : null,
    prisma.repairAttempt.findFirst({ where: { analysisId: job.analysisId, findingId: job.findingId, verificationResultId: job.verificationResultId ?? undefined }, orderBy: { createdAt: "desc" } }),
  ]);
  const testRun = attempt?.dockerTestRunId
    ? await prisma.dockerTestRun.findUnique({ where: { id: attempt.dockerTestRunId }, select: { success: true, exitCode: true, timedOut: true, durationMs: true, testCommand: true, stdout: true, stderr: true } })
    : null;

  return res.json({
    repair: {
      id: job.id, status: job.status, analysisId: job.analysisId, findingId: job.findingId,
      attempts: job.attemptHistory, errorMessage: job.errorMessage, pullRequestUrl: job.pullRequestUrl,
      approvedAt: job.approvedAt, baseCommitSha: job.baseCommitSha, branchName: job.branchName, pullRequestNumber: job.pullRequestNumber,
    },
    patch: proposal && {
      title: proposal.title, summary: proposal.summary, risk: proposal.risk, changes: proposal.changes,
      // What the owner approves: the hash is recomputed from the stored patch, never taken from the client.
      patchHash: computePatchHash(proposal.changes as unknown as FixChange[], repositoryIdOf(job)),
    },
    verification: verification && {
      status: verification.status, summary: verification.summary, confidence: verification.confidence,
      evidence: verification.evidence, reasoning: verification.reasoning,
      testPassed: verification.testPassed, regressionDetected: verification.regressionDetected,
    },
    testRun: testRun && { ...testRun, stdout: testRun.stdout.slice(-6000), stderr: testRun.stderr.slice(-6000) },
    limitations: [
      "Passing tests is evidence, not proof of correctness; the repository's own tests define what was checked.",
      "The model's opinion never overrides the test run: a VERIFIED result requires the sandboxed test command to exit 0.",
      "Before a pull request is opened the patch is re-applied to a fresh clone and the tests are run again.",
      "RepoDoctor never merges pull requests.",
    ],
  });
};

/**
 * POST /api/repairs/:repairJobId/approve  body: { patchHash }
 * The owner approves ONE exact patch (the hash shown in the report). If the stored patch no longer
 * hashes to that value, or differs from what was verified, nothing is approved.
 */
export const approveRepair = async (req: Request, res: Response) => {
  const userId = uid(req);
  const repairJobId = req.params.repairJobId as string;
  try {
    const job = await prisma.repairJob.findUnique({
      where: { id: repairJobId },
      include: { analysis: { select: { repository: { select: { id: true, userId: true } } } } },
    });

    const decision = decideApproval({
      actorId: userId,
      repositoryOwnerId: job?.analysis.repository.userId ?? null,
      job: job ? { status: job.status, verificationResultId: job.verificationResultId, fixProposalId: job.fixProposalId } : null,
    });
    if (!decision.ok) {
      if (job && job.analysis.repository.userId !== userId) {
        await recordAudit({ eventType: "AUTHZ_DENIED", outcome: "DENIED", actorId: userId, repairJobId, details: { action: "approve" } });
      }
      return res.status(decision.status).json({ message: decision.message });
    }

    const proposal = await prisma.fixProposal.findFirst({ where: { id: job!.fixProposalId!, analysisId: job!.analysisId } });
    if (!proposal) return res.status(422).json({ message: "This repair has no stored patch." });
    const currentHash = computePatchHash(proposal.changes as unknown as FixChange[], job!.analysis.repository.id);
    const submitted = typeof req.body?.patchHash === "string" ? req.body.patchHash : "";
    if (!submitted || submitted !== currentHash || (job!.patchHash && job!.patchHash !== currentHash)) {
      await recordAudit({ eventType: "PR_BLOCKED", outcome: "DENIED", actorId: userId, repositoryId: job!.analysis.repository.id, repairJobId, details: { action: "approve", reason: submitted ? "patch-hash-mismatch" : "patch-hash-missing" } });
      return res.status(409).json({ code: "PATCH_CHANGED", message: "The patch you reviewed is not the patch on record. Reload the report, review it, and approve again." });
    }
    if (!job!.baseCommitSha) {
      return res.status(422).json({ message: "This repair has no recorded repository state to approve against; run the repair again." });
    }

    // The approval itself must be on record; if auditing is down, nothing is approved.
    await recordAudit({ eventType: "PR_APPROVED", outcome: "SUCCESS", actorId: userId, repositoryId: job!.analysis.repository.id, repairJobId, details: { patchHash: currentHash.slice(0, 12) } }, { failClosed: true });

    if (!(await transitionRepairJob(repairJobId, job!.status, { status: "APPROVED", approvedAt: new Date(), approvedBy: userId, approvedPatchHash: currentHash, approvedBaseCommitSha: job!.baseCommitSha, errorMessage: null, publishLockedUntil: null }))) {
      return res.status(409).json({ message: "This repair was already approved or changed." });
    }
    // If queueing fails the APPROVED row is picked up by the recovery sweep; the approval is not lost.
    await queuePublish({ repairJobId, userId }, 0).catch((e) => console.error("publish enqueue failed; recovery will retry", e instanceof Error ? e.name : "unknown"));
    return res.status(202).json({ status: "APPROVED", message: "Approved. RepoDoctor will re-run the tests on a fresh clone and open the pull request if they still pass." });
  } catch {
    return res.status(500).json({ message: "Unable to approve this repair. Nothing was published." });
  }
};

/** POST /api/repairs/:repairJobId/revoke-approval — possible until a branch has been pushed. */
export const revokeApproval = async (req: Request, res: Response) => {
  const userId = uid(req);
  const job = await prisma.repairJob.findFirst({
    where: { id: req.params.repairJobId as string, analysis: { repository: { userId } } },
    select: { id: true, status: true, analysis: { select: { repositoryId: true } } },
  });
  if (!job) return res.status(404).json({ message: "Repair not found" });
  if (!(REVOCABLE_STATUSES as readonly string[]).includes(job.status)) {
    return res.status(409).json({ message: `Approval can no longer be revoked (status: ${job.status}).` });
  }
  const ok = await transitionRepairJob(job.id, job.status, { status: "APPROVAL_REVOKED", approvedAt: null, approvedBy: null, approvedPatchHash: null, publishLockedUntil: null });
  if (!ok) return res.status(409).json({ message: "The repair changed while revoking; check its status and try again." });
  await recordAudit({ eventType: "PR_BLOCKED", outcome: "DENIED", actorId: userId, repositoryId: job.analysis.repositoryId, repairJobId: job.id, details: { action: "approval-revoked" } });
  return res.json({ status: "APPROVAL_REVOKED" });
};

export const rejectRepair = async (req: Request, res: Response) => {
  const userId = uid(req);
  const job = await prisma.repairJob.findFirst({
    where: { id: req.params.repairJobId as string, analysis: { repository: { userId } } },
    select: { id: true },
  });
  if (!job) return res.status(404).json({ message: "Repair not found" });
  const ok = await transitionRepairJob(job.id, "AWAITING_APPROVAL", { status: "REJECTED" });
  return ok ? res.json({ status: "REJECTED" }) : res.status(409).json({ message: "This repair is no longer awaiting approval." });
};
