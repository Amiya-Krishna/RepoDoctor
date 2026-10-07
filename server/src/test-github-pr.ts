import {
  publishVerifiedRepair,
} from "./services/pull-request.service.js";

import type {
  RepairWorkspace,
} from "./repair/repair.types.js";

import type {
  VerificationResult,
} from "./agents/verification.types.js";

const workspace: RepairWorkspace = {
  id: "day20-test",

  rootPath:
    "C:\\invalid-test-workspace",

  repositoryPath:
    "C:\\invalid-test-workspace\\repository",

  branchName:
    "repodoctor/test/day20",
};

const verification: VerificationResult = {
  status: "INCONCLUSIVE",

  title: "Insufficient evidence",

  summary:
    "The test evidence is insufficient.",

  confidence: 0.4,

  evidence: [
    "Synthetic test intentionally used.",
  ],

  reasoning:
    "Day 20 must reject insufficient verification.",

  testPassed: false,

  regressionDetected: false,
};

try {
  await publishVerifiedRepair(
    workspace,
    verification,
    "test: unsafe PR",
    "This PR must never be created.",
  );

  throw new Error(
    "SECURITY TEST FAILED: PR was allowed.",
  );
} catch (error) {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.log(
    "Expected rejection:",
  );

  console.log(message);
}