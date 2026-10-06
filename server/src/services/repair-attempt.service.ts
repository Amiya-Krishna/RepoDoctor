import { prisma } from "../config/prisma.js";
import type { RetryAttemptStatus } from "../repair/retry/retry.types.js";

export const createRepairAttempt = async (
  analysisId: string,
  findingId: string,
  attemptNumber: number,
) => {
  return prisma.repairAttempt.create({
    data: {
      analysisId,
      findingId,
      attemptNumber,
      status: "STARTED",
    },
  });
};

export const updateRepairAttempt = async (
  attemptId: string,
  data: {
    status: RetryAttemptStatus;
    fixProposalId?: string;
    dockerTestRunId?: string;
    verificationResultId?: string;
    failureReason?: string;
  },
) => {
  return prisma.repairAttempt.update({
    where: {
      id: attemptId,
    },
    data,
  });
};