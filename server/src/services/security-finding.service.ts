import { prisma } from "../config/prisma.js";

import type {
  SecurityDetectionResult,
} from "../agents/security.types.js";

export const saveSecurityFindings = async (
  analysisId: string,
  result: SecurityDetectionResult
) => {
  if (result.findings.length === 0) {
    return [];
  }

  await prisma.securityFinding.createMany({
    data: result.findings.map(
      (finding) => ({
        analysisId,

        title: finding.title,
        description: finding.description,

        category: finding.category,
        severity: finding.severity,

        filePath: finding.filePath,
        lineStart: finding.lineStart,
        lineEnd: finding.lineEnd,

        evidence: finding.evidence,
        suggestedFix:
          finding.suggestedFix,

        confidence:
          finding.confidence,
      })
    ),
  });

  return prisma.securityFinding.findMany({
    where: {
      analysisId,
    },

    orderBy: {
      confidence: "desc",
    },
  });
};