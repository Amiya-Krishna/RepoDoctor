import { FixAgent } from "../../agents/fix.agent.js";
import { createAIProvider } from "../../ai/ai.provider.factory.js";
import { saveDockerTestResult } from "../../services/docker-test-result.service.js";
import { saveFixProposal } from "../../services/fix-proposal.service.js";
import {
  createRepairAttempt,
  updateRepairAttempt,
} from "../../services/repair-attempt.service.js";
import { saveVerificationResult } from "../../services/verification-result.service.js";
import { verifyFix } from "../../services/verification.service.js";

import { buildRepositoryContext } from "../../context/context.builder.js";
import { formatRepositoryContext } from "../../context/context.formatter.js";

import {
  createRepairWorkspace,
  removeRepairWorkspace,
} from "../repair.workspace.js";

import { applyFixResult, RepairPatchError } from "../repair.patch.js";

import { runDockerTest } from "../../execution/docker.runner.js";
import {
  installDependencies,
  removeDependencyVolume,
  type DependencyVolume,
} from "../../execution/docker.dependencies.js";

import { DEFAULT_RETRY_POLICY, canRetry } from "./retry.policy.js";

import { buildReplanningContext } from "./retry.replanner.js";

import type { BugFinding } from "../../agents/bug-detection.types.js";
import type { SecurityFinding } from "../../agents/security.types.js";
import type { VerificationResult } from "../../agents/verification.types.js";
import type { DockerTestResult } from "../../execution/docker.types.js";
import type { RetryAttemptResult, RetryLoopResult } from "./retry.types.js";
import type { RepairWorkspace } from "../repair.types.js";

export interface VerifiedRepairPublicationContext {
  workspace: RepairWorkspace;
  verification: VerificationResult;
  verificationResultId: string;
  analysisId: string;
  findingId: string;
  fixProposalId: string;
  findingTitle: string;
}

export type VerifiedRepairPublisher = (
  context: VerifiedRepairPublicationContext,
) => Promise<{
  number: number;
  url: string;
  branchName: string;
  commitSha: string;
}>;

type Finding = BugFinding | SecurityFinding;

export const runRepairRetryLoop = async (
  analysisId: string,
  repositoryId: string,
  findingId: string,
  finding: Finding,
  sourceRepositoryPath: string,
  testCommand: string[],
  onVerified?: VerifiedRepairPublisher,
  onProgress?: (stage: string, message: string, percent: number) => Promise<void> | void,
): Promise<RetryLoopResult> => {
  const aiProvider = createAIProvider();
  const fixAgent = new FixAgent(aiProvider);

  const attempts: RetryAttemptResult[] = [];

  let previousTestResult: DockerTestResult | undefined;
  let previousVerification: VerificationResult | undefined;
  let previousPatchError: string | undefined;

  for (
    let attemptNumber = 1;
    attemptNumber <= DEFAULT_RETRY_POLICY.maxAttempts;
    attemptNumber++
  ) {
    await onProgress?.(
      "repair-attempt",
      `Starting repair attempt ${attemptNumber} of ${DEFAULT_RETRY_POLICY.maxAttempts}`,
      Math.min(15 + (attemptNumber - 1) * 25, 75),
    );

    const attempt = await createRepairAttempt(
      analysisId,
      findingId,
      attemptNumber,
    );

    let workspace;
    let dependencyVolume: DependencyVolume | undefined;

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

      if (previousPatchError) {
        retryFinding = {
          ...finding,
          description: [
            finding.description,
            "",
            "PREVIOUS ATTEMPT COULD NOT BE APPLIED:",
            previousPatchError,
          ].join("\n"),
        };
      } else if (previousTestResult && previousVerification) {
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
      await onProgress?.("fix-generated", `Generated fix proposal for attempt ${attemptNumber}`, 40 + (attemptNumber - 1) * 15);

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
      previousPatchError = undefined;

      /*
       * Execute tests through Docker.
       */
      await onProgress?.("testing", `Running isolated Docker tests for attempt ${attemptNumber}`, 55 + (attemptNumber - 1) * 10);
      await onProgress?.("installing", `Installing dependencies for attempt ${attemptNumber}`, 50 + (attemptNumber - 1) * 10);
      dependencyVolume = await installDependencies(workspace.repositoryPath);

      const testResult = await runDockerTest({
        repositoryPath: workspace.repositoryPath,
        nodeModulesVolume: dependencyVolume?.name,
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
      await onProgress?.("verification", `Verifying attempt ${attemptNumber}`, 75 + (attemptNumber - 1) * 5);
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
        // Publishing runs before the finally block removes the verified workspace.
        // Callers may omit publication for isolated unit tests, but production
        // repair requests supply this callback.
        const pullRequest = onVerified
          ? await onVerified({
              workspace,
              verification,
              verificationResultId: verificationRecord.id,
              analysisId,
              findingId,
              fixProposalId: proposal.id,
              findingTitle: finding.title,
            })
          : undefined;

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
          ...(pullRequest ? { pullRequest } : {}),
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
          summary: [
            testResult.errorMessage,
            verification.summary,
            verification.reasoning
              ? `Why inconclusive: ${verification.reasoning.slice(0, 400)}`
              : undefined,
          ]
            .filter(Boolean)
            .join(" "),
        });

        previousTestResult = testResult;
        previousVerification = verification;

        /*
         * No exit code / timeout means the environment (Docker) is at fault,
         * which another model attempt cannot fix. Otherwise the evidence was
         * merely ambiguous, so give the model another attempt with that
         * evidence. INCONCLUSIVE still never publishes a pull request.
         */
        const environmentFault =
          testResult.exitCode === null || testResult.timedOut;

        if (environmentFault || !canRetry(attemptNumber, DEFAULT_RETRY_POLICY)) {
          return {
            status: "INCONCLUSIVE",
            attempts,
          };
        }

        continue;
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

      /*
       * A patch that does not line up with the real file is the model's
       * mistake, not an environment fault: give it the file's actual text
       * and try again.
       */
      if (
        error instanceof RepairPatchError &&
        canRetry(attemptNumber, DEFAULT_RETRY_POLICY)
      ) {
        previousPatchError = message;
        previousTestResult = undefined;
        previousVerification = undefined;
        continue;
      }

      return {
        status: "ERROR",
        attempts,
      };
    } finally {
      /*
       * NEVER retain the disposable repair workspace.
       */
      await removeDependencyVolume(dependencyVolume);

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
