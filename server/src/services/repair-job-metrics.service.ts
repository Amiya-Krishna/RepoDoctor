
import { prisma } from "../config/prisma.js";

export async function getRepairJobMetrics(analysisId: string) {
  if (!analysisId || !analysisId.trim()) {
    throw new Error("analysisId is required");
  }

  const groupedJobs = await prisma.repairJob.groupBy({
    by: ["status"],
    where: { analysisId },
    _count: { _all: true },
  });

  const statuses = groupedJobs.map((job) => ({
    status: job.status,
    count: job._count._all,
  }));

  const totalJobs = statuses.reduce(
    (total, item) => total + item.count,
    0,
  );

  return {
    analysisId,
    totalJobs,
    statuses,
  };
}
