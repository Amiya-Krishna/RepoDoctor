import path from "node:path";
import type { DockerTestInput } from "./docker.types.js";

export const SANDBOX_IMAGE = "node:22-bookworm-slim";

export interface SandboxLimits {
  memory: string;
  cpus: string;
  pids: number;
  /** "uid:gid" the test process runs as. Empty string = image default (root, still capability-less). */
  user: string;
  /** Optional OCI runtime (for example "runsc" for gVisor). */
  runtime?: string;
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * Builds the `docker run` argument vector for running untrusted repository
 * tests. Pure function so every isolation flag can be asserted in unit tests.
 *
 * Isolation properties (each one is asserted by tests/sandbox-args.test.ts):
 *  - no network (`--network none`)
 *  - no capabilities, no privilege escalation, read-only root filesystem
 *  - memory (swap disabled), CPU and PID limits, bounded open files
 *  - no shared IPC namespace, non-root user, tmpfs scratch space with noexec
 *  - no host paths mounted other than the disposable workspace
 *  - no host environment forwarded: only the explicit variables below
 */
export function buildSandboxRunArgs(
  input: DockerTestInput,
  containerName: string,
  limits: SandboxLimits,
): string[] {
  const repositoryPath = path.resolve(input.repositoryPath);

  if (input.testCommand.length === 0) throw new Error("Docker test command cannot be empty.");
  if (!path.isAbsolute(repositoryPath) || repositoryPath === "/" || repositoryPath.includes(",") || repositoryPath.includes(":")) {
    throw new Error("Refusing to mount an unsafe repository path into the sandbox.");
  }

  const environment: Record<string, string> = {
    HOME: "/tmp",
    npm_config_cache: "/tmp/.npm",
    CI: "true",
    ...(input.environment ?? {}),
  };
  for (const key of Object.keys(environment)) {
    if (!ENV_NAME.test(key)) throw new Error(`Invalid environment variable name: ${key}`);
  }

  const workdir = input.workingDirectory ? `/workspace/repository/${input.workingDirectory}` : "/workspace/repository";

  return [
    "run",
    "--rm",
    "--init",
    "--name", containerName,
    "--label", "repodoctor.sandbox=true",

    ...(limits.runtime ? ["--runtime", limits.runtime] : []),
    "--network", "none",
    "--ipc", "none",

    "--memory", limits.memory,
    "--memory-swap", limits.memory,
    "--cpus", limits.cpus,
    "--pids-limit", String(limits.pids),
    "--ulimit", "nofile=1024:1024",

    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--read-only",
    ...(limits.user ? ["--user", limits.user] : []),

    "--tmpfs", "/tmp:rw,noexec,nosuid,size=256m",
    "--tmpfs", "/run:rw,noexec,nosuid,size=64m",

    "-v", `${repositoryPath}:/workspace/repository:rw`,
    ...(input.nodeModulesVolumes ?? []).flatMap((volume) => [
      "-v",
      `${volume.name}:/workspace/repository/${volume.directory ? `${volume.directory}/` : ""}node_modules`,
    ]),

    "-w", workdir,
    ...Object.entries(environment).flatMap(([key, value]) => ["-e", `${key}=${value}`]),

    SANDBOX_IMAGE,
    ...input.testCommand,
  ];
}
