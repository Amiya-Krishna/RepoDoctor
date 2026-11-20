import path from "path";

const ignoredDirectories = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "out",
]);

const allowedExtensions = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".json",
]);

const ignoredFileNames = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
]);

export const shouldIgnoreDirectory = (directoryName: string) => {
  return ignoredDirectories.has(directoryName);
};

export const isSourceFile = (filePath: string) => {
  const fileName = path.basename(filePath).toLowerCase();
  if (ignoredFileNames.has(fileName)) {
    return false;
  }
  const extension = path.extname(filePath).toLowerCase();
  return allowedExtensions.has(extension);
};

export const isTestFile = (filePath: string) => {
  return (
    filePath.includes(".test.") ||
    filePath.includes(".spec.")
  );
};