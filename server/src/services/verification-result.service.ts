import {
  prisma,
} from "../config/prisma.js";

import type {
  VerificationResult,
} from "../agents/verification.types.js";

export const saveVerificationResult = async (
  analysisId: string,
  findingId: string,
  fixProposalId: string,
  result: VerificationResult,
) => {
  return prisma.verificationResult.create({
    data: {
      analysisId,
      findingId,
      fixProposalId,

      status:
        result.status,

      title:
        result.title,

      summary:
        result.summary,

      confidence:
        result.confidence,

      evidence:
        result.evidence,

      reasoning:
        result.reasoning,

      testPassed:
        result.testPassed,

      regressionDetected:
        result.regressionDetected,
    },
  });
};