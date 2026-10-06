import { prisma } from "./config/prisma.js";
import { runRepairRetryLoop } from "./services/repair.retry.service.js";

const repositoryPath = process.argv[2];

if (!repositoryPath) {
  throw new Error('Usage: npm run test:repair-retry -- "repository-path"');
}

const analysis = await prisma.analysis.findFirst({
  orderBy: {
    createdAt: "desc",
  },
});

if (!analysis) {
  throw new Error(
    "No Analysis record found in database. Run an analysis first.",
  );
}

const analysisId = analysis.id;
const repositoryId = analysis.repositoryId;

const findingId = `day19-finding-${Date.now()}`;

const finding = {
  title: "Calculator division bug",

  description: "The divide function does not safely handle division by zero.",

  category: "LOGIC" as const,

  severity: "MEDIUM" as const,

  filePath: "src/calculator.ts",

  lineStart: 1,

  lineEnd: 20,

  evidence:
    "The divide function currently performs direct division without validating the divisor.",

  suggestedFix: "Handle division by zero explicitly.",

  confidence: 0.9,
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

/*
 * Day 19 acceptance-test control.
 *
 * Attempt 1 deliberately fails AFTER executing
 * the real behavioral test. This proves that the
 * retry loop creates a new attempt and replans.
 *
 * This condition exists only in this test harness.
 */
`,
];

console.log("\n================================");
console.log("DAY 19 REPAIR RETRY TEST");
console.log("================================\n");

console.log(`Analysis: ${analysisId}`);
console.log(`Repository: ${repositoryId}`);
console.log(`Finding: ${findingId}`);

const result = await runRepairRetryLoop(
  analysisId,
  repositoryId,
  findingId,
  finding,
  repositoryPath,
  testCommand,
);

console.log("\n================================");

if (result.status === "VERIFIED") {
  console.log("Repair completed");
  console.log(`Successful attempt: ${result.successfulAttempt}`);
} else {
  console.log(`Repair result: ${result.status}`);
}

console.log("================================\n");

console.log(JSON.stringify(result, null, 2));

await prisma.$disconnect();
