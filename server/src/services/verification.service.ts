import {
  createAIProvider,
} from "../ai/ai.provider.factory.js";

import {
  VerificationAgent,
} from "../agents/verification.agent.js";

import type {
  BugFinding,
} from "../agents/bug-detection.types.js";

import type {
  SecurityFinding,
} from "../agents/security.types.js";

import type {
  FixResult,
} from "../agents/fix.types.js";

import type {
  DockerTestResult,
} from "../execution/docker.types.js";

import type {
  VerificationResult,
} from "../agents/verification.types.js";

import { enforceExecutionEvidence } from "./verification-gate.js";

type VerificationFinding =
  | BugFinding
  | SecurityFinding;

export const verifyFix = async (
  finding: VerificationFinding,
  fixResult: FixResult,
  testResult: DockerTestResult,
): Promise<VerificationResult> => {
  const aiProvider =
    createAIProvider();

  const agent =
    new VerificationAgent(
      aiProvider,
    );

  const verdict = await agent.verify(
    finding,
    fixResult,
    testResult,
  );

  // The Docker result, not the model, has the final say on VERIFIED.
  return enforceExecutionEvidence(verdict, testResult);
};