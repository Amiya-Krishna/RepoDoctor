import {
  runRepairRetryLoop,
} from "../repair/retry/repair.retry.service.js";
import type { RepairPublicationConfig } from "./pull-request.service.js";

import {
  createRepairJob,
  updateRepairJob,
} from "./repair-job.service.js";

import type {
  AutonomousRepairResult,
} from "./autonomous-repair.types.js";

import type {
  BugFinding,
} from "../agents/bug-detection.types.js";

import type {
  SecurityFinding,
} from "../agents/security.types.js";

import {
  assertDockerAvailable,
  assertTestCommandRunnable,
  resolveWorkingDirectory,
} from "../execution/docker.dependencies.js";

import { prisma } from "../config/prisma.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { computePatchHash, computePreImageHashes } from "../repair/patch-hash.js";
import type { FixChange } from "../agents/fix.types.js";

const execFileAsync = promisify(execFile);

async function captureApprovalBinding(repositoryId: string, fixProposalId: string, analysisId: string, sourceRepositoryPath: string) {
  const proposal = await prisma.fixProposal.findFirst({ where: { id: fixProposalId, analysisId } });
  if (!proposal) throw new Error("Verified fix proposal not found; cannot bind approval.");
  const changes = proposal.changes as unknown as FixChange[];
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: sourceRepositoryPath });
  return {
    patchHash: computePatchHash(changes, repositoryId),
    baseCommitSha: stdout.trim(),
    preImageHashes: await computePreImageHashes(sourceRepositoryPath, changes),
  };
}

import {
  saveRepairAttempt,
} from "./repair-job-history.service.js";

type RepairFinding =
  | BugFinding
  | SecurityFinding;

export interface AutonomousRepairInput {
  analysisId: string;
  repositoryId: string;
  findingId: string;

  finding: RepairFinding;

  sourceRepositoryPath: string;

  testCommand: string[];
  /** Folder (relative to the repository root) to run the test command in, e.g. "client". */
  workingDirectory?: string;
  publication?: RepairPublicationConfig;
  onProgress?: (stage: string, message: string, percent: number) => Promise<void> | void;
}

export const runAutonomousRepair = async (
  input: AutonomousRepairInput,
): Promise<AutonomousRepairResult> => {
  if (!input.analysisId) {
    throw new Error(
      "analysisId is required.",
    );
  }

  if (!input.repositoryId) {
    throw new Error(
      "repositoryId is required.",
    );
  }

  if (!input.findingId) {
    throw new Error(
      "findingId is required.",
    );
  }

  if (!input.sourceRepositoryPath) {
    throw new Error(
      "sourceRepositoryPath is required.",
    );
  }

  if (
    input.testCommand.length === 0
  ) {
    throw new Error(
      "testCommand cannot be empty.",
    );
  }

  // Fail early with a readable reason instead of burning AI attempts that
  // can never be verified.
  await assertDockerAvailable();
  const workingDirectory = await resolveWorkingDirectory(
    input.sourceRepositoryPath,
    input.workingDirectory,
  );
  await assertTestCommandRunnable(
    input.sourceRepositoryPath,
    input.testCommand,
    workingDirectory,
  );

  const repairJob =
    await createRepairJob(
      input.analysisId,
      input.findingId,
      { testCommand: input.testCommand, workingDirectory },
    );

  try {
    // Publication is deliberately NOT wired here: a verified repair stops at
    // AWAITING_APPROVAL and a pull request is created only after the owner
    // approves it (see publish-approved.service.ts).
    const result =
      await runRepairRetryLoop(
        input.analysisId,
        input.repositoryId,
        input.findingId,
        input.finding,
        input.sourceRepositoryPath,
        input.testCommand,
        undefined,
        input.onProgress,
        workingDirectory,
      );

    const currentAttempt =
      result.attempts.length;

      for (const attempt of result.attempts) {
      await saveRepairAttempt({
        repairJobId: repairJob.id,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        testPassed: attempt.status === "VERIFIED",
        verificationStatus:
          attempt.status === "VERIFIED"
            ? "VERIFIED"
            : attempt.status === "INCONCLUSIVE"
              ? "INCONCLUSIVE"
              : "NOT_VERIFIED",
        summary: attempt.summary,
      });
    }

    const winning = result.status === "VERIFIED"
      ? result.attempts.find((a) => a.attemptNumber === result.successfulAttempt)
      : undefined;
    const awaitingApproval = Boolean(winning?.fixProposalId && winning?.verificationResultId);

    // Bind the approval to this exact patch and repository state (hash of the stored proposal, HEAD of the
    // verified clone, and the pre-image of every touched file) so a later change invalidates the approval.
    const binding = awaitingApproval ? await captureApprovalBinding(input.repositoryId, winning!.fixProposalId!, input.analysisId, input.sourceRepositoryPath) : undefined;

    await updateRepairJob(
      repairJob.id,
      {
        status: awaitingApproval ? "AWAITING_APPROVAL" : result.status,
        currentAttempt,
        ...(awaitingApproval
          ? { fixProposalId: winning!.fixProposalId, verificationResultId: winning!.verificationResultId, ...binding }
          : {}),
      },
    );

    return {
      status: result.status,
      repairJobId: repairJob.id,

      analysisId:
        input.analysisId,

      findingId:
        input.findingId,

      attempts:
        result.attempts,

      successfulAttempt:
        result.successfulAttempt,
      pullRequest: result.pullRequest,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    await updateRepairJob(
      repairJob.id,
      {
        status: "ERROR",
        currentAttempt:
          0,
        errorMessage:
          message,
      },
    );

    throw error;
  }
};