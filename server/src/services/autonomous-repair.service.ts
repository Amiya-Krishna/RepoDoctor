import {
  runRepairRetryLoop,
} from "../repair/retry/repair.retry.service.js";

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

  const repairJob =
    await createRepairJob(
      input.analysisId,
      input.findingId,
    );

  try {
    const result =
      await runRepairRetryLoop(
        input.analysisId,
        input.repositoryId,
        input.findingId,
        input.finding,
        input.sourceRepositoryPath,
        input.testCommand,
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

    await updateRepairJob(
      repairJob.id,
      {
        status: result.status,
        currentAttempt,
      },
    );

    return {
      status: result.status,

      analysisId:
        input.analysisId,

      findingId:
        input.findingId,

      attempts:
        result.attempts,

      successfulAttempt:
        result.successfulAttempt,
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