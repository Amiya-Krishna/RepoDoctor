import type {
  AIProvider,
} from "../ai/ai.provider.js";

import type {
  BugFinding,
} from "./bug-detection.types.js";

import type {
  SecurityFinding,
} from "./security.types.js";

import type {
  FixResult,
} from "./fix.types.js";

import type {
  DockerTestResult,
} from "../execution/docker.types.js";

import type {
  VerificationResult,
} from "./verification.types.js";

import {
  VERIFICATION_JSON_SCHEMA,
} from "./verification.schema.js";

import {
  VERIFICATION_SYSTEM_PROMPT,
} from "../prompts/verification.prompt.js";

type VerificationFinding =
  | BugFinding
  | SecurityFinding;

export class VerificationAgent {
  constructor(
    private readonly aiProvider: AIProvider,
  ) {}

  async verify(
    finding: VerificationFinding,
    fixResult: FixResult,
    testResult: DockerTestResult,
  ): Promise<VerificationResult> {
    const userPrompt = this.buildUserPrompt(
      finding,
      fixResult,
      testResult,
    );

    const result =
      await this.aiProvider.generateStructured<VerificationResult>(
        VERIFICATION_SYSTEM_PROMPT,
        userPrompt,
        VERIFICATION_JSON_SCHEMA,
      );

    this.validateResult(result);

    return result;
  }

  private buildUserPrompt(
    finding: VerificationFinding,
    fixResult: FixResult,
    testResult: DockerTestResult,
  ): string {
    return `
FINDING

${JSON.stringify(finding, null, 2)}

PROPOSED FIX

${JSON.stringify(fixResult, null, 2)}

DOCKER TEST EXECUTION RESULT

${JSON.stringify(testResult, null, 2)}

Determine whether the proposed fix is supported by the execution evidence.
`;
  }

  private validateResult(
    result: VerificationResult,
  ): void {
    if (!result) {
      throw new Error(
        "Verification Agent returned no result.",
      );
    }

    const validStatuses = [
      "VERIFIED",
      "FAILED",
      "INCONCLUSIVE",
      "ERROR",
    ];

    if (
      !validStatuses.includes(
        result.status,
      )
    ) {
      throw new Error(
        `Invalid verification status: ${result.status}`,
      );
    }

    if (
      typeof result.title !== "string" ||
      result.title.trim().length === 0
    ) {
      throw new Error(
        "Verification result title is required.",
      );
    }

    if (
      typeof result.summary !== "string" ||
      result.summary.trim().length === 0
    ) {
      throw new Error(
        "Verification result summary is required.",
      );
    }

    if (
      typeof result.reasoning !== "string"
    ) {
      throw new Error(
        "Verification reasoning is required.",
      );
    }

    if (
      !Array.isArray(result.evidence)
    ) {
      throw new Error(
        "Verification evidence must be an array.",
      );
    }

    if (
      typeof result.confidence !== "number" ||
      result.confidence < 0 ||
      result.confidence > 1
    ) {
      throw new Error(
        "Verification confidence must be between 0 and 1.",
      );
    }

    if (
      typeof result.testPassed !== "boolean"
    ) {
      throw new Error(
        "testPassed must be boolean.",
      );
    }

    if (
      typeof result.regressionDetected !==
      "boolean"
    ) {
      throw new Error(
        "regressionDetected must be boolean.",
      );
    }

    if (
      result.status === "VERIFIED" &&
      !result.testPassed
    ) {
      throw new Error(
        "VERIFIED result must have testPassed=true.",
      );
    }

    if (
      result.status === "FAILED" &&
      result.testPassed
    ) {
      throw new Error(
        "FAILED result cannot have testPassed=true.",
      );
    }
  }
}