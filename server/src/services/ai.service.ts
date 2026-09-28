import { OpenRouterProvider } from "../ai/openrouter.provider.js";
import type { AIProvider } from "../ai/ai.provider.js";

const provider: AIProvider = new OpenRouterProvider();

export const generateAIResponse = async <T>(
  systemPrompt: string,
  userPrompt: string,
  schema?: Record<string, unknown>,
  schemaName?: string
): Promise<T> => {
  if (schema && schemaName) {
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