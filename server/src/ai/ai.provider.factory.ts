import type { AIProvider } from "./ai.provider.js";

import { isProviderConfigured } from "./ai.config.js";
import { OpenRouterProvider } from "./openrouter.provider.js";
import { GroqProvider } from "./groq.provider.js";
import { GeminiProvider } from "./gemini.provider.js";
import { AIProviderManager } from "./ai.provider.manager.js";

// Providers are tried in this order (OpenRouter -> Groq -> Gemini). Only the
// providers whose API key is configured take part, so a single key is enough.
export const createAIProvider = (): AIProvider => {
  const providers: AIProvider[] = [];

  if (isProviderConfigured.openrouter()) providers.push(new OpenRouterProvider());
  if (isProviderConfigured.groq()) providers.push(new GroqProvider());
  if (isProviderConfigured.gemini()) providers.push(new GeminiProvider());

  return new AIProviderManager(providers);
};
