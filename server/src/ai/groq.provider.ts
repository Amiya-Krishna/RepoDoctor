import OpenAI from "openai";

import type { AIProvider } from "./ai.provider.js";

import { aiConfig } from "./ai.config.js";

export class GroqProvider implements AIProvider {
  private readonly client: OpenAI;

  constructor() {
    if (!aiConfig.groqApiKey) {
      throw new Error("GROQ_API_KEY is not configured");
    }

    this.client = new OpenAI({
      apiKey: aiConfig.groqApiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }

  async generate(
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    const response =
      await this.client.chat.completions.create({
        model: aiConfig.groqModel,
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
        model: aiConfig.groqModel,

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
        "Groq returned an empty structured response"
      );
    }

    try {
      return JSON.parse(content) as T;
    } catch {
      throw new Error(
        "Groq returned invalid JSON"
      );
    }
  }
}