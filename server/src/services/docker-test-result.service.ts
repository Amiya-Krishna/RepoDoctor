import { prisma } from "../config/prisma.js";
import type { DockerTestResult } from "../execution/docker.types.js";
import { redactSecrets } from "../security/secret-redactor.js";

export const saveDockerTestResult = async (
  repositoryPath: string,
  testCommand: string[],
  result: DockerTestResult,
  analysisId?: string,
) => {
  return prisma.dockerTestRun.create({
    data: {
      ...(analysisId ? { analysisId } : {}),
      // The workspace path is a throw-away temp directory; do not keep host paths.
      repositoryPath: "[disposable workspace]",
      testCommand,
      success: result.success,
      exitCode: result.exitCode,
      // Test output can echo environment values or source lines: redact before storing.
      stdout: redactSecrets(result.stdout),
      stderr: redactSecrets(result.stderr),
      durationMs: result.durationMs,
      timedOut: result.timedOut,
    },
  });
};
