import { prisma } from "./config/prisma.js";

import {
  runAutonomousRepair,
} from "./services/autonomous-repair.service.js";

const repositoryPath = process.argv[2];

if (!repositoryPath) {
  throw new Error(
    "Usage: npm run test:autonomous-repair -- <repository-path>",
  );
}

const finding = {
  title: "Calculator division behavior",
  description:
    "The calculator contains a division behavior that must be repaired.",
  category: "LOGIC" as const,
  severity: "MEDIUM" as const,
  filePath: "src/calculator.ts",
  lineStart: 1,
  lineEnd: 30,
  evidence:
    "Calculator behavior is incorrect for the supplied scenario.",
  suggestedFix:
    "Correct the calculator behavior with a minimal change.",
  confidence: 0.95,
};

const testCommand = [
  "node",
  "-e",
  `
const fs = require("node:fs");

const source =
  fs.readFileSync(
    "/workspace/repository/src/calculator.ts",
    "utf8",
  );

let executableSource = source
  .replaceAll(
    "export function",
    "function",
  )
  .replaceAll(
    ": number",
    "",
  )
  .replaceAll(
    ": boolean",
    "",
  );

executableSource +=
  "\\nmodule.exports = { divide, isEven };";

fs.writeFileSync(
  "/tmp/calculator.cjs",
  executableSource,
);

const {
  divide,
} = require("/tmp/calculator.cjs");

if (divide(10, 2) !== 5) {
  console.error(
    "DIVISION_TEST: normal division failed",
  );

  process.exit(1);
}

let divisionByZeroRejected = false;

try {
  divide(10, 0);
} catch {
  divisionByZeroRejected = true;
}

if (!divisionByZeroRejected) {
  console.error(
    "DIVISION_TEST: division by zero was not rejected",
  );

  process.exit(1);
}

console.log(
  "DIVISION_TEST: normal division passed",
);

console.log(
  "DIVISION_TEST: division by zero was rejected",
);
`,
];

const testUser = await prisma.user.create({
  data: {
    name: "RepoDoctor Test User",
    email: `repodoctor-test-${Date.now()}@example.com`,
    password: "test-password",
  },
});

const repository = await prisma.repository.create({
  data: {
    githubId: `repodoctor-test-${Date.now()}`,
    name: "test-generation-repo",
    fullName: "repodoctor/test-generation-repo",
    ownerLogin: "repodoctor",
    defaultBranch: "main",
    private: false,
    htmlUrl: "https://github.com/repodoctor/test-generation-repo",
    cloneUrl: "https://github.com/repodoctor/test-generation-repo.git",
    userId: testUser.id,
  },
});

const analysis = await prisma.analysis.create({
  data: {
    repositoryId: repository.id,
    status: "RUNNING",
    projectType: "Node.js",
    language: "TypeScript",
    packageManager: "npm",
    testFramework: "custom",
    hasTypeScript: true,
  },
});

const bugFinding = await prisma.bugFinding.create({
  data: {
    analysisId: analysis.id,
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
  },
});

try {
  const result = await runAutonomousRepair({
    analysisId: analysis.id,
    repositoryId: repository.id,
    findingId: bugFinding.id,
    finding,
    sourceRepositoryPath: repositoryPath,
    testCommand,
  });

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  const savedJob = await prisma.repairJob.findFirst({
    where: {
      analysisId: analysis.id,
    },
    include: {
      attemptHistory: {
        orderBy: {
          attemptNumber: "asc",
        },
      },
    },
  });

  console.log(
    "Persisted attempt history:",
    JSON.stringify(
      savedJob?.attemptHistory ?? [],
      null,
      2,
    ),
  );

  console.log(
    "Persisted attempt count:",
    savedJob?.attemptHistory.length ?? 0,
  );


} finally {
  await prisma.repairJob.deleteMany({
    where: {
      analysisId: analysis.id,
    },
  });

  await prisma.user.delete({
    where: {
      id: testUser.id,
    },
  });
}