import { prisma } from "../config/prisma.js";

export const createRepairJob = async (
  analysisId: string,
  findingId: string,
) => {
  return prisma.repairJob.create({
    data: {
      analysisId,
      findingId,
      status: "RUNNING",
      currentAttempt: 0,
      maxAttempts: 3,
    },
  });
};

export const updateRepairJob = async (
  repairJobId: string,
  data: {
    status: string;
    currentAttempt?: number;
    errorMessage?: string | null;
  },
) => {
  return prisma.repairJob.update({
    where: {
      id: repairJobId,
    },
    data,
  });
};