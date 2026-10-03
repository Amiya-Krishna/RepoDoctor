import { prisma } from "../config/prisma.js";

import type { FixResult } from "../agents/fix.types.js";

export const saveFixProposal = async (
  analysisId: string,
  findingId: string,
  source: "BUG" | "SECURITY",
  result: FixResult
) => {
  return prisma.fixProposal.create({
    data: {
      analysisId,

      findingId,

      source,

      title: result.title,

      summary: result.summary,

      risk: result.risk,

      confidence: result.confidence,

      reasoning: result.reasoning,

      changes: JSON.parse(
        JSON.stringify(result.changes)
      ),

      status: "PROPOSED",
    },
  });
};