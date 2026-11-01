import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

import { prisma } from "../config/prisma.js";
import { recordAudit } from "../audit/audit.service.js";
import { gitAuthEnvironment } from "../github/git-env.js";
import { revealToken } from "../security/token-encryption.js";
import { validateTestCommand } from "../security/test-command-policy.js";
import { createWorkspace, removeWorkspace } from "./workspace.service.js";
import { publishVerifiedRepairWithCleanup } from "./pull-request.service.js";
import { notifyUser } from "./notification.service.js";
import { transitionRepairJob, updateRepairJob } from "./repair-job.service.js";
import { createRepairWorkspace, removeRepairWorkspace } from "../repair/repair.workspace.js";
import { applyFixResult } from "../repair/repair.patch.js";
import { decidePublication } from "../repair/repair-guard.js";
import { installDependencies, removeDependencyVolumes, assertDockerAvailable, resolveWorkingDirectory, type DependencyVolume } from "../execution/docker.dependencies.js";
import { runDockerTest } from "../execution/docker.runner.js";
import type { FixResult } from "../agents/fix.types.js";
import type { VerificationResult } from "../agents/verification.types.js";

const execFileAsync = promisify(execFile);

export type PublishOutcome =
  | { status: "PUBLISHED"; pullRequestUrl: string; pullRequestNumber: number }
  | { status: "ALREADY_PUBLISHED"; pullRequestUrl: string }
  | { status: "SKIPPED"; reason: string }
  | { status: "BLOCKED"; reason: string };

/**
 * Publishes a repair the owner approved. Runs inside the repair worker only.
 *
 * Sequence: claim (APPROVED -> PUBLISHING, atomic) -> fresh clone -> apply the
 * stored patch (policy re-checked) -> install deps -> RE-RUN the tests in the
 * sandbox -> publish only if that fresh execution passed. Any failure leaves
 * the repository untouched and the job in a terminal, explained state.
 */
export async function publishApprovedRepair(input: { repairJobId: string; userId: string }): Promise<PublishOutcome> {
  const job = await prisma.repairJob.findUnique({
    where: { id: input.repairJobId },
    include: { analysis: { include: { repository: true } } },
  });

  if (!job || job.analysis.repository.userId !== input.userId) {
    await recordAudit({ eventType: "AUTHZ_DENIED", outcome: "DENIED", actorId: input.userId, repairJobId: input.repairJobId, details: { action: "publish" } });
    throw new Error("Repair not found for this account");
  }
  const repository = job.analysis.repository;
  const auditBase = { actorId: input.userId, repositoryId: repository.id, repairJobId: job.id };

  const existingPr = await prisma.pullRequest.findFirst({ where: { analysisId: job.analysisId, findingId: job.findingId } });
  if (existingPr) {
    await transitionRepairJob(job.id, job.status, { status: "PUBLISHED" });
    return { status: "ALREADY_PUBLISHED", pullRequestUrl: existingPr.pullRequestUrl };
  }

  // Exactly one worker wins this transition; a duplicate queue delivery stops here.
  if (!(await transitionRepairJob(job.id, "APPROVED", { status: "PUBLISHING" }))) {
    return { status: "SKIPPED", reason: `Repair is ${job.status}, not APPROVED.` };
  }

  const fail = async (status: string, reason: string, event: "PR_BLOCKED" = "PR_BLOCKED"): Promise<PublishOutcome> => {
    await updateRepairJob(job.id, { status, errorMessage: reason.slice(0, 900) });
    await recordAudit({ eventType: event, outcome: "DENIED", ...auditBase, details: { reason: reason.slice(0, 300) } });
    await notifyUser({
      userId: input.userId, type: "REPAIR_FAILED", severity: "WARNING", repositoryId: repository.id,
      title: "Pull request was not created",
      message: `${reason.slice(0, 600)} Nothing was pushed to your repository. You can run the repair again from the finding.`,
    });
    return { status: "BLOCKED", reason };
  };

  const command = validateTestCommand(job.testCommand);
  if (!command.ok) return fail("PUBLISH_BLOCKED", `Stored test command is not allowed: ${command.reason}`);
  if (!job.fixProposalId || !job.verificationResultId) return fail("PUBLISH_BLOCKED", "No stored verification evidence for this repair.");

  const [proposal, stored, user] = await Promise.all([
    prisma.fixProposal.findFirst({ where: { id: job.fixProposalId, analysisId: job.analysisId } }),
    prisma.verificationResult.findFirst({ where: { id: job.verificationResultId, analysisId: job.analysisId } }),
    prisma.user.findUnique({ where: { id: input.userId }, select: { githubAccessToken: true } }),
  ]);
  if (!proposal || !stored) return fail("PUBLISH_BLOCKED", "The stored patch or verification record is missing.");
  if (!user?.githubAccessToken) return fail("PUBLISH_BLOCKED", "GitHub connection is missing or expired. Reconnect GitHub and approve again.");
  const token = revealToken(user.githubAccessToken);

  const fix: FixResult = {
    title: proposal.title,
    summary: proposal.summary,
    changes: proposal.changes as unknown as FixResult["changes"],
    risk: proposal.risk as FixResult["risk"],
    confidence: proposal.confidence,
    reasoning: proposal.reasoning,
  };
  const verification: VerificationResult = {
    status: stored.status as VerificationResult["status"],
    title: stored.title,
    summary: stored.summary,
    confidence: stored.confidence,
    evidence: Array.isArray(stored.evidence) ? (stored.evidence as string[]) : [],
    reasoning: stored.reasoning,
    testPassed: stored.testPassed,
    regressionDetected: stored.regressionDetected,
  } as VerificationResult;

  const source = await createWorkspace();
  let workspaceRoot: string | undefined;
  let volumes: DependencyVolume[] = [];
  try {
    const sourcePath = path.join(source.path, "repository");
    await execFileAsync(
      "git",
      ["clone", "--depth", "1", "--branch", job.analysis.sourceRef || repository.defaultBranch, "--", repository.cloneUrl, sourcePath],
      { env: gitAuthEnvironment(token), timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
    );

    await assertDockerAvailable();
    const workingDirectory = await resolveWorkingDirectory(sourcePath, job.workingDirectory ?? undefined);

    const workspace = await createRepairWorkspace({ sourceRepositoryPath: sourcePath, analysisId: job.analysisId, findingId: job.id });
    workspaceRoot = workspace.rootPath;

    await applyFixResult(workspace.repositoryPath, fix);
    volumes = await installDependencies(workspace.repositoryPath);
    const rerun = await runDockerTest({
      repositoryPath: workspace.repositoryPath,
      nodeModulesVolumes: volumes,
      workingDirectory,
      testCommand: command.argv,
      environment: { REPO_DOCTOR_ATTEMPT: "publish" },
    });

    const decision = decidePublication(verification, rerun);
    if (!decision.ok) return fail("PUBLISH_BLOCKED", decision.reason);

    const saved = await publishVerifiedRepairWithCleanup(
      workspace,
      decision.verification,
      proposal.title,
      job.verificationResultId,
      job.analysisId,
      job.findingId,
      job.fixProposalId,
      { owner: repository.ownerLogin, repo: repository.name, token, baseBranch: repository.defaultBranch },
    );

    await updateRepairJob(job.id, { status: "PUBLISHED", pullRequestUrl: saved.pullRequestUrl, errorMessage: null });
    await recordAudit({ eventType: "PR_CREATED", outcome: "SUCCESS", ...auditBase, details: { pullRequestNumber: saved.pullRequestNumber } });
    await notifyUser({
      userId: input.userId, type: "PR_CREATED", repositoryId: repository.id,
      title: "Pull request created",
      message: `A verified fix was opened as pull request #${saved.pullRequestNumber}. RepoDoctor never merges; review it on GitHub.`,
    });
    return { status: "PUBLISHED", pullRequestUrl: saved.pullRequestUrl, pullRequestNumber: saved.pullRequestNumber };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error";
    return fail("PUBLISH_FAILED", `Publishing failed: ${reason}`);
  } finally {
    await removeDependencyVolumes(volumes);
    if (workspaceRoot) await removeRepairWorkspace(workspaceRoot);
    await removeWorkspace(source.path);
  }
}
