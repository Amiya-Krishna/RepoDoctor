
import { prisma } from "../config/prisma.js";

export interface SaveRepairAttemptInput {
  repairJobId: string;
  attemptNumber: number;
  status: string;
  testPassed: boolean;
  verificationStatus: string;
  summary: string;
  durationMs?: number;
}

export async function saveRepairAttempt(
  input: SaveRepairAttemptInput,
) {
  if (
    !Number.isInteger(input.attemptNumber) ||
    input.attemptNumber < 1
  ) {
    throw new Error("attemptNumber must be a positive integer");
  }

  if (
    !Number.isFinite(input.durationMs ?? 0) ||
    (input.durationMs !== undefined && input.durationMs < 0)
  ) {
    throw new Error("durationMs must be non-negative");
  }

  const job = await prisma.repairJob.findUnique({
    where: { id: input.repairJobId },
    select: { id: true },
  });

  if (!job) {
    throw new Error("Repair job not found");
  }

  return prisma.repairJobAttempt.upsert({
    where: {
      repairJobId_attemptNumber: {
        repairJobId: input.repairJobId,
        attemptNumber: input.attemptNumber,
      },
    },
    create: {
      repairJobId: input.repairJobId,
      attemptNumber: input.attemptNumber,
      status: input.status,
      testPassed: input.testPassed,
      verificationStatus: input.verificationStatus,
      summary: input.summary,
      durationMs: input.durationMs,
    },
    update: {
      status: input.status,
      testPassed: input.testPassed,
      verificationStatus: input.verificationStatus,
      summary: input.summary,
      durationMs: input.durationMs,
    },
  });
}

export async function getRepairJobHistory(
  repairJobId: string,
) {
  return prisma.repairJob.findUnique({
    where: { id: repairJobId },
    include: {
      attemptHistory: {
        orderBy: { attemptNumber: "asc" },
      },
    },
  });
}
