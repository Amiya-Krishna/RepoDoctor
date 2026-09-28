import { createAIProvider } from "../ai/ai.provider.factory.js";
import { TestGenerationAgent } from "../agents/test-generation.agent.js";

import type { RepositoryContext } from "../context/context.types.js";
import type { TestGenerationResult } from "../agents/test-generation.types.js";

export const runTestGeneration = async (
  context: RepositoryContext,
  formattedContext: string
): Promise<TestGenerationResult> => {
  const aiProvider = createAIProvider();

  const agent = new TestGenerationAgent(aiProvider);

  return agent.generate(
    context,
    formattedContext
  );
};