import { prisma } from "./config/prisma.js";

import {
  runAnalysisPipeline,
} from "./pipeline/analysis.pipeline.js";

const repositoryPath = process.argv[2];

if (!repositoryPath) {
  throw new Error(
    "Usage: npm run test:analysis-pipeline -- <repository-path>"
  );
}

const repositoryId =
  process.argv[3];

if (!repositoryId) {
  throw new Error(
    "Usage: npm run test:analysis-pipeline -- <repository-path> <repository-id>"
  );
}

const analysis =
  await prisma.analysis.create({
    data: {
      repositoryId,
      status: "PENDING",
    },
  });

console.log(
  `\nCreated analysis: ${analysis.id}`
);

try {
  const result =
    await runAnalysisPipeline({
      analysisId: analysis.id,
      repositoryId,
      repositoryPath,
    });

  console.log(
    "\n================================"
  );

  console.log(
    "UNIFIED ANALYSIS COMPLETE"
  );

  console.log(
    "================================\n"
  );

  console.log(
    `Analysis ID: ${result.analysisId}`
  );

  console.log(
    `Bugs: ${result.bugResult.findings.length}`
  );

  console.log(
    `Security findings: ${result.securityResult.findings.length}`
  );

  console.log(
    `Generated tests: ${result.testResult.tests.length}`
  );

  console.log(
    `Risk score: ${result.riskSummary.overallScore}`
  );

  console.log(
    `Risk level: ${result.riskSummary.level}`
  );

  console.log(
    `Priority: ${result.riskSummary.priority}`
  );

  console.log(
    `Critical findings: ${result.riskSummary.criticalFindings}`
  );

  console.log(
    `High findings: ${result.riskSummary.highFindings}`
  );

  console.log(
    `Medium findings: ${result.riskSummary.mediumFindings}`
  );

  console.log(
    `Low findings: ${result.riskSummary.lowFindings}`
  );
} catch (error) {
  console.error(
    "\nAnalysis failed:"
  );

  console.error(error);
} finally {
  await prisma.$disconnect();
}