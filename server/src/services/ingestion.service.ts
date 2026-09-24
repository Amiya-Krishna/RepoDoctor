import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { createWorkspace, removeWorkspace } from "./workspace.service";

const execFileAsync = promisify(execFile);

interface IngestionInput {
  cloneUrl: string;
  accessToken: string;
  defaultBranch: string;
}

export const ingestRepository = async ({
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
      `https://x-access-token:${encodeURIComponent(accessToken)}@`
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

    return {
      workspaceId: workspace.id,
      repositoryPath,
    };
  } catch (error) {
    await removeWorkspace(workspace.path);
    throw error;
  }
};