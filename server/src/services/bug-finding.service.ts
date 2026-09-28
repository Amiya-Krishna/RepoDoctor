import { prisma } from "../config/prisma.js";
import type { BugDetectionResult } from "../agents/bug-detection.types.js";

export const saveBugFindings = async (
  analysisId: string,
  result: BugDetectionResult
) => {
  if (result.findings.length === 0) {
    return [];
  }

  await prisma.bugFinding.createMany({
    data: result.findings.map((finding) => ({
      analysisId,

      title: finding.title,
      description: finding.description,

      category: finding.category,
      severity: finding.severity,

      filePath: finding.filePath,
      lineStart: finding.lineStart,
      lineEnd: finding.lineEnd,

      evidence: finding.evidence,
      suggestedFix: finding.suggestedFix,

      confidence: finding.confidence,
    })),
  });

  return prisma.bugFinding.findMany({
    where: {
      analysisId,
    },
    orderBy: {
      confidence: "desc",
    },
  });
};