import fs from "node:fs/promises";
import path from "node:path";
import type { FixResult } from "../agents/fix.types.js";
import { scanForSecrets } from "../security/secret-redactor.js";

export const PATCH_LIMITS = {
  maxFiles: 5,
  maxChanges: 10,
  maxChangedLinesPerChange: 200,
  maxTotalReplacementChars: 40_000,
};

/** Paths a generated patch may never touch: CI, git internals, credentials, dependency manifests. */
const FORBIDDEN_PATH: RegExp[] = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.github(\/|$)/,
  /(^|\/)\.gitlab-ci\.ya?ml$/,
  /(^|\/)\.circleci(\/|$)/,
  /(^|\/)Jenkinsfile$/,
  /(^|\/)Dockerfile[^/]*$/i,
  /(^|\/)docker-compose[^/]*\.ya?ml$/i,
  /(^|\/)\.env(\..*)?$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.yarnrc(\.yml)?$/,
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/,
  /(^|\/)package\.json$/, // scripts/dependencies change what runs on install and in CI
  /(^|\/)node_modules(\/|$)/,
  /\.(pem|key|p12|pfx)$/i,
];

/** Constructs that execute code at install/test time or exfiltrate data when added by a "fix". */
const DANGEROUS_ADDITIONS: { name: string; pattern: RegExp }[] = [
  { name: "child_process usage", pattern: /\b(?:child_process|execSync|spawnSync|execFile|spawn)\b/ },
  { name: "network call to an external host", pattern: /\b(?:fetch|axios|http\.request|https\.request|XMLHttpRequest|WebSocket)\b[^\n]*https?:\/\//i },
  { name: "dynamic code evaluation", pattern: /\beval\s*\(|\bnew\s+Function\s*\(/ },
  { name: "remote script/URL download", pattern: /\b(?:curl|wget)\b/ },
  { name: "process.env exfiltration", pattern: /process\.env\b[^\n]*(?:JSON\.stringify|Object\.(?:keys|entries|values))|(?:JSON\.stringify|Object\.(?:keys|entries|values))\s*\(\s*process\.env\s*\)/ },
  { name: "base64 decoded payload execution", pattern: /atob\s*\(|Buffer\.from\([^)]*['"]base64['"]\)[^\n]*(?:eval|Function|exec)/ },
];

export class PatchPolicyError extends Error {
  constructor(message: string, readonly rule: string) {
    super(message);
    this.name = "PatchPolicyError";
  }
}

export function checkPathAllowed(filePath: string): void {
  const normalized = path.posix.normalize(filePath.replace(/\\/g, "/"));
  if (path.isAbsolute(filePath) || normalized.startsWith("../") || normalized === ".." || filePath.includes("\0")) {
    throw new PatchPolicyError(`Path escapes the repository: ${filePath}`, "path-escape");
  }
  if (FORBIDDEN_PATH.some((re) => re.test(normalized))) {
    throw new PatchPolicyError(`Automated fixes may not modify ${filePath}`, "forbidden-path");
  }
}

/**
 * Static policy applied to every AI-generated patch BEFORE it touches the
 * workspace: size limits, forbidden paths, secrets and dangerous constructs
 * in added code. The exact-text/line-range validation stays in repair.patch.ts.
 */
export function validatePatchPolicy(fix: FixResult): void {
  if (!Array.isArray(fix.changes) || fix.changes.length === 0) {
    throw new PatchPolicyError("The patch contains no changes.", "empty");
  }
  if (fix.changes.length > PATCH_LIMITS.maxChanges) {
    throw new PatchPolicyError(`The patch has ${fix.changes.length} changes (limit ${PATCH_LIMITS.maxChanges}).`, "too-many-changes");
  }
  const files = new Set(fix.changes.map((c) => c.filePath));
  if (files.size > PATCH_LIMITS.maxFiles) {
    throw new PatchPolicyError(`The patch touches ${files.size} files (limit ${PATCH_LIMITS.maxFiles}).`, "too-many-files");
  }

  let totalChars = 0;
  for (const change of fix.changes) {
    if (typeof change.filePath !== "string" || typeof change.replacementCode !== "string") {
      throw new PatchPolicyError("Malformed change entry.", "malformed");
    }
    checkPathAllowed(change.filePath);

    totalChars += change.replacementCode.length;
    if (change.replacementCode.split("\n").length > PATCH_LIMITS.maxChangedLinesPerChange) {
      throw new PatchPolicyError(`A single change exceeds ${PATCH_LIMITS.maxChangedLinesPerChange} lines.`, "change-too-large");
    }

    const remaining = scanForSecrets(change.replacementCode);
    if (remaining.length > 0) {
      throw new PatchPolicyError(`The patch adds secret-like content (${remaining.join(", ")}).`, "secret-in-patch");
    }

    // Only code the patch ADDS counts: removing an eval() is a fix, not a hazard.
    const original = change.originalCode ?? "";
    for (const rule of DANGEROUS_ADDITIONS) {
      if (rule.pattern.test(change.replacementCode) && !rule.pattern.test(original)) {
        throw new PatchPolicyError(`The patch introduces ${rule.name}.`, "dangerous-addition");
      }
    }
  }
  if (totalChars > PATCH_LIMITS.maxTotalReplacementChars) {
    throw new PatchPolicyError("The patch is larger than the automated-fix limit.", "patch-too-large");
  }
}

/** Refuses to write through a symlink (a repository can plant one pointing outside the workspace). */
export async function assertNoSymlinkInPath(repositoryRoot: string, relativePath: string): Promise<void> {
  const root = await fs.realpath(repositoryRoot);
  let current = root;
  for (const part of path.posix.normalize(relativePath.replace(/\\/g, "/")).split("/")) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(() => undefined);
    if (!stat) return; // new file in an existing directory: nothing to follow
    if (stat.isSymbolicLink()) {
      throw new PatchPolicyError(`Refusing to modify through a symbolic link: ${relativePath}`, "symlink");
    }
  }
  const resolved = await fs.realpath(current).catch(() => current);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new PatchPolicyError(`Resolved path escapes the repository: ${relativePath}`, "path-escape");
  }
}
