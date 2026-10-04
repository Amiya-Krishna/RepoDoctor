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

  return agent.verify(
    finding,
    fixResult,
    testResult,
  );
};