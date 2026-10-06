import type { DockerTestResult } from "../../execution/docker.types.js";
import type { VerificationResult } from "../../agents/verification.types.js";

export interface ReplanningContext {
  attemptNumber: number;
  previousTestResult: DockerTestResult;
  previousVerification: VerificationResult;
}

export const buildReplanningContext = (
  context: ReplanningContext,
): string => {
  return [
    "Previous repair attempt failed.",
    `Attempt number: ${context.attemptNumber}`,
    "",
    "Previous Docker test result:",
    JSON.stringify(context.previousTestResult, null, 2),
    "",
    "Previous verification result:",
    JSON.stringify(context.previousVerification, null, 2),
    "",
    "Generate a new minimal repair.",
    "Do not repeat the same failed change.",
    "Use the failure evidence to improve the repair.",
  ].join("\n");
};