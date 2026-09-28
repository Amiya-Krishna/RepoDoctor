import { prisma } from "../config/prisma.js";

import type { TestGenerationResult } from "../agents/test-generation.types.js";

export const saveGeneratedTests = async (
  analysisId: string,
  result: TestGenerationResult
) => {
  if (result.tests.length === 0) {
    return [];
  }

  await prisma.generatedTest.createMany({
    data: result.tests.map((test) => ({
      analysisId,

      title: test.title,

      description: test.description,

      type: test.type,

      filePath: test.filePath,

      targetFunction:
        test.targetFunction ?? null,

      testCode: test.testCode,

      rationale: test.rationale,

      confidence: test.confidence,
    })),
  });

  return prisma.generatedTest.findMany({
    where: {
      analysisId,
    },

    orderBy: {
      confidence: "desc",
    },
  });
};