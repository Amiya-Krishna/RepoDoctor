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
  /** Fresh consent check run before EVERY model call (see GuardedProviderOptions.authorize). */
  authorize: (mode: "CLOUD" | "LOCAL") => Promise<void>;
  recheckMs?: number;
  /** Test seam: replaces the real leaf providers. Never used in production code paths. */
  leafProviders?: AIProvider[];
}

/**
 * CLOUD: OpenRouter -> Groq -> Gemini (only providers with a key take part).
 * LOCAL: the self-hosted endpoint only. There is no fallback from LOCAL to
 * CLOUD, so a user who chose self-hosted never leaks to a third party.
 *
 * EVERY leaf provider is wrapped in its own GuardedAIProvider, so redaction, the secret re-scan,
 * the size limit, a fresh consent check and the audit record happen for each actual model call:
 * including each transient retry and each fallback to the next provider inside the manager.
 */
export const createAIProvider = (request: ProviderRequest): AIProvider => {
  const leaves: AIProvider[] = [];

  if (request.leafProviders) {
    leaves.push(...request.leafProviders);
  } else if (request.mode === "LOCAL") {
    leaves.push(new LocalProvider());
  } else {
    if (isProviderConfigured.openrouter()) leaves.push(new OpenRouterProvider());
    if (isProviderConfigured.groq()) leaves.push(new GroqProvider());
    if (isProviderConfigured.gemini()) leaves.push(new GeminiProvider());
  }

  const guarded = leaves.map(
    (leaf) =>
      new GuardedAIProvider(leaf, {
        mode: request.mode,
        onEgress: request.onEgress,
        authorize: request.authorize,
        recheckMs: request.recheckMs,
      }),
  );
  return new AIProviderManager(guarded);
};
