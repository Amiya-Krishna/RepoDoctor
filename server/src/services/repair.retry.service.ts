import { FixAgent } from "../agents/fix.agent.js";
import { createAIProvider } from "../ai/ai.provider.factory.js";
import { saveDockerTestResult } from "./docker-test-result.service.js";
import { saveFixProposal } from "./fix-proposal.service.js";
import {
  createRepairAttempt,
  updateRepairAttempt,
} from "./repair-attempt.service.js";
import { saveVerificationResult } from "./verification-result.service.js";
import { verifyFix } from "./verification.service.js";

import { buildRepositoryContext } from "../context/context.builder.js";
import { formatRepositoryContext } from "../context/context.formatter.js";

import {
  createRepairWorkspace,
  removeRepairWorkspace,
} from "../repair/repair.workspace.js";

import { applyFixResult } from "../repair/repair.patch.js";

import { runDockerTest } from "../execution/docker.runner.js";

import {
  DEFAULT_RETRY_POLICY,
  canRetry,
} from "../repair/retry/retry.policy.js";

import { buildReplanningContext } from "../repair/retry/retry.replanner.js";

import type { BugFinding } from "../agents/bug-detection.types.js";
import type { SecurityFinding } from "../agents/security.types.js";
import type { VerificationResult } from "../agents/verification.types.js";
import type { DockerTestResult } from "../execution/docker.types.js";
import type {
  RetryAttemptResult,
  RetryLoopResult,
} from "../repair/retry/retry.types.js";

type Finding = BugFinding | SecurityFinding;

export const runRepairRetryLoop = async (
  analysisId: string,
  repositoryId: string,
  findingId: string,
  finding: Finding,
  sourceRepositoryPath: string,
  testCommand: string[],
): Promise<RetryLoopResult> => {
  const aiProvider = createAIProvider();
  const fixAgent = new FixAgent(aiProvider);

  const attempts: RetryAttemptResult[] = [];

  let previousTestResult: DockerTestResult | undefined;
  let previousVerification: VerificationResult | undefined;

  for (
    let attemptNumber = 1;
    attemptNumber <= DEFAULT_RETRY_POLICY.maxAttempts;
    attemptNumber++
  ) {
    const attempt = await createRepairAttempt(
      analysisId,
      findingId,
      attemptNumber,
    );

    let workspace;

    try {
      /*
       * Every retry receives a completely new workspace.
       */
      workspace = await createRepairWorkspace({
        sourceRepositoryPath,
        analysisId,
        findingId: `${findingId}-attempt-${attemptNumber}`,
      });

      /*
       * Build context from the isolated workspace,
       * never from the original repository.
       */
      const repositoryContext = await buildRepositoryContext(
        workspace.repositoryPath,
        repositoryId,
      );

      const formattedContext = formatRepositoryContext(repositoryContext);

      /*
       * Replanning information is included only after
       * a previous attempt exists.
       */
      let retryFinding = finding;

      if (previousTestResult && previousVerification) {
        const replanningContext = buildReplanningContext({
          attemptNumber,
          previousTestResult,
          previousVerification,
        });

        retryFinding = {
          ...finding,
          description: [
            finding.description,
            "",
            "RETRY / REPLANNING CONTEXT:",
            replanningContext,
          ].join("\n"),
        };
      }

      /*
       * Generate a fix proposal.
       *
       * Attempt 1:
       *   Original finding is used.
       *
       * Attempt 2+:
       *   Original finding + previous failure evidence is used.
       */
      const fixResult = await fixAgent.generateFix(
        retryFinding,
        repositoryContext,
        formattedContext,
      );

      const source =
        "category" in finding &&
        [
          "SECRET_EXPOSURE",
          "INJECTION",
          "AUTHENTICATION",
          "AUTHORIZATION",
          "CRYPTOGRAPHY",
          "INPUT_VALIDATION",
          "PATH_TRAVERSAL",
          "SSRF",
          "COMMAND_EXECUTION",
          "DATA_EXPOSURE",
          "INSECURE_CONFIGURATION",
          "DEPENDENCY",
        ].includes(finding.category)
          ? "SECURITY"
          : "BUG";

      const proposal = await saveFixProposal(
        analysisId,
        findingId,
        source,
        fixResult,
      );

      await updateRepairAttempt(attempt.id, {
        status: "STARTED",
        fixProposalId: proposal.id,
      });

      /*
       * Apply the proposed change ONLY inside the
       * disposable repair workspace.
       */
      await applyFixResult(workspace.repositoryPath, fixResult);

      /*
       * Execute tests through Docker.
       */
      const testResult = await runDockerTest({
        repositoryPath: workspace.repositoryPath,
        testCommand,
        environment: {
          REPO_DOCTOR_ATTEMPT: String(attemptNumber),
        },
      });

      const dockerTestRun = await saveDockerTestResult(
        workspace.repositoryPath,
        testCommand,
        testResult,
      );

      /*
       * Persist actual execution evidence.
       */
      await updateRepairAttempt(attempt.id, {
        status: testResult.success ? "STARTED" : "TEST_FAILED",
        fixProposalId: proposal.id,
        dockerTestRunId: dockerTestRun.id,
        failureReason: testResult.success ? undefined : testResult.stderr,
      });

      /*
       * Verification receives the actual Docker result.
       */
      const verification = await verifyFix(finding, fixResult, testResult);

      const verificationRecord = await saveVerificationResult(
        analysisId,
        findingId,
        proposal.id,
        verification,
      );

      /*
       * VERIFIED is the only successful terminal state.
       */
      if (verification.status === "VERIFIED") {
        await updateRepairAttempt(attempt.id, {
          status: "VERIFIED",
          fixProposalId: proposal.id,
          dockerTestRunId: dockerTestRun.id,
          verificationResultId: verificationRecord.id,
        });

        attempts.push({
          attemptNumber,
          status: "VERIFIED",
          fixProposalId: proposal.id,
          dockerTestRunId: dockerTestRun.id,
          verificationResultId: verificationRecord.id,
          summary: verification.summary,
        });

        return {
          status: "VERIFIED",
          attempts,
          successfulAttempt: attemptNumber,
        };
      }

      /*
       * INCONCLUSIVE is deliberately NOT treated as success.
       * We also do not automatically retry it because
       * there is insufficient evidence.
       */
      if (verification.status === "INCONCLUSIVE") {
        await updateRepairAttempt(attempt.id, {
          status: "INCONCLUSIVE",
          fixProposalId: proposal.id,
          dockerTestRunId: dockerTestRun.id,
          verificationResultId: verificationRecord.id,
          failureReason: verification.summary,
        });

        attempts.push({
          attemptNumber,
          status: "INCONCLUSIVE",
          fixProposalId: proposal.id,
          dockerTestRunId: dockerTestRun.id,
          verificationResultId: verificationRecord.id,
          summary: verification.summary,
        });

        return {
          status: "INCONCLUSIVE",
          attempts,
        };
      }

      /*
       * FAILED or ERROR becomes replanning evidence.
       */
      await updateRepairAttempt(attempt.id, {
        status:
          verification.status === "FAILED" ? "VERIFICATION_FAILED" : "ERROR",
        fixProposalId: proposal.id,
        dockerTestRunId: dockerTestRun.id,
        verificationResultId: verificationRecord.id,
        failureReason: verification.summary,
      });

      attempts.push({
        attemptNumber,
        status:
          verification.status === "FAILED" ? "VERIFICATION_FAILED" : "ERROR",
        fixProposalId: proposal.id,
        dockerTestRunId: dockerTestRun.id,
        verificationResultId: verificationRecord.id,
        summary: verification.summary,
      });

      previousTestResult = testResult;
      previousVerification = verification;

      /*
       * Hard retry limit.
       */
      if (!canRetry(attemptNumber, DEFAULT_RETRY_POLICY)) {
        return {
          status: "MAX_RETRIES_REACHED",
          attempts,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await updateRepairAttempt(attempt.id, {
        status: "ERROR",
        failureReason: message,
      });

      attempts.push({
        attemptNumber,
        status: "ERROR",
        summary: message,
      });

      return {
        status: "ERROR",
        attempts,
      };
    } finally {
      /*
       * NEVER retain the disposable repair workspace.
       */
      if (workspace) {
        await removeRepairWorkspace(workspace.rootPath);
      }
    }
  }

  return {
    status: "MAX_RETRIES_REACHED",
    attempts,
  };
};
