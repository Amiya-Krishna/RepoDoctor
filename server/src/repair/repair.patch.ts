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

/**
 * Raised when a proposed change cannot be applied to the real file. The retry
 * loop treats this as recoverable: the message is fed back to the model.
 */
export class RepairPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepairPatchError";
  }
}

const MAX_RELOCATION_DISTANCE = 25;

const normalizeBlock = (code: string): string[] => {
  const lines = code
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim());

  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  return lines;
};

const blockMatchesAt = (
  lines: string[],
  expected: string[],
  startIndex: number,
): boolean => {
  if (startIndex < 0 || startIndex + expected.length > lines.length) {
    return false;
  }

  return expected.every(
    (line, offset) => lines[startIndex + offset].trim() === line,
  );
};

/**
 * Confirms that the code the model says it is replacing really is in the file.
 *
 * Comparison ignores indentation and line-ending differences. Models often
 * get line numbers slightly wrong, so when the stated range does not match,
 * the block is searched for nearby and the change is moved to where it
 * actually is. Anything else is a hard mismatch.
 */
const resolveOriginalCode = (
  lines: string[],
  change: FixChange,
): FixChange => {
  if (change.changeType !== "REPLACE") {
    return change;
  }

  const expected = normalizeBlock(change.originalCode);
  const statedIndex = change.startLine - 1;

  if (
    expected.length > 0 &&
    blockMatchesAt(lines, expected, statedIndex) &&
    change.endLine - change.startLine + 1 === expected.length
  ) {
    return change;
  }

  if (expected.length > 0) {
    const candidates: number[] = [];

    for (let index = 0; index + expected.length <= lines.length; index++) {
      if (blockMatchesAt(lines, expected, index)) {
        candidates.push(index);
      }
    }

    const closest = candidates
      .map((index) => ({ index, distance: Math.abs(index - statedIndex) }))
      .sort((a, b) => a.distance - b.distance)[0];

    if (closest && closest.distance <= MAX_RELOCATION_DISTANCE) {
      return {
        ...change,
        startLine: closest.index + 1,
        endLine: closest.index + expected.length,
      };
    }
  }

  const actual = lines
    .slice(Math.max(0, statedIndex), change.endLine)
    .join("\n")
    .slice(0, 600);

  throw new RepairPatchError(
    `Original code mismatch for ${change.filePath} at lines ${change.startLine}-${change.endLine}. ` +
      `The file actually contains at those lines:\n${actual}\n` +
      "Copy originalCode exactly from the repository context and use the correct line numbers.",
  );
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
    const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";

    /*
     * Apply from bottom to top so line numbers from
     * the FixAgent remain stable.
     */
    const sortedChanges = [...changes].sort(
      (a, b) =>
        b.startLine - a.startLine ||
        b.endLine - a.endLine,
    );

    for (const proposedChange of sortedChanges) {
      validateLineRange(lines, proposedChange);

      const change = resolveOriginalCode(
        lines,
        proposedChange,
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
      lines.join(lineEnding),
      "utf8",
    );
  }

  return appliedChanges;
};