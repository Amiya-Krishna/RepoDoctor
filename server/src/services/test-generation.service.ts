import type { AIProvider } from "../ai/ai.provider.js";
import { TestGenerationAgent } from "../agents/test-generation.agent.js";

import type { RepositoryContext } from "../context/context.types.js";
import type { TestGenerationResult } from "../agents/test-generation.types.js";

export const runTestGeneration = async (
  context: RepositoryContext,
  formattedContext: string,
  aiProvider: AIProvider,
): Promise<TestGenerationResult> => {
  const agent = new TestGenerationAgent(aiProvider);

  return agent.generate(
    context,
    formattedContext
  );
};