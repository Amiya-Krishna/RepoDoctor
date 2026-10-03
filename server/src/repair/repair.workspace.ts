import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import type {
  RepairWorkspace,
  RepairWorkspaceInput,
} from "./repair.types.js";

const execFileAsync = promisify(execFile);

const REPO_DOCTOR_TEMP_DIR = path.join(
  os.tmpdir(),
  "repodoctor",
);

const sanitizeBranchPart = (value: string): string => {
  return value
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
};

export const createRepairWorkspace = async (
  input: RepairWorkspaceInput,
): Promise<RepairWorkspace> => {
  const sourceRepositoryPath = path.resolve(
    input.sourceRepositoryPath,
  );

  const sourceStats = await fs.stat(sourceRepositoryPath);

  if (!sourceStats.isDirectory()) {
    throw new Error(
      `Source repository is not a directory: ${sourceRepositoryPath}`,
    );
  }

  const id = crypto.randomUUID();

  const rootPath = path.join(
    REPO_DOCTOR_TEMP_DIR,
    `repair-${id}`,
  );

  const repositoryPath = path.join(
    rootPath,
    "repository",
  );

  const branchName =
    `repodoctor/repair/${sanitizeBranchPart(input.analysisId)}/${sanitizeBranchPart(input.findingId)}`;

  await fs.mkdir(rootPath, {
    recursive: true,
  });

  try {
    /*
     * --no-local prevents Git from using local-repository
     * optimizations such as hard-linking objects.
     *
     * The source repository remains untouched.
     */
    await execFileAsync(
      "git",
      [
        "clone",
        "--no-local",
        sourceRepositoryPath,
        repositoryPath,
      ],
      {
        cwd: rootPath,
        windowsHide: true,
      },
    );

    await execFileAsync(
      "git",
      [
        "checkout",
        "-b",
        branchName,
      ],
      {
        cwd: repositoryPath,
        windowsHide: true,
      },
    );

    return {
      id,
      rootPath,
      repositoryPath,
      branchName,
    };
  } catch (error) {
    await removeRepairWorkspace(rootPath);
    throw error;
  }
};

export const removeRepairWorkspace = async (
  workspacePath: string,
): Promise<void> => {
  await fs.rm(workspacePath, {
    recursive: true,
    force: true,
  });
};