import { prisma } from "../config/prisma.js";

import type {
  EvaluatedFinding,
} from "../risk/risk.engine.js";

export const saveRiskAssessments = async (
  analysisId: string,
  findings: EvaluatedFinding[]
) => {
  if (findings.length === 0) {
    return [];
  }

  await prisma.riskAssessment.createMany({
    data: findings.map((finding) => ({
      analysisId,

      findingId: finding.id,

      source: finding.source,

      score: finding.risk.score,

      level: finding.risk.level,

      priority: finding.risk.priority,

      factors: finding.risk.factors,
    })),
  });

  return prisma.riskAssessment.findMany({
    where: {
      analysisId,
    },

    orderBy: {
      score: "desc",
    },
  });
};