import type { AIProvider } from "./ai.provider.js";

export class AIProviderManager
  implements AIProvider
{
  constructor(
    private readonly providers: AIProvider[]
  ) {
    if (providers.length === 0) {
      throw new Error(
        "No AI providers configured"
      );
    }
  }

  async generate(
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    let lastError: unknown;

    for (const [index, provider] of this.providers.entries()) {
      const providerName =
        provider.constructor.name;

      console.log(
        `[AI] Trying provider ${index + 1}: ${providerName}`
      );

      try {
        const result =
          await provider.generate(
            systemPrompt,
            userPrompt
          );

        console.log(
          `[AI] ${providerName} succeeded`
        );

        return result;
      } catch (error) {
        lastError = error;

        console.error(
          `[AI] ${providerName} failed`
        );

        if (error instanceof Error) {
          console.error(
            `[AI] Error: ${error.message}`
          );
        }
      }
    }

    throw new Error(
      "All AI providers failed",
      {
        cause: lastError,
      }
    );
  }

  async generateStructured<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: Record<string, unknown>
  ): Promise<T> {
    let lastError: unknown;

    for (const [index, provider] of this.providers.entries()) {
      const providerName =
        provider.constructor.name;

      console.log(
        `[AI] Trying provider ${index + 1}: ${providerName}`
      );

      try {
        const result =
          await provider.generateStructured<T>(
            systemPrompt,
            userPrompt,
            schema
          );

        console.log(
          `[AI] ${providerName} succeeded`
        );

        return result;
      } catch (error) {
        lastError = error;

        console.error(
          `[AI] ${providerName} failed`
        );

        if (error instanceof Error) {
          console.error(
            `[AI] Error: ${error.message}`
          );
        }
      }
    }

    throw new Error(
      "All AI providers failed",
      {
        cause: lastError,
      }
    );
  }
}