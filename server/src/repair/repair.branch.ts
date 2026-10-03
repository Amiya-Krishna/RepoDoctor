import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

export const getCurrentBranch = async (
  repositoryPath: string,
): Promise<string> => {
  const { stdout } = await execFileAsync(
    "git",
    [
      "branch",
      "--show-current",
    ],
    {
      cwd: repositoryPath,
      windowsHide: true,
    },
  );

  return stdout.trim();
};

export const getWorkingTreeStatus = async (
  repositoryPath: string,
): Promise<string> => {
  const { stdout } = await execFileAsync(
    "git",
    [
      "status",
      "--short",
    ],
    {
      cwd: repositoryPath,
      windowsHide: true,
    },
  );

  return stdout.trim();
};