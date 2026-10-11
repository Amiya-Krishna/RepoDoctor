import assert from "node:assert/strict";
import { enforceExecutionEvidence } from "./services/verification-gate.js";
import type { VerificationResult } from "./agents/verification.types.js";
import type { DockerTestResult } from "./execution/docker.types.js";

const verified: VerificationResult = {
  status: "VERIFIED",
  title: "Fix verified",
  summary: "Tests pass.",
  confidence: 0.95,
  evidence: ["all green"],
  reasoning: "ok",
  testPassed: true,
  regressionDetected: false,
};

const docker = (over: Partial<DockerTestResult>): DockerTestResult => ({
  success: true,
  exitCode: 0,
  stdout: "",
  stderr: "",
  durationMs: 10,
  timedOut: false,
  ...over,
});

// Passing run keeps VERIFIED untouched.
assert.deepEqual(enforceExecutionEvidence(verified, docker({})), verified);

// Non-zero exit code overrides a model VERIFIED -> FAILED.
const failed = enforceExecutionEvidence(verified, docker({ success: false, exitCode: 1 }));
assert.equal(failed.status, "FAILED");
assert.equal(failed.testPassed, false);
assert.match(failed.summary, /exited with code 1/);

// Timeout -> INCONCLUSIVE.
const timedOut = enforceExecutionEvidence(
  verified,
  docker({ success: false, exitCode: null, timedOut: true }),
);
assert.equal(timedOut.status, "INCONCLUSIVE");
assert.equal(timedOut.testPassed, false);

// Missing exit code -> INCONCLUSIVE even if success flag claims true.
assert.equal(
  enforceExecutionEvidence(verified, docker({ exitCode: null })).status,
  "INCONCLUSIVE",
);

// success=false with exit code 0 is contradictory -> not VERIFIED.
assert.notEqual(
  enforceExecutionEvidence(verified, docker({ success: false })).status,
  "VERIFIED",
);

// Non-VERIFIED verdicts are never upgraded, even when tests passed.
const notVerified = { ...verified, status: "FAILED" as const, testPassed: false };
assert.deepEqual(enforceExecutionEvidence(notVerified, docker({})), notVerified);

// Input is not mutated.
assert.equal(verified.status, "VERIFIED");

console.log("Verification gate tests passed.");
