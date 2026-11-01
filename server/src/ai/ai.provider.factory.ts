import type { AIProvider } from "./ai.provider.js";

import { isProviderConfigured } from "./ai.config.js";
import { OpenRouterProvider } from "./openrouter.provider.js";
import { GroqProvider } from "./groq.provider.js";
import { GeminiProvider } from "./gemini.provider.js";
import { LocalProvider } from "./local.provider.js";
import { AIProviderManager } from "./ai.provider.manager.js";
import { GuardedAIProvider, type EgressRecord } from "./guarded.provider.js";

export interface ProviderRequest {
  /** Result of evaluateAIEgress(); there is deliberately no way to build a provider without one. */
  mode: "CLOUD" | "LOCAL";
  onEgress: (record: EgressRecord) => Promise<void> | void;
}

/**
 * CLOUD: OpenRouter -> Groq -> Gemini (only providers with a key take part).
 * LOCAL: the self-hosted endpoint only. There is no fallback from LOCAL to
 * CLOUD, so a user who chose self-hosted never leaks to a third party.
 *
 * The result is always wrapped in GuardedAIProvider (redaction, size limit,
 * audit hook). Callers obtain `mode` from the privacy service, which fails
 * closed when consent is missing.
 */
export const createAIProvider = (request: ProviderRequest): AIProvider => {
  const providers: AIProvider[] = [];

  if (request.mode === "LOCAL") {
    providers.push(new LocalProvider());
  } else {
    if (isProviderConfigured.openrouter()) providers.push(new OpenRouterProvider());
    if (isProviderConfigured.groq()) providers.push(new GroqProvider());
    if (isProviderConfigured.gemini()) providers.push(new GeminiProvider());
  }

  return new GuardedAIProvider(new AIProviderManager(providers), {
    mode: request.mode,
    onEgress: request.onEgress,
  });
};
