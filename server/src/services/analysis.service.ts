import { prisma } from "../config/prisma.js";

export const saveAnalysis = async (
  repositoryId: string,
  snapshot: any,
  analysisId?: string,
  sourceRef?: string,
) => {
  const data = {
    status: "COMPLETED" as const,
    ...(sourceRef ? { sourceRef } : {}),
    projectType: snapshot.projectType,
    language: snapshot.language,
    packageManager: snapshot.packageManager,
    framework: snapshot.framework,
    testFramework: snapshot.testFramework,
    linter: snapshot.linter,
    hasTypeScript: snapshot.hasTypeScript,
    sourceFileCount: snapshot.sourceFileCount,
    testFileCount: snapshot.testFileCount,
    snapshot,
    completedAt: new Date(),
  };

  if (analysisId) {
    return prisma.analysis.update({
      where: { id: analysisId, repositoryId },
      data,
    });
  }

  return prisma.analysis.create({
    data: {
      repositoryId,
      ...data,
    },
  });
};
