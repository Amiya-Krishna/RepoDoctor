import type { AIProvider } from "../ai/ai.provider.js";
import { SecurityAgent } from "../agents/security.agent.js";

import type { RepositoryContext } from "../context/context.types.js";
import type { SecurityDetectionResult } from "../agents/security.types.js";

export const runSecurityAnalysis = async (
  context: RepositoryContext,
  formattedContext: string,
  aiProvider: AIProvider,
): Promise<SecurityDetectionResult> => {
  const agent = new SecurityAgent(
    aiProvider
  );

  return agent.detect(
    context,
    formattedContext
  );
};