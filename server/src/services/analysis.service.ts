import { prisma } from "../config/prisma.js";

export const saveAnalysis = async (repositoryId: string, snapshot: any) => {
  return prisma.analysis.create({
    data: {
      repositoryId,

      status: "COMPLETED",

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
    },
  });
};
