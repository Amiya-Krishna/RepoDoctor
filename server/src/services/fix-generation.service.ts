import { createAIProvider } from "../ai/ai.provider.factory.js";

import { FixAgent } from "../agents/fix.agent.js";

import type { RepositoryContext } from "../context/context.types.js";
import type { BugFinding } from "../agents/bug-detection.types.js";
import type { SecurityFinding } from "../agents/security.types.js";
import type { FixResult } from "../agents/fix.types.js";

type SupportedFinding =
  | BugFinding
  | SecurityFinding;

export const generateFix = async (
  finding: SupportedFinding,
  context: RepositoryContext,
  formattedContext: string
): Promise<FixResult> => {
  const aiProvider =
    createAIProvider();

  const agent =
    new FixAgent(aiProvider);

  return agent.generateFix(
    finding,
    context,
    formattedContext
  );
};