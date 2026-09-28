import type { AIProvider } from "../ai/ai.provider.js";
import type { RepositoryContext } from "../context/context.types.js";
import type { BugDetectionResult } from "./bug-detection.types.js";

import { BUG_DETECTION_JSON_SCHEMA } from "./bug-detection.schema.js";
import { BUG_DETECTION_SYSTEM_PROMPT } from "../prompts/bug-detection.prompt.js";

export class BugDetectionAgent {
  constructor(
    private readonly aiProvider: AIProvider
  ) {}

  async detect(
    context: RepositoryContext,
    formattedContext: string
  ): Promise<BugDetectionResult> {
    const userPrompt = `
Analyze the following repository context for genuine bugs.

Repository ID:
${context.repositoryId}

Project type:
${context.projectType ?? "unknown"}

Language:
${context.language ?? "unknown"}

Framework:
${context.framework ?? "unknown"}

Package manager:
${context.packageManager ?? "unknown"}

Repository source:

${formattedContext}

Return only findings that are supported by the provided code.
`;

    const result =
      await this.aiProvider.generateStructured<BugDetectionResult>(
        BUG_DETECTION_SYSTEM_PROMPT,
        userPrompt,
        BUG_DETECTION_JSON_SCHEMA
      );

    return this.validateResult(result, context);
  }

  private validateResult(
    result: BugDetectionResult,
    context: RepositoryContext
  ): BugDetectionResult {
    if (!result || !Array.isArray(result.findings)) {
      throw new Error("Invalid bug detection result");
    }

    const availableFiles = new Set(
      context.files.map((file) => file.path)
    );

    const fileMap = new Map(
      context.files.map((file) => [
        file.path,
        file,
      ])
    );

    const validFindings = result.findings.filter(
      (finding) => {
        if (!availableFiles.has(finding.filePath)) {
          return false;
        }

        const file = fileMap.get(
          finding.filePath
        );

        if (!file) {
          return false;
        }

        const lineCount =
          file.content.split("\n").length;

        if (
          finding.lineStart < 1 ||
          finding.lineEnd < finding.lineStart ||
          finding.lineEnd > lineCount
        ) {
          return false;
        }

        return (
          finding.title.length > 0 &&
          finding.description.length > 0 &&
          finding.evidence.length > 0 &&
          finding.suggestedFix.length > 0 &&
          finding.confidence >= 0 &&
          finding.confidence <= 1
        );
      }
    );

    return {
      findings: validFindings,
    };
  }
}