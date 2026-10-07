import type {
  VerificationResult,
} from "../agents/verification.types.js";

export const buildRepairPullRequestBody = (
  verification: VerificationResult,
  findingTitle: string,
): string => {
  return [
    "## RepoDoctor Automated Repair",
    "",
    `### Finding`,
    findingTitle,
    "",
    "### Verification",
    `- Status: ${verification.status}`,
    `- Tests passed: ${verification.testPassed}`,
    `- Regression detected: ${verification.regressionDetected}`,
    `- Confidence: ${verification.confidence}`,
    "",
    "### Summary",
    verification.summary,
    "",
    "### Evidence",
    ...verification.evidence.map(
      (item) => `- ${item}`,
    ),
    "",
    "### Reasoning",
    verification.reasoning,
    "",
    "---",
    "",
    "This PR was generated only after isolated Docker-based verification.",
    "No automatic merge is performed by RepoDoctor.",
  ].join("\n");
};