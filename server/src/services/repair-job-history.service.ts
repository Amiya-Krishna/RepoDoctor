
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

export interface RepairJobHistoryQuery {
  analysisId?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}

export async function listRepairJobs(
  query: RepairJobHistoryQuery = {},
) {
  const limit = query.limit ?? 20;

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    throw new Error(
      "limit must be an integer between 1 and 50",
    );
  }

  if (query.cursor !== undefined && !query.cursor.trim()) {
    throw new Error("cursor cannot be empty");
  }

  if (query.analysisId !== undefined && !query.analysisId.trim()) {
    throw new Error("analysisId cannot be empty");
  }

  if (query.status !== undefined && !query.status.trim()) {
    throw new Error("status cannot be empty");
  }

  const where = {
    ...(query.analysisId
      ? { analysisId: query.analysisId }
      : {}),
    ...(query.status
      ? { status: query.status }
      : {}),
  };

  const jobs = await prisma.repairJob.findMany({
    where,
    take: limit + 1,
    ...(query.cursor
      ? {
          cursor: { id: query.cursor },
          skip: 1,
        }
      : {}),
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ],
    select: {
      id: true,
      analysisId: true,
      findingId: true,
      status: true,
      currentAttempt: true,
      maxAttempts: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
      attemptHistory: {
        orderBy: { attemptNumber: "desc" },
        take: 3,
        select: {
          attemptNumber: true,
          status: true,
          testPassed: true,
          verificationStatus: true,
          summary: true,
          durationMs: true,
          createdAt: true,
        },
      },
    },
  });

  const hasMore = jobs.length > limit;
  const items = hasMore
    ? jobs.slice(0, limit)
    : jobs;

  return {
    items,
    page: {
      limit,
      hasMore,
      nextCursor: hasMore
        ? items[items.length - 1]?.id ?? null
        : null,
    },
  };
}
