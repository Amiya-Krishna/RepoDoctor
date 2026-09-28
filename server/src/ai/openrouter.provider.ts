import OpenAI from "openai";

import type { AIProvider } from "./ai.provider.js";
import { aiConfig } from "./ai.config.js";

export class OpenRouterProvider implements AIProvider {
  private readonly client: OpenAI;

  constructor() {
    if (!aiConfig.openrouterKey) {
      throw new Error(
        "OPENROUTER_API_KEY is not configured"
      );
    }

    this.client = new OpenAI({
      apiKey: aiConfig.openrouterKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "http://localhost:5000",
        "X-Title": "RepoDoctor AI",
      },
    });
  }

  async generate(
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    try {
      const response =
        await this.client.chat.completions.create({
          model: aiConfig.openrouterModel,

          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: userPrompt,
            },
          ],
        });

      return response.choices[0]?.message?.content ?? "";
    } catch (error: any) {
      const status = error?.status;

      const message =
        error?.error?.message ??
        error?.message ??
        "Unknown OpenRouter error";

      throw new Error(
        `OpenRouter request failed (${status ?? "unknown"}): ${message}`
      );
    }
  }

  async generateStructured<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: Record<string, unknown>
  ): Promise<T> {
    try {
      const response =
        await this.client.chat.completions.create({
          model: aiConfig.openrouterModel,

          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: userPrompt,
            },
          ],

          response_format: {
            type: "json_schema",

            json_schema: {
              name: "repodoctor_structured_output",
              strict: true,
              schema,
            },
          },
        });

      const content =
        response.choices[0]?.message?.content;

      if (!content) {
        throw new Error(
          "OpenRouter returned an empty structured response"
        );
      }

      try {
        return JSON.parse(content) as T;
      } catch {
        throw new Error(
          "OpenRouter returned invalid JSON"
        );
      }
    } catch (error: any) {
      const status = error?.status;

      const message =
        error?.error?.message ??
        error?.message ??
        "Unknown OpenRouter error";

      throw new Error(
        `OpenRouter structured request failed (${status ?? "unknown"}): ${message}`
      );
    }
  }
}