export interface ConfigProblem {
  level: "error" | "warning";
  message: string;
}

const PLACEHOLDER = /(change[_-]?me|replace[_-]?with|your[_-]|xxxx|example|placeholder|^\.\.\.$)/i;

const isStrong = (value: string | undefined, min: number) =>
  Boolean(value) && value!.length >= min && !PLACEHOLDER.test(value!);

/**
 * Pure: inspects an environment and lists security-relevant misconfiguration.
 * In production every "error" aborts startup (fail closed); elsewhere they are
 * printed as warnings so local development keeps working.
 */
export function collectSecurityConfigProblems(
  env: Record<string, string | undefined>,
  role: "api" | "scan-worker" | "repair-worker",
): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const err = (message: string) => problems.push({ level: "error", message });
  const warn = (message: string) => problems.push({ level: "warning", message });

  if (!isStrong(env.JWT_SECRET, 32)) err("JWT_SECRET must be a random value of at least 32 characters.");

  const key = env.GITHUB_TOKEN_ENCRYPTION_KEY;
  if (!key) {
    err("GITHUB_TOKEN_ENCRYPTION_KEY is required (32 random bytes, base64).");
  } else if (Buffer.from(key, "base64").length !== 32) {
    err("GITHUB_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }

  if (role === "api") {
    if (!isStrong(env.GITHUB_WEBHOOK_SECRET, 20)) err("GITHUB_WEBHOOK_SECRET must be a random value of at least 20 characters.");
    if (!env.FRONTEND_URL) err("FRONTEND_URL must be set to the exact browser origin.");
    else if (env.FRONTEND_URL === "*" ) err("FRONTEND_URL must not be a wildcard.");
    else if (!/^https:\/\//i.test(env.FRONTEND_URL) && env.ALLOW_INSECURE_HTTP !== "true") {
      err("FRONTEND_URL must use https:// (set ALLOW_INSECURE_HTTP=true only for a local, non-public evaluation).");
    }
  }

  if (!env.REDIS_PASSWORD) err("REDIS_PASSWORD must be set.");
  if (env.ALLOW_PLAINTEXT_TOKENS === "true") err("ALLOW_PLAINTEXT_TOKENS must not be set in production.");

  if (role === "repair-worker" && !env.DOCKER_HOST && !env.REPAIR_SANDBOX_HOST_OK) {
    warn("Repair worker needs a Docker daemon; use a dedicated sandbox host (see docs/DEPLOYMENT.md). Never mount the host Docker socket into a public-facing service.");
  }

  return problems;
}

export function assertSecureConfiguration(
  role: "api" | "scan-worker" | "repair-worker",
  env: Record<string, string | undefined> = process.env,
): void {
  const problems = collectSecurityConfigProblems(env, role);
  const production = env.NODE_ENV === "production";

  for (const p of problems) {
    if (p.level === "warning" || !production) console.warn(`[config] ${p.level}: ${p.message}`);
  }

  const errors = problems.filter((p) => p.level === "error");
  if (production && errors.length > 0) {
    throw new Error(`Refusing to start with insecure configuration:\n - ${errors.map((e) => e.message).join("\n - ")}`);
  }
}
