import type { AIProvider } from "./ai.provider.js";

import { OpenRouterProvider } from "./openrouter.provider.js";
import { GroqProvider } from "./groq.provider.js";
import { GeminiProvider } from "./gemini.provider.js";
import { AIProviderManager } from "./ai.provider.manager.js";

export const createAIProvider = (): AIProvider => {
  return new AIProviderManager([
    new OpenRouterProvider(),
    new GroqProvider(),
    new GeminiProvider(),
  ]);
};