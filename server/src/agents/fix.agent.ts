import type { AIProvider } from "../ai/ai.provider.js";
import type { RepositoryContext } from "../context/context.types.js";
import type { BugFinding } from "./bug-detection.types.js";
import type { SecurityFinding } from "./security.types.js";
import type { FixResult } from "./fix.types.js";

import { FIX_RESULT_JSON_SCHEMA } from "./fix.schema.js";
import { FIX_SYSTEM_PROMPT } from "../prompts/fix.prompt.js";

type SupportedFinding =
  | BugFinding
  | SecurityFinding;

export class FixAgent {
  constructor(
    private readonly aiProvider: AIProvider
  ) {}

  async generateFix(
    finding: SupportedFinding,
    context: RepositoryContext,
    formattedContext: string
  ): Promise<FixResult> {
    const result =
      await this.aiProvider.generateStructured<FixResult>(
        FIX_SYSTEM_PROMPT,
        this.buildUserPrompt(
          finding,
          context,
          formattedContext
        ),
        FIX_RESULT_JSON_SCHEMA
      );

    this.validateResult(
      result,
      finding,
      context
    );

    return result;
  }

  private buildUserPrompt(
    finding: SupportedFinding,
    context: RepositoryContext,
    formattedContext: string
  ): string {
    return `
Generate a proposed code fix for the following finding.

FINDING:

${JSON.stringify(finding, null, 2)}

REPOSITORY INFORMATION:

Project type:
${context.projectType ?? "unknown"}

Language:
${context.language ?? "unknown"}

Framework:
${context.framework ?? "unknown"}

Package manager:
${context.packageManager ?? "unknown"}

REPOSITORY CONTEXT:

${formattedContext}
`;
  }

  private validateResult(
    result: FixResult,
    finding: SupportedFinding,
    context: RepositoryContext
  ): void {
    if (!result) {
      throw new Error(
        "Fix Agent returned an empty result."
      );
    }

    if (!result.title?.trim()) {
      throw new Error(
        "Fix result has no title."
      );
    }

    if (!result.summary?.trim()) {
      throw new Error(
        "Fix result has no summary."
      );
    }

    if (!Array.isArray(result.changes)) {
      throw new Error(
        "Fix result changes must be an array."
      );
    }

    if (
      typeof result.confidence !== "number" ||
      result.confidence < 0 ||
      result.confidence > 1
    ) {
      throw new Error(
        "Fix confidence must be between 0 and 1."
      );
    }

    const validPaths = new Set(
      context.files.map(
        (file) => file.path
      )
    );

    const targetFile =
      context.files.find(
        (file) =>
          file.path === finding.filePath
      );

    if (!targetFile) {
      throw new Error(
        `Finding file does not exist in context: ${finding.filePath}`
      );
    }

    const lines =
      targetFile.content.split("\n");

    for (const change of result.changes) {
      if (!validPaths.has(change.filePath)) {
        throw new Error(
          `Fix references unknown file: ${change.filePath}`
        );
      }

      if (
        change.startLine < 1 ||
        change.endLine < change.startLine
      ) {
        throw new Error(
          `Invalid line range in fix: ${change.filePath}`
        );
      }

      const target =
        context.files.find(
          (file) =>
            file.path === change.filePath
        );

      if (!target) {
        throw new Error(
          `Target file not found: ${change.filePath}`
        );
      }

      const targetLines =
        target.content.split("\n");

      if (
        change.endLine >
        targetLines.length
      ) {
        throw new Error(
          `Fix line range exceeds file length: ${change.filePath}`
        );
      }

      if (
        change.changeType ===
          "REPLACE" &&
        !change.originalCode.trim()
      ) {
        throw new Error(
          `REPLACE change requires originalCode: ${change.filePath}`
        );
      }

      if (
        change.changeType ===
          "INSERT" &&
        change.replacementCode.trim() === ""
      ) {
        throw new Error(
          `INSERT change requires replacementCode: ${change.filePath}`
        );
      }
    }

    if (result.changes.length === 0) {
      throw new Error(
        "Fix Agent returned no changes."
      );
    }

    // Ensure the finding itself is represented
    // by at least one relevant change.
    const affectsFindingFile =
      result.changes.some(
        (change) =>
          change.filePath ===
          finding.filePath
      );

    if (!affectsFindingFile) {
      throw new Error(
        "Generated fix does not affect the finding's file."
      );
    }

    // Prevent accidental mutation in this stage.
    void lines;
  }
}