import { prisma } from "../config/prisma.js";
import type { DockerTestResult } from "../execution/docker.types.js";

export const saveDockerTestResult = async (
  repositoryPath: string,
  testCommand: string[],
  result: DockerTestResult,
) => {
  return prisma.dockerTestRun.create({
    data: {
      repositoryPath,
      testCommand,
      success: result.success,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
    },
  });
};