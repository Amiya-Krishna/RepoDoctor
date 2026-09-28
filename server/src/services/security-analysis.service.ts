import { createAIProvider } from "../ai/ai.provider.factory.js";
import { SecurityAgent } from "../agents/security.agent.js";

import type { RepositoryContext } from "../context/context.types.js";
import type { SecurityDetectionResult } from "../agents/security.types.js";

export const runSecurityAnalysis = async (
  context: RepositoryContext,
  formattedContext: string
): Promise<SecurityDetectionResult> => {
  const aiProvider = createAIProvider();

  const agent = new SecurityAgent(
    aiProvider
  );

  return agent.detect(
    context,
    formattedContext
  );
};