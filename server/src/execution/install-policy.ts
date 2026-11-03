import fs from "node:fs/promises";
import path from "node:path";

export interface PolicyViolation { file: string; rule: string; detail: string }

/** Registries lockfile `resolved` URLs may point at. Anything else could exfiltrate or pull attacker code. */
export const DEFAULT_REGISTRY_HOSTS = ["registry.npmjs.org", "registry.yarnpkg.com"];

const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
/** Config files that can redirect registries, inject auth, or run code at install time. */
const FORBIDDEN_FILES = [".npmrc", ".yarnrc", ".yarnrc.yml", ".pnpmfile.cjs", ".pnpmfile.mjs", ".pnp.cjs"];

/** A dependency spec is acceptable only when it is a registry semver/range/tag or an npm: alias. */
export function isRegistrySpec(spec: string): boolean {
  const s = spec.trim();
  if (s === "" || s === "*" || s === "latest") return true;
  if (/^(git|git\+[a-z]+|github|gitlab|bitbucket|http|https|file|link|portal|patch|workspace):/i.test(s)) return /^workspace:/i.test(s);
  if (/^[\w.-]+\/[\w.-]+(#.*)?$/.test(s)) return false; // GitHub shorthand user/repo
  if (s.includes("://") || s.startsWith(".") || s.startsWith("/") || s.startsWith("~/")) return false;
  return true;
}

const hostOf = (url: string): string | null => { try { return new URL(url).hostname; } catch { return null; } };

function collectResolved(value: unknown, out: string[], depth = 0): void {
  if (depth > 50 || value === null || typeof value !== "object") return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if ((k === "resolved" || k === "tarball") && typeof v === "string") out.push(v);
    else collectResolved(v, out, depth + 1);
  }
}

const readJson = async (file: string): Promise<unknown> => { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return undefined; } };
const exists = (p: string) => fs.access(p).then(() => true, () => false);

/**
 * Pure-file inspection of one package folder before `npm ci/install` is allowed to touch the network.
 * Lifecycle scripts are already disabled (--ignore-scripts); this closes the other install-time vectors:
 * git/URL/file dependencies, rc files, and lockfile entries that resolve outside the approved registries.
 * It does not prove the registry packages themselves are benign.
 */
export async function checkInstallPolicy(
  packageDir: string,
  options: { registryHosts?: string[] } = {},
): Promise<PolicyViolation[]> {
  const hosts = new Set(options.registryHosts ?? DEFAULT_REGISTRY_HOSTS);
  const violations: PolicyViolation[] = [];
  const push = (file: string, rule: string, detail: string) => violations.push({ file, rule, detail });

  for (const name of FORBIDDEN_FILES) {
    if (await exists(path.join(packageDir, name))) push(name, "FORBIDDEN_CONFIG_FILE", "install-time configuration from the repository is not honoured");
  }

  const manifest = (await readJson(path.join(packageDir, "package.json"))) as Record<string, unknown> | undefined;
  if (manifest) {
    for (const field of DEP_FIELDS) {
      const deps = manifest[field];
      if (deps && typeof deps === "object") {
        for (const [dep, spec] of Object.entries(deps as Record<string, unknown>)) {
          if (typeof spec !== "string" || !isRegistrySpec(spec)) push("package.json", "NON_REGISTRY_DEPENDENCY", `${field}.${dep}`);
        }
      }
    }
    for (const field of ["overrides", "resolutions", "pnpm"]) {
      const text = JSON.stringify(manifest[field] ?? "");
      if (/(git\+|github:|https?:\/\/|file:|link:)/i.test(text)) push("package.json", "NON_REGISTRY_OVERRIDE", field);
    }
  }

  for (const lock of ["package-lock.json", "npm-shrinkwrap.json"]) {
    const json = await readJson(path.join(packageDir, lock));
    if (json) {
      const urls: string[] = [];
      collectResolved(json, urls);
      for (const url of urls) {
        const host = hostOf(url);
        if (!host || !hosts.has(host)) push(lock, "LOCKFILE_UNAPPROVED_HOST", host ?? "unparsable URL");
      }
    }
  }
  for (const lock of ["yarn.lock", "pnpm-lock.yaml"]) {
    const file = path.join(packageDir, lock);
    if (!(await exists(file))) continue;
    const text = await fs.readFile(file, "utf8").catch(() => "");
    for (const match of text.matchAll(/https?:\/\/[^\s"'#]+|git\+[a-z]+:\/\/[^\s"']+|github:[^\s"']+/gi)) {
      const host = hostOf(match[0]);
      if (!host || !hosts.has(host)) push(lock, "LOCKFILE_UNAPPROVED_HOST", host ?? "non-registry reference");
    }
  }

  // De-duplicate identical findings so the message stays readable.
  const seen = new Set<string>();
  return violations.filter((v) => { const k = `${v.file}|${v.rule}|${v.detail}`; return seen.has(k) ? false : (seen.add(k), true); });
}

export async function assertInstallPolicy(packageDir: string, options?: { registryHosts?: string[] }): Promise<void> {
  const violations = await checkInstallPolicy(packageDir, options);
  if (violations.length > 0) {
    const shown = violations.slice(0, 5).map((v) => `${v.rule} (${v.file}: ${v.detail})`).join("; ");
    throw new Error(`Dependency installation refused by policy: ${shown}${violations.length > 5 ? "; …" : ""}. Install policy is enforced to keep untrusted repositories from reaching other hosts at install time.`);
  }
}
