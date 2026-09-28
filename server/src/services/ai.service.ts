import { createAIProvider } from "../ai/ai.provider.factory.js";
import type { AIProvider } from "../ai/ai.provider.js";

const provider = createAIProvider();

export const generateAIResponse = async <T>(
  systemPrompt: string,
  userPrompt: string,
  schema?: Record<string, unknown>
): Promise<T> => {
  if (schema) {
    return provider.generateStructured<T>(
      systemPrompt,
      userPrompt,
      schema
    );
  }

  const result = await provider.generate(
    systemPrompt,
    userPrompt
  );

  return result as T;
};