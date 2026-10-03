import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

import type {
  DockerTestInput,
  DockerTestResult,
} from "./docker.types.js";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MEMORY_LIMIT = "512m";
const DEFAULT_CPU_LIMIT = "1";
const DEFAULT_PIDS_LIMIT = 128;

const MAX_OUTPUT_SIZE = 1_000_000;

const truncateOutput = (
  value: string,
): string => {
  if (value.length <= MAX_OUTPUT_SIZE) {
    return value;
  }

  return `${value.slice(0, MAX_OUTPUT_SIZE)}\n[output truncated]`;
};

export const runDockerTest = async (
  input: DockerTestInput,
): Promise<DockerTestResult> => {
  const repositoryPath = path.resolve(
    input.repositoryPath,
  );

  const timeoutMs =
    input.timeoutMs ??
    DEFAULT_TIMEOUT_MS;

  const memoryLimit =
    input.memoryLimit ??
    DEFAULT_MEMORY_LIMIT;

  const cpuLimit =
    input.cpuLimit ??
    DEFAULT_CPU_LIMIT;

  const pidsLimit =
    input.pidsLimit ??
    DEFAULT_PIDS_LIMIT;

  if (input.testCommand.length === 0) {
    throw new Error(
      "Docker test command cannot be empty.",
    );
  }

  const containerName =
    `repodoctor-test-${randomUUID()}`;

  const startedAt = Date.now();

  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  let timedOut = false;

  try {
    const dockerArgs = [
      "run",

      "--rm",

      "--name",
      containerName,

      "--network",
      "none",

      "--memory",
      memoryLimit,

      "--cpus",
      cpuLimit,

      "--pids-limit",
      String(pidsLimit),

      "--cap-drop",
      "ALL",

      "--security-opt",
      "no-new-privileges",

      "--read-only",

      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=256m",

      "--tmpfs",
      "/run:rw,noexec,nosuid,size=64m",

      "-v",
      `${repositoryPath}:/workspace/repository:rw`,

      "-w",
      "/workspace/repository",

      "node:22-bookworm-slim",

      ...input.testCommand,
    ];

    try {
      const result =
        await execFileAsync(
          "docker",
          dockerArgs,
          {
            windowsHide: true,
            timeout: timeoutMs,
            maxBuffer: 2_000_000,
          },
        );

      stdout = result.stdout;
      stderr = result.stderr;

      exitCode = 0;
    } catch (error: unknown) {
      const commandError =
        error as {
          code?: number | string;
          stdout?: string;
          stderr?: string;
          killed?: boolean;
          signal?: string;
        };

      stdout =
        commandError.stdout ?? "";

      stderr =
        commandError.stderr ?? "";

      if (
        commandError.code === "ETIMEDOUT" ||
        commandError.killed === true
      ) {
        timedOut = true;
      }

      if (
        typeof commandError.code === "number"
      ) {
        exitCode =
          commandError.code;
      } else {
        exitCode = null;
      }
    }

    return {
      success:
        exitCode === 0 &&
        !timedOut,

      exitCode,

      stdout:
        truncateOutput(stdout),

      stderr:
        truncateOutput(stderr),

      durationMs:
        Date.now() - startedAt,

      timedOut,
    };
  } finally {
    /*
     * Normally --rm removes the container.
     *
     * This extra cleanup handles cases where Docker
     * stops responding or the process is terminated.
     */
    try {
      await execFileAsync(
        "docker",
        [
          "rm",
          "-f",
          containerName,
        ],
        {
          windowsHide: true,
          timeout: 10_000,
          maxBuffer: 100_000,
        },
      );
    } catch {
      // Container may already have been removed by --rm.
    }
  }
};