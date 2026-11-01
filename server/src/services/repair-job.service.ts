import { prisma } from "../config/prisma.js";

export const createRepairJob = async (
  analysisId: string,
  findingId: string,
  extra: { testCommand?: string[]; workingDirectory?: string } = {},
) => {
  return prisma.repairJob.create({
    data: {
      analysisId,
      findingId,
      status: "RUNNING",
      currentAttempt: 0,
      maxAttempts: 3,
      ...(extra.testCommand ? { testCommand: extra.testCommand } : {}),
      ...(extra.workingDirectory ? { workingDirectory: extra.workingDirectory } : {}),
    },
  });
};

export const updateRepairJob = async (
  repairJobId: string,
  data: {
    status: string;
    currentAttempt?: number;
    errorMessage?: string | null;
    fixProposalId?: string | null;
    verificationResultId?: string | null;
    approvedAt?: Date | null;
    approvedBy?: string | null;
    pullRequestUrl?: string | null;
  },
) => {
  return prisma.repairJob.update({
    where: {
      id: repairJobId,
    },
    data,
  });
};

/**
 * Atomic compare-and-set on status. Returns true only for the caller that won
 * the transition, which is what makes approval and publication exactly-once
 * even if two requests or two workers race.
 */
export const transitionRepairJob = async (
  repairJobId: string,
  from: string,
  data: { status: string; approvedAt?: Date; approvedBy?: string; errorMessage?: string | null },
): Promise<boolean> => {
  const result = await prisma.repairJob.updateMany({
    where: { id: repairJobId, status: from },
    data,
  });
  return result.count === 1;
};
