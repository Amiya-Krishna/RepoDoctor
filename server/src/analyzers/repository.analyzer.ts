import fs from "fs/promises";
import path from "path";

interface RepositorySnapshot {
  projectType: string;
  language: string;
  packageManager: string;
  framework: string | null;
  testFramework: string | null;
  linter: string | null;
  hasTypeScript: boolean;
  sourceFileCount: number;
  testFileCount: number;
  files: string[];
  dependencies: string[];
  devDependencies: string[];
}

const SOURCE_EXTENSIONS = [
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
];

const TEST_PATTERNS = [
  ".test.",
  ".spec.",
];

const IGNORE_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
]);

const isSourceFile = (filePath: string) => {
  return SOURCE_EXTENSIONS.includes(
    path.extname(filePath).toLowerCase()
  );
};

const isTestFile = (filePath: string) => {
  const fileName = path.basename(filePath).toLowerCase();

  return TEST_PATTERNS.some((pattern) =>
    fileName.includes(pattern)
  );
};

const scanDirectory = async (
  directory: string,
  rootDirectory: string,
  files: string[]
): Promise<void> => {
  const entries = await fs.readdir(directory, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    if (IGNORE_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(
      directory,
      entry.name
    );

    if (entry.isDirectory()) {
      await scanDirectory(
        absolutePath,
        rootDirectory,
        files
      );
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!isSourceFile(absolutePath)) {
      continue;
    }

    const relativePath = path
      .relative(rootDirectory, absolutePath)
      .replaceAll("\\", "/");

    files.push(relativePath);
  }
};

export const analyzeRepository = async (
  repositoryPath: string
): Promise<RepositorySnapshot> => {
  const packageJsonPath = path.join(
    repositoryPath,
    "package.json"
  );

  let packageJson: any = null;

  try {
    const content = await fs.readFile(
      packageJsonPath,
      "utf-8"
    );

    packageJson = JSON.parse(content);
  } catch {
    packageJson = null;
  }

  const files: string[] = [];

  await scanDirectory(
    repositoryPath,
    repositoryPath,
    files
  );

  const sourceFiles = files.filter(isSourceFile);
  const testFiles = files.filter(isTestFile);

  const dependencies = Object.keys(
    packageJson?.dependencies ?? {}
  );

  const devDependencies = Object.keys(
    packageJson?.devDependencies ?? {}
  );

  const hasTypeScript =
    files.some((file) =>
      [".ts", ".tsx"].includes(
        path.extname(file)
      )
    ) ||
    await fileExists(
      path.join(repositoryPath, "tsconfig.json")
    );

  return {
    projectType: "node",
    language: hasTypeScript
      ? "typescript"
      : "javascript",
    packageManager: await detectPackageManager(
    repositoryPath
   ),
    framework: detectFramework(
      dependencies,
      devDependencies
    ),
    testFramework: detectTestFramework(
      dependencies,
      devDependencies
    ),
    linter: detectLinter(
      dependencies,
      devDependencies
    ),
    hasTypeScript,
    sourceFileCount: sourceFiles.length,
    testFileCount: testFiles.length,
    files,
    dependencies,
    devDependencies,
  };
};

const fileExists = async (
  filePath: string
) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const detectPackageManager = async (
  repositoryPath: string
) => {
  if (
    await fileExists(
      path.join(repositoryPath, "pnpm-lock.yaml")
    )
  ) {
    return "pnpm";
  }

  if (
    await fileExists(
      path.join(repositoryPath, "yarn.lock")
    )
  ) {
    return "yarn";
  }

  if (
    await fileExists(
      path.join(repositoryPath, "package-lock.json")
    )
  ) {
    return "npm";
  }

  return "unknown";
};

const detectFramework = (
  dependencies: string[],
  devDependencies: string[]
) => {
  const all = new Set([
    ...dependencies,
    ...devDependencies,
  ]);

  if (all.has("next")) return "next";
  if (all.has("express")) return "express";
  if (all.has("react")) return "react";
  if (all.has("vite")) return "vite";
  if (all.has("nestjs") || all.has("@nestjs/core")) {
    return "nestjs";
  }

  return null;
};

const detectTestFramework = (
  dependencies: string[],
  devDependencies: string[]
) => {
  const all = new Set([
    ...dependencies,
    ...devDependencies,
  ]);

  if (all.has("vitest")) return "vitest";
  if (all.has("jest")) return "jest";
  if (all.has("mocha")) return "mocha";

  return null;
};

const detectLinter = (
  dependencies: string[],
  devDependencies: string[]
) => {
  const all = new Set([
    ...dependencies,
    ...devDependencies,
  ]);

  if (all.has("oxlint")) return "oxlint";
  if (all.has("eslint")) return "eslint";

  return null;
};