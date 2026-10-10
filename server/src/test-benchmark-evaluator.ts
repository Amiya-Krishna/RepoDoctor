
import assert from "node:assert/strict";
import { evaluateBenchmark } from "./benchmark/benchmark-evaluator.js";

const truth = {
  datasetName: "Evaluator test",
  version: "1.0",
  findings: [
    {
      id: "BUG-1",
      filePath: "src/user.ts",
      category: "null_handling",
    },
    {
      id: "SEC-1",
      filePath: "src/admin.ts",
      category: "authorization",
    },
  ],
};

const run = {
  runId: "test-run-001",
  startedAt: "2026-10-10T10:00:00.000Z",
  completedAt: "2026-10-10T10:00:10.000Z",
  findings: [
    {
      filePath: "src\\user.ts",
      category: "Null Handling",
    },
    {
      filePath: "src/unknown.ts",
      category: "sql_injection",
    },
  ],
  repairs: [
    {
      caseId: "BUG-1",
      attempted: true,
      testsPassed: true,
      verified: true,
      prCreated: true,
      attempts: 1,
      durationMs: 1000,
    },
    {
      caseId: "SEC-1",
      attempted: true,
      testsPassed: false,
      verified: false,
      prCreated: false,
      attempts: 3,
      durationMs: 3000,
    },
  ],
};

const report = evaluateBenchmark(truth, run);

assert.equal(report.detection.truePositives, 1);
assert.equal(report.detection.falsePositives, 1);
assert.equal(report.detection.falseNegatives, 1);

assert.equal(report.detection.precision, 0.5);
assert.equal(report.detection.recall, 0.5);
assert.equal(report.detection.f1, 0.5);

assert.equal(report.repair.attempted, 2);
assert.equal(report.repair.verified, 1);
assert.equal(report.repair.testsPassed, 1);
assert.equal(report.repair.pullRequestsCreated, 1);
assert.equal(report.repair.verificationRate, 0.5);
assert.equal(report.repair.testPassRate, 0.5);
assert.equal(report.repair.prCreationRate, 1);
assert.equal(report.repair.averageAttempts, 2);
assert.equal(report.repair.averageRepairDurationMs, 2000);

assert.equal(report.runtime.elapsedMs, 10_000);

assert.throws(
  () => evaluateBenchmark(truth, { ...run, runId: "" }),
  /runId is required/,
);

console.log("Benchmark evaluator tests passed.");
