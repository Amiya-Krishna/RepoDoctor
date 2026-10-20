import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

const NODE_IMAGE = "node:22-bookworm-slim";
const INSTALL_TIMEOUT_MS = Number(process.env.REPAIR_INSTALL_TIMEOUT_MS ?? 300_000);

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
): Promise<void> => {
  const [tool, first, second] = testCommand;
  if (!["npm", "pnpm", "yarn"].includes(tool)) return;

  const scriptName =
    first === "test" || first === "t" ? "test" : first === "run" || first === "run-script" ? second : undefined;
  if (!scriptName) return;

  const packageJsonPath = path.join(repositoryPath, "package.json");
  if (!(await exists(packageJsonPath))) {
    throw new Error(
      `This repository has no package.json, so "${testCommand.join(" ")}" cannot run. ` +
        "Use a command that works for the repository, for example: node --check <file>.",
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

export interface DependencyVolume {
  /** Docker volume that holds node_modules (kept off the host bind mount, which breaks symlinks on Windows). */
  name: string;
}

const installCommandFor = async (repositoryPath: string): Promise<string[]> => {
  const common = ["--ignore-scripts"];

  if (await exists(path.join(repositoryPath, "pnpm-lock.yaml"))) {
    return ["npx", "--yes", "pnpm@9", "install", "--frozen-lockfile", ...common];
  }
  if (await exists(path.join(repositoryPath, "yarn.lock"))) {
    return ["npx", "--yes", "yarn@1.22.22", "install", "--frozen-lockfile", "--ignore-engines", ...common];
  }
  if (
    (await exists(path.join(repositoryPath, "package-lock.json"))) ||
    (await exists(path.join(repositoryPath, "npm-shrinkwrap.json")))
  ) {
    return ["npm", "ci", ...common, "--no-audit", "--no-fund"];
  }
  return ["npm", "install", ...common, "--no-audit", "--no-fund"];
};

/**
 * Installs dependencies into a throw-away Docker volume.
 *
 * Only this step has network access, and it runs with lifecycle scripts
 * disabled, all capabilities dropped and resource limits. The tests then run
 * with `--network none` against the same volume.
 *
 * Returns undefined when the repository has no package.json.
 */
export const installDependencies = async (
  repositoryPath: string,
): Promise<DependencyVolume | undefined> => {
  if (process.env.REPAIR_INSTALL_DEPENDENCIES === "false") return undefined;

  const resolved = path.resolve(repositoryPath);
  if (!(await exists(path.join(resolved, "package.json")))) return undefined;

  const name = `repodoctor-nm-${randomUUID()}`;
  const installCommand = await installCommandFor(resolved);

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
        "-v", `${name}:/workspace/repository/node_modules`,
        "-w", "/workspace/repository",
        NODE_IMAGE,
        ...installCommand,
      ],
      { windowsHide: true, timeout: INSTALL_TIMEOUT_MS, maxBuffer: 5_000_000 },
    );
  } catch (error) {
    await removeDependencyVolume({ name });
    const failure = error as { stderr?: string; stdout?: string; message?: string };
    throw new Error(
      `Dependency installation failed (${installCommand.join(" ")}): ${tail(
        failure.stderr || failure.stdout || failure.message || "unknown error",
      )}`,
    );
  }

  return { name };
};

export const removeDependencyVolume = async (
  volume: DependencyVolume | undefined,
): Promise<void> => {
  if (!volume) return;
  try {
    await execFileAsync("docker", ["volume", "rm", "-f", volume.name], {
      windowsHide: true,
      timeout: 20_000,
    });
  } catch {
    // Best effort; a leftover volume is harmless and can be pruned with `docker volume prune`.
  }
};
