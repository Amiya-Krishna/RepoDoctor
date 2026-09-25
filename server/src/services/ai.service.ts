import { AIProvider } from "../ai/ai.provider";
import { OpenRouterProvider } from "../ai/openrouter.provider";

const provider: AIProvider = new OpenRouterProvider();

export const generateAIResponse = async (
  systemPrompt: string,
  userPrompt: string
) => {
  return provider.generate(systemPrompt, userPrompt);
};