import type { AIProvider } from "./ai.provider.js";

const TRANSIENT_RETRIES = Number(process.env.AI_TRANSIENT_RETRIES ?? 2);
const RETRY_BASE_DELAY_MS = Number(process.env.AI_RETRY_BASE_DELAY_MS ?? 3000);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rough token estimate (about four characters per token). */
const estimateTokens = (...parts: string[]): number =>
  Math.ceil(parts.reduce((total, part) => total + part.length, 0) / 4);

/**
 * Temporary provider trouble (overload, rate limit, network) is worth waiting
 * out. Deterministic failures (request too large, bad model, bad key) are not.
 */
const isTransient = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);

  if (/request too large|\b413\b|\b401\b|\b403\b|\b404\b|invalid api key/i.test(message)) {
    return false;
  }

  return /\b(429|500|502|503|504)\b|UNAVAILABLE|overloaded|high demand|rate limit|temporarily|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|timeout/i.test(
    message,
  );
};

export class AIProviderManager implements AIProvider {
  constructor(private readonly providers: AIProvider[]) {
    if (providers.length === 0) {
      throw new Error("No AI providers configured");
    }
  }

  private async run<T>(
    estimatedTokens: number,
    call: (provider: AIProvider) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;

    for (const [index, provider] of this.providers.entries()) {
      const providerName = provider.constructor.name;

      if (provider.maxInputTokens && estimatedTokens > provider.maxInputTokens) {
        console.warn(
          `[AI] Skipping provider ${index + 1}: ${providerName} (request ~${estimatedTokens} tokens exceeds its ~${provider.maxInputTokens} limit)`,
        );
        lastError = new Error(
          `${providerName} skipped: request too large (~${estimatedTokens} tokens)`,
        );
        continue;
      }

      for (let attempt = 0; attempt <= TRANSIENT_RETRIES; attempt++) {
        console.log(
          `[AI] Trying provider ${index + 1}: ${providerName}${attempt > 0 ? ` (retry ${attempt}/${TRANSIENT_RETRIES})` : ""}`,
        );

        try {
          const result = await call(provider);
          console.log(`[AI] ${providerName} succeeded`);
          return result;
        } catch (error) {
          lastError = error;
          console.error(`[AI] ${providerName} failed`);

          if (error instanceof Error) {
            console.error(`[AI] Error: ${error.message}`);
          }

          if (!isTransient(error) || attempt === TRANSIENT_RETRIES) {
            break;
          }

          const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
          console.warn(`[AI] Temporary error, retrying ${providerName} in ${delay / 1000}s`);
          await sleep(delay);
        }
      }
    }

    throw new Error(
      `All AI providers failed: ${
        lastError instanceof Error ? lastError.message.slice(0, 300) : String(lastError)
      }`,
      { cause: lastError },
    );
  }

  generate(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.run(estimateTokens(systemPrompt, userPrompt), (provider) =>
      provider.generate(systemPrompt, userPrompt),
    );
  }

  generateStructured<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: Record<string, unknown>,
  ): Promise<T> {
    return this.run(
      estimateTokens(systemPrompt, userPrompt, JSON.stringify(schema)),
      (provider) => provider.generateStructured<T>(systemPrompt, userPrompt, schema),
    );
  }
}
