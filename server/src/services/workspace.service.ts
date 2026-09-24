import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";

export const createWorkspace = async () => {
  const id = crypto.randomUUID();

  const workspacePath = path.join(
    os.tmpdir(),
    "repodoctor",
    id
  );

  await fs.mkdir(workspacePath, {
    recursive: true,
  });

  return {
    id,
    path: workspacePath,
  };
};

export const removeWorkspace = async (
  workspacePath: string
) => {
  await fs.rm(workspacePath, {
    recursive: true,
    force: true,
  });
};