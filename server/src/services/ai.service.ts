import { AIProvider } from "../ai/ai.provider.js";
import { OpenRouterProvider } from "../ai/openrouter.provider.js";

const provider: AIProvider = new OpenRouterProvider();

export const generateAIResponse = async (
  systemPrompt: string,
  userPrompt: string
) => {
  return provider.generate(systemPrompt, userPrompt);
};