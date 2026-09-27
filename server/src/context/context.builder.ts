import fs from "fs/promises";
import path from "path";
import {
  isSourceFile,
  shouldIgnoreDirectory,
} from "./context.filters.js";
import { ContextFile, RepositoryContext } from "./context.types.js";

const MAX_FILE_SIZE = 50 * 1024;
const MAX_FILES = 30;
const MAX_CONTEXT_SIZE = 500_000;

export const limitContextSize = (
  context: string,
  maxSize = 500_000
) => {
  if (context.length <= maxSize) {
    return context;
  }

  return context.slice(0, maxSize);
};

const getLanguage = (filePath: string) => {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".ts":
      return "typescript";
    case ".tsx":
      return "typescript-react";
    case ".js":
      return "javascript";
    case ".jsx":
      return "javascript-react";
    default:
      return "unknown";
  }
};

const importantFiles = new Set([
  "package.json",
  "tsconfig.json",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.ts",
  "vite.config.ts",
  "next.config.js",
  "next.config.ts",
]);

const collectSourceFiles = async (
  directory: string,
  rootDirectory: string,
  files: ContextFile[]
): Promise<void> => {
  if (files.length >= MAX_FILES) {
    return;
  }

  const entries = await fs.readdir(directory, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    if (files.length >= MAX_FILES) {
      break;
    }

    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (shouldIgnoreDirectory(entry.name)) {
        continue;
      }

      await collectSourceFiles(
        fullPath,
        rootDirectory,
        files
      );

      continue;
    }

    if (!entry.isFile() || !isSourceFile(entry.name)) {
      continue;
    }

    const stats = await fs.stat(fullPath);

    if (stats.size > MAX_FILE_SIZE) {
      continue;
    }

    const content = await fs.readFile(fullPath, "utf-8");

    files.push({
      path: path.relative(rootDirectory, fullPath),
      content,
      language: getLanguage(fullPath),
      size: stats.size,
    });
  }
};

export const buildRepositoryContext = async (
  workspacePath: string,
  repositoryId: string,
  metadata: {
    projectType?: string;
    language?: string;
    framework?: string;
    packageManager?: string;
  }
): Promise<RepositoryContext> => {
  const files: ContextFile[] = [];

  await collectSourceFiles(
    workspacePath,
    workspacePath,
    files
  );

  return {
    repositoryId,
    projectType: metadata.projectType,
    language: metadata.language,
    framework: metadata.framework,
    packageManager: metadata.packageManager,
    files,
  };
};