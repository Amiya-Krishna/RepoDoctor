import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { envPositiveInt } from "../config/env-number.js";

const execFileAsync = promisify(execFile);

const NODE_IMAGE = "node:22-bookworm-slim";
const INSTALL_TIMEOUT_MS = envPositiveInt("REPAIR_INSTALL_TIMEOUT_MS", 300_000);

const tail = (value: string, max = 1500): string =>
  value.length <= max ? value : `…${value.slice(-max)}`;

const exists = async (target: string): Promise<boolean> =>
  fs.access(target).then(() => true, () => false);

/**
 * Fails fast with a readable message when the machine running the repair
 * worker cannot run Docker. Without this the test step reports no exit code
 * and every repair ends as INCONCLUSIVE.
 */
export const assertDockerAvailable = async (): Promise<void> => {
  try {
    await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], {
      windowsHide: true,
      timeout: 20_000,
    });
  } catch {
    throw new Error(
      "Docker is not available to the repair worker. Install/start Docker Desktop (or the Docker daemon) " +
        "on the machine running `npm run repair-worker`, then try again.",
    );
  }
};

/**
 * Fails fast when the requested npm script does not exist, e.g. "npm test" in
 * a repository that has no "test" script. Every attempt would fail otherwise.
 */
export const assertTestCommandRunnable = async (
  repositoryPath: string,
  testCommand: string[],
  workingDirectory = "",
): Promise<void> => {
  const [tool, first, second] = testCommand;
  if (!["npm", "pnpm", "yarn"].includes(tool)) return;

  const scriptName =
    first === "test" || first === "t" ? "test" : first === "run" || first === "run-script" ? second : undefined;
  if (!scriptName) return;

  const packageJsonPath = path.join(repositoryPath, workingDirectory, "package.json");
  if (!(await exists(packageJsonPath))) {
    throw new Error(
      `There is no package.json in ${workingDirectory ? `"${workingDirectory}"` : "the repository root"}, ` +
        `so "${testCommand.join(" ")}" cannot run. Set the Project folder to the directory that contains ` +
        "the package.json (for example client or server), or use a command like: node --check <file>.",
    );
  }

  const manifest = JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const script = manifest.scripts?.[scriptName];

  if (!script || /no test specified/i.test(script)) {
    throw new Error(
      `This repository has no usable "${scriptName}" script in package.json, so "${testCommand.join(" ")}" ` +
        "cannot verify a fix. Change the test command to one the repository supports.",
    );
  }
};

/**
 * Validates the optional project sub-folder (e.g. "client") the test command
 * runs in and returns it as a clean relative POSIX path ("" = repository root).
 */
export const resolveWorkingDirectory = async (
  repositoryPath: string,
  value: string | undefined,
): Promise<string> => {
  const cleaned = (value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/\/+$/, "");

  if (cleaned === "" || cleaned === ".") return "";

  if (
    cleaned.startsWith("/") ||
    cleaned.includes("\0") ||
    cleaned.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error(`Invalid project folder "${value}". Use a relative folder such as client or packages/web.`);
  }

  const stats = await fs.stat(path.join(repositoryPath, cleaned)).catch(() => undefined);
  if (!stats?.isDirectory()) {
    throw new Error(`Project folder "${cleaned}" does not exist in the repository.`);
  }

  return cleaned;
};

export interface DependencyVolume {
  /** Docker volume that holds node_modules (kept off the host bind mount, which breaks symlinks on Windows). */
  name: string;
  /** Package folder relative to the repository root ("" = root). */
  directory: string;
}

const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "build", "coverage", "out", "docs"]);
const MAX_PACKAGES = 5;

/**
 * Finds every folder with a package.json: the root and its direct sub-folders
 * (typical client/ + server/ layouts). Workspaces roots install everything at once.
 */
const findPackageDirectories = async (repositoryPath: string): Promise<string[]> => {
  const directories: string[] = [];

  const rootManifestPath = path.join(repositoryPath, "package.json");
  if (await exists(rootManifestPath)) {
    directories.push("");
    try {
      const manifest = JSON.parse(await fs.readFile(rootManifestPath, "utf8")) as { workspaces?: unknown };
      if (manifest.workspaces) return directories;
    } catch {
      // Unreadable manifest: let the install step report it.
    }
  }

  const entries = await fs.readdir(repositoryPath, { withFileTypes: true });
  for (const entry of entries) {
    if (
      directories.length >= MAX_PACKAGES ||
      !entry.isDirectory() ||
      entry.name.startsWith(".") ||
      SKIP_DIRECTORIES.has(entry.name)
    ) {
      continue;
    }
    if (await exists(path.join(repositoryPath, entry.name, "package.json"))) {
      directories.push(entry.name);
    }
  }

  return directories;
};

const installCommandFor = async (packagePath: string): Promise<string[]> => {
  const common = ["--ignore-scripts"];

  if (await exists(path.join(packagePath, "pnpm-lock.yaml"))) {
    return ["npx", "--yes", "pnpm@9", "install", "--frozen-lockfile", ...common];
  }
  if (await exists(path.join(packagePath, "yarn.lock"))) {
    return ["npx", "--yes", "yarn@1.22.22", "install", "--frozen-lockfile", "--ignore-engines", ...common];
  }
  if (
    (await exists(path.join(packagePath, "package-lock.json"))) ||
    (await exists(path.join(packagePath, "npm-shrinkwrap.json")))
  ) {
    return ["npm", "ci", ...common, "--no-audit", "--no-fund"];
  }
  return ["npm", "install", ...common, "--no-audit", "--no-fund"];
};

/**
 * Installs dependencies for every package folder into throw-away Docker volumes.
 *
 * Only this step has network access, and it runs with lifecycle scripts
 * disabled, all capabilities dropped and resource limits. The tests then run
 * with `--network none` against the same volumes.
 *
 * Returns an empty list when the repository has no package.json anywhere.
 */
export const installDependencies = async (
  repositoryPath: string,
): Promise<DependencyVolume[]> => {
  if (process.env.REPAIR_INSTALL_DEPENDENCIES === "false") return [];

  const resolved = path.resolve(repositoryPath);
  const volumes: DependencyVolume[] = [];

  for (const directory of await findPackageDirectories(resolved)) {
    const volume: DependencyVolume = { name: `repodoctor-nm-${randomUUID()}`, directory };
    const containerDirectory = directory ? `/workspace/repository/${directory}` : "/workspace/repository";
    const installCommand = await installCommandFor(path.join(resolved, directory));

    try {
      await execFileAsync(
        "docker",
        [
          "run", "--rm",
          "--memory", "1g",
          "--cpus", "2",
          "--pids-limit", "512",
          "--cap-drop", "ALL",
          "--security-opt", "no-new-privileges",
          "--read-only",
          "--tmpfs", "/tmp:rw,nosuid,size=768m",
          "-e", "HOME=/tmp",
          "-e", "npm_config_cache=/tmp/.npm",
          "-e", "CI=true",
          "-v", `${resolved}:/workspace/repository:rw`,
          "-v", `${volume.name}:${containerDirectory}/node_modules`,
          "-w", containerDirectory,
          NODE_IMAGE,
          ...installCommand,
        ],
        { windowsHide: true, timeout: INSTALL_TIMEOUT_MS, maxBuffer: 5_000_000 },
      );
      volumes.push(volume);
    } catch (error) {
      await removeDependencyVolumes([...volumes, volume]);
      const failure = error as { stderr?: string; stdout?: string; message?: string };
      throw new Error(
        `Dependency installation failed in ${directory || "the repository root"} (${installCommand.join(" ")}): ${tail(
          failure.stderr || failure.stdout || failure.message || "unknown error",
        )}`,
      );
    }
  }

  return volumes;
};

export const removeDependencyVolumes = async (
  volumes: DependencyVolume[] | undefined,
): Promise<void> => {
  for (const volume of volumes ?? []) {
    try {
      await execFileAsync("docker", ["volume", "rm", "-f", volume.name], {
        windowsHide: true,
        timeout: 20_000,
      });
    } catch {
      // Best effort; a leftover volume is harmless and can be pruned with `docker volume prune`.
    }
  }
};
