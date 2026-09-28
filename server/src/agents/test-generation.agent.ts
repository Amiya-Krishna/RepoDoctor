import type { AIProvider } from "../ai/ai.provider.js";
import type { RepositoryContext } from "../context/context.types.js";
import type { TestGenerationResult } from "./test-generation.types.js";

import { TEST_GENERATION_JSON_SCHEMA } from "./test-generation.schema.js";
import { TEST_GENERATION_SYSTEM_PROMPT } from "../prompts/test-generation.prompt.js";

export class TestGenerationAgent {
  constructor(private readonly aiProvider: AIProvider) {}
  
  async generate(
    context: RepositoryContext,
    formattedContext: string
  ): Promise<TestGenerationResult> {
    const result =
    await this.aiProvider.generateStructured<TestGenerationResult>(
      TEST_GENERATION_SYSTEM_PROMPT,
      this.buildUserPrompt(context, formattedContext),
      TEST_GENERATION_JSON_SCHEMA
    );
    
    this.validateResult(result, context);
    
    return result;
  }
  
  private buildUserPrompt(
    context: RepositoryContext,
    formattedContext: string
  ): string {
    return `
Generate automated tests for this repository.
    
Repository information:
    
Project type:
    ${context.projectType ?? "unknown"}
    
Language:
    ${context.language ?? "unknown"}
    
Framework:
    ${context.framework ?? "unknown"}
    
Package manager:
    ${context.packageManager ?? "unknown"}
    
Repository context:
    
    ${formattedContext}
`;
  }
  
  private validateResult(
    result: TestGenerationResult,
    context: RepositoryContext
  ): void {
    if (!result || !Array.isArray(result.tests)) {
      throw new Error(
        "Invalid test generation result: tests array is required."
      );
    }
    
    const validPaths = new Set(
      context.files.map((file) => file.path)
    );
    
    for (const test of result.tests) {
      if (!test.title?.trim()) {
        throw new Error(
          "Generated test has an empty title."
        );
      }
      
      if (!test.description?.trim()) {
        throw new Error(
          `Generated test "${test.title}" has no description.`
        );
      }
      
      // The source file being tested MUST exist.
      if (!validPaths.has(test.targetFilePath)) {
        throw new Error(
          `Generated test references unknown target file: ${test.targetFilePath}`
        );
      }
      
      // Generated test file itself does NOT need to exist yet.
      if (!test.filePath?.trim()) {
        throw new Error(
          `Generated test "${test.title}" has no output file path.`
        );
      }
      
      if (!test.testCode?.trim()) {
        throw new Error(
          `Generated test "${test.title}" contains empty test code.`
        );
      }
      
      if (
        typeof test.confidence !== "number" ||
        test.confidence < 0 ||
        test.confidence > 1
      ) {
        throw new Error(
          `Invalid confidence for test "${test.title}".`
        );
      }
    }
  }
}