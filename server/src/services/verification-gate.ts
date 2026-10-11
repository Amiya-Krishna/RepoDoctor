import type { VerificationResult } from "../agents/verification.types.js";
import type { DockerTestResult } from "../execution/docker.types.js";

/**
 * Deterministic guard applied after the verification model has answered.
 *
 * A model verdict of VERIFIED is only accepted when the Docker run itself
 * reports success: exit code 0, no timeout. Anything else is downgraded, so a
 * pull request can never be published on the strength of the model alone.
 * Verdicts other than VERIFIED are never upgraded.
 */
export const enforceExecutionEvidence = (
  result: VerificationResult,
  testResult: DockerTestResult,
): VerificationResult => {
  if (result.status !== "VERIFIED") {
    return result;
  }

  const executionPassed =
    testResult.success === true &&
    testResult.exitCode === 0 &&
    !testResult.timedOut;

  if (executionPassed) {
    return result;
  }

  const inconclusive = testResult.timedOut || testResult.exitCode === null;
  const detail = testResult.timedOut
    ? "the test run timed out"
    : testResult.exitCode === null
      ? "the test run did not report an exit code"
      : `the test run exited with code ${testResult.exitCode}`;

  return {
    ...result,
    status: inconclusive ? "INCONCLUSIVE" : "FAILED",
    testPassed: false,
    summary: `Verification downgraded: ${detail}. ${result.summary}`,
    evidence: [
      ...result.evidence,
      `Execution gate: ${detail}; a model verdict cannot override the test result.`,
    ],
  };
};
