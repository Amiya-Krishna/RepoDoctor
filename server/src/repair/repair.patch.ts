import fs from "node:fs/promises";
import path from "node:path";

import type {
  FixChange,
  FixResult,
} from "../agents/fix.types.js";

import type {
  AppliedRepairChange,
} from "./repair.types.js";

const assertSafeRelativePath = (
  filePath: string,
): void => {
  if (
    path.isAbsolute(filePath) ||
    filePath.includes("\0")
  ) {
    throw new Error(
      `Unsafe repair file path: ${filePath}`,
    );
  }

  const normalized = path.normalize(filePath);

  if (
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`) ||
    normalized.startsWith("../") ||
    normalized.includes(`..${path.sep}`)
  ) {
    throw new Error(
      `Path traversal detected: ${filePath}`,
    );
  }
};

const getFileLines = (
  content: string,
): string[] => {
  return content.split(/\r?\n/);
};

const getSelectedLines = (
  lines: string[],
  startLine: number,
  endLine: number,
): string => {
  return lines
    .slice(startLine - 1, endLine)
    .join("\n");
};

const validateLineRange = (
  lines: string[],
  change: FixChange,
): void => {
  if (
    !Number.isInteger(change.startLine) ||
    !Number.isInteger(change.endLine)
  ) {
    throw new Error(
      `Invalid line range for ${change.filePath}`,
    );
  }

  if (
    change.startLine < 1 ||
    change.endLine < change.startLine
  ) {
    throw new Error(
      `Invalid line range for ${change.filePath}: ${change.startLine}-${change.endLine}`,
    );
  }

  if (change.startLine > lines.length) {
    throw new Error(
      `Start line exceeds file length for ${change.filePath}`,
    );
  }

  if (change.endLine > lines.length) {
    throw new Error(
      `End line exceeds file length for ${change.filePath}`,
    );
  }
};

const validateOriginalCode = (
  lines: string[],
  change: FixChange,
): void => {
  if (change.changeType !== "REPLACE") {
    return;
  }

  const actualCode = getSelectedLines(
    lines,
    change.startLine,
    change.endLine,
  );

  const expectedCode = change.originalCode
    .replace(/\r\n/g, "\n")
    .trim();

  if (
    actualCode
      .replace(/\r\n/g, "\n")
      .trim() !== expectedCode
  ) {
    throw new Error(
      `Original code mismatch for ${change.filePath} at lines ${change.startLine}-${change.endLine}`,
    );
  }
};

const applyChange = (
  lines: string[],
  change: FixChange,
): string[] => {
  const startIndex = change.startLine - 1;
  const endIndex = change.endLine;

  switch (change.changeType) {
    case "REPLACE":
      return [
        ...lines.slice(0, startIndex),
        ...change.replacementCode.split(/\r?\n/),
        ...lines.slice(endIndex),
      ];

    case "DELETE":
      return [
        ...lines.slice(0, startIndex),
        ...lines.slice(endIndex),
      ];

    case "INSERT":
      return [
        ...lines.slice(0, startIndex),
        ...change.replacementCode.split(/\r?\n/),
        ...lines.slice(startIndex),
      ];

    default:
      throw new Error(
        `Unsupported change type: ${change.changeType}`,
      );
  }
};

export const applyFixResult = async (
  repositoryPath: string,
  fixResult: FixResult,
): Promise<AppliedRepairChange[]> => {
  if (fixResult.changes.length === 0) {
    throw new Error(
      "Fix result contains no changes.",
    );
  }

  const groupedChanges = new Map<
    string,
    FixChange[]
  >();

  for (const change of fixResult.changes) {
    assertSafeRelativePath(change.filePath);

    const existing =
      groupedChanges.get(change.filePath) ?? [];

    existing.push(change);

    groupedChanges.set(
      change.filePath,
      existing,
    );
  }

  const appliedChanges: AppliedRepairChange[] = [];

  for (const [
    filePath,
    changes,
  ] of groupedChanges) {
    const absolutePath = path.resolve(
      repositoryPath,
      filePath,
    );

    const relativeCheck = path.relative(
      repositoryPath,
      absolutePath,
    );

    if (
      relativeCheck.startsWith("..") ||
      path.isAbsolute(relativeCheck)
    ) {
      throw new Error(
        `Repair path escapes workspace: ${filePath}`,
      );
    }

    const content = await fs.readFile(
      absolutePath,
      "utf8",
    );

    let lines = getFileLines(content);

    /*
     * Apply from bottom to top so line numbers from
     * the FixAgent remain stable.
     */
    const sortedChanges = [...changes].sort(
      (a, b) =>
        b.startLine - a.startLine ||
        b.endLine - a.endLine,
    );

    for (const change of sortedChanges) {
      validateLineRange(lines, change);

      validateOriginalCode(
        lines,
        change,
      );

      lines = applyChange(
        lines,
        change,
      );

      appliedChanges.push({
        filePath: change.filePath,
        changeType: change.changeType,
        startLine: change.startLine,
        endLine: change.endLine,
      });
    }

    await fs.writeFile(
      absolutePath,
      lines.join("\n"),
      "utf8",
    );
  }

  return appliedChanges;
};