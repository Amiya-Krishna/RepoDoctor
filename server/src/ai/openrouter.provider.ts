import OpenAI from "openai";

import type { AIProvider } from "./ai.provider.js";
import { aiConfig } from "./ai.config.js";

export class OpenRouterProvider implements AIProvider {
  private readonly client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: aiConfig.apiKey,
      baseURL: "https://openrouter.ai/api/v1",
    });
  }

  async generate(
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    const response =
      await this.client.chat.completions.create({
        model: aiConfig.model,
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
  }

  async generateStructured<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: Record<string, unknown>
  ): Promise<T> {
    const response =
      await this.client.chat.completions.create({
        model: aiConfig.model,
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
            name: "repodoctor_bug_detection",
            strict: true,
            schema,
          },
        },
      });

    const content =
      response.choices[0]?.message?.content;

    if (!content) {
      throw new Error(
        "AI returned an empty structured response"
      );
    }

    return JSON.parse(content) as T;
  }
}