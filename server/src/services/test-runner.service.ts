import {
  runDockerTest,
} from "../execution/docker.runner.js";

import type {
  DockerTestResult,
} from "../execution/docker.types.js";

export const runRepositoryTests = async (
  repositoryPath: string,
  testCommand: string[],
): Promise<DockerTestResult> => {
  return runDockerTest({
    repositoryPath,
    testCommand,
    timeoutMs: 120_000,
    memoryLimit: "512m",
    cpuLimit: "1",
    pidsLimit: 128,
  });
};