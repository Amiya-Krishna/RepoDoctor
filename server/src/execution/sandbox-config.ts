export type InstallNetwork = "bridge" | "none";

export interface SandboxConfig {
  /** OCI runtime, e.g. "runsc" (gVisor). Empty = Docker default (runc). */
  runtime: string;
  /** "uid:gid" for the install and test containers. Never root. */
  user: string;
  installNetwork: InstallNetwork;
}

const RUNTIME = /^[a-z0-9][a-z0-9_.-]{0,31}$/i;
const USER = /^[0-9]{1,10}:[0-9]{1,10}$/;

export function loadSandboxConfig(env: Record<string, string | undefined> = process.env): SandboxConfig {
  return {
    runtime: (env.REPAIR_SANDBOX_RUNTIME ?? "").trim(),
    user: (env.REPAIR_SANDBOX_USER ?? "1000:1000").trim(),
    installNetwork: (env.REPAIR_INSTALL_NETWORK ?? "bridge").trim() as InstallNetwork,
  };
}

/** Problems with the sandbox configuration; every one stops a repair (fail closed) rather than silently weakening isolation. */
export function sandboxConfigProblems(config: SandboxConfig, env: Record<string, string | undefined> = process.env): string[] {
  const problems: string[] = [];
  if (!USER.test(config.user) || config.user.split(":").some((p) => Number(p) === 0)) {
    problems.push("REPAIR_SANDBOX_USER must be a non-root numeric uid:gid (for example 1000:1000).");
  }
  if (config.runtime && !RUNTIME.test(config.runtime)) problems.push("REPAIR_SANDBOX_RUNTIME is not a valid runtime name.");
  if (!["bridge", "none"].includes(config.installNetwork)) problems.push('REPAIR_INSTALL_NETWORK must be "bridge" or "none".');
  if (env.NODE_ENV === "production" && env.REPAIR_REQUIRE_HARDENED_RUNTIME === "true" && !config.runtime) {
    problems.push("REPAIR_REQUIRE_HARDENED_RUNTIME=true but REPAIR_SANDBOX_RUNTIME is not set (for example runsc).");
  }
  return problems;
}

export function assertSandboxConfig(env: Record<string, string | undefined> = process.env): SandboxConfig {
  const config = loadSandboxConfig(env);
  const problems = sandboxConfigProblems(config, env);
  if (problems.length > 0) throw new Error(`Invalid sandbox configuration: ${problems.join(" ")}`);
  return config;
}
