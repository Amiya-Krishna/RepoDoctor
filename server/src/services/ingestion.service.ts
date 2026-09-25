import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

import {
  createWorkspace,
  removeWorkspace,
} from "./workspace.service";

import { analyzeRepository } from "../analyzers/repository.analyzer";
import { saveAnalysis } from "./analysis.service";

const execFileAsync = promisify(execFile);

interface IngestionInput {
  repositoryId: string;
  cloneUrl: string;
  accessToken: string;
  defaultBranch: string;
}

export const ingestRepository = async ({
  repositoryId,
  cloneUrl,
  accessToken,
  defaultBranch,
}: IngestionInput) => {
  const workspace = await createWorkspace();

  try {
    const repositoryPath = path.join(
      workspace.path,
      "repository"
    );

    const authenticatedUrl = cloneUrl.replace(
      "https://",
      `https://x-access-token:${encodeURIComponent(
        accessToken
      )}@`
    );

    await execFileAsync(
      "git",
      [
        "clone",
        "--depth",
        "1",
        "--branch",
        defaultBranch,
        authenticatedUrl,
        repositoryPath,
      ],
      {
        timeout: 120000,
      }
    );

    const snapshot =
      await analyzeRepository(repositoryPath);

    await saveAnalysis(
      repositoryId,
      snapshot
    );

    return snapshot;
  } finally {
    await removeWorkspace(
      workspace.path
    );
  }
};