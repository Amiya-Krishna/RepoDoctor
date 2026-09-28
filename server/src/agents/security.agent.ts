import type { AIProvider } from "../ai/ai.provider.js";
import type { RepositoryContext } from "../context/context.types.js";
import type { SecurityDetectionResult } from "./security.types.js";

import { SECURITY_DETECTION_JSON_SCHEMA } from "./security.schema.js";
import { SECURITY_SYSTEM_PROMPT } from "../prompts/security.prompt.js";

export class SecurityAgent {
  constructor(
    private readonly aiProvider: AIProvider
  ) {}

  async detect(
    context: RepositoryContext,
    formattedContext: string
  ): Promise<SecurityDetectionResult> {
    const userPrompt = `
Analyze the following JavaScript/TypeScript repository
for genuine security vulnerabilities.

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

Only report vulnerabilities supported by the provided code.

Do not invent vulnerabilities.

Do not expose complete secret values in the response.
`;

    const result =
      await this.aiProvider.generateStructured<SecurityDetectionResult>(
        SECURITY_SYSTEM_PROMPT,
        userPrompt,
        SECURITY_DETECTION_JSON_SCHEMA
      );

    return this.validateResult(
      result,
      context
    );
  }

  private validateResult(
    result: SecurityDetectionResult,
    context: RepositoryContext
  ): SecurityDetectionResult {
    if (
      !result ||
      !Array.isArray(result.findings)
    ) {
      throw new Error(
        "Invalid security detection result"
      );
    }

    const fileMap = new Map(
      context.files.map((file) => [
        file.path,
        file,
      ])
    );

    const validFindings =
      result.findings.filter((finding) => {
        if (
          !finding.filePath ||
          !finding.title ||
          !finding.description
        ) {
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
          finding.lineEnd <
            finding.lineStart ||
          finding.lineEnd >
            lineCount
        ) {
          return false;
        }

        if (
          finding.confidence < 0 ||
          finding.confidence > 1
        ) {
          return false;
        }

        return true;
      });

    return {
      findings: validFindings,
    };
  }
}