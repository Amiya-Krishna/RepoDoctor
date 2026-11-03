import OpenAI from "openai";

import type { AIProvider, AIRequestOptions } from "./ai.provider.js";

import { aiConfig } from "./ai.config.js";
import { envPositiveInt } from "../config/env-number.js";

export class GroqProvider implements AIProvider {
  private readonly client: OpenAI;

  // Groq's on-demand tier caps a request at ~8000 tokens per minute; bigger prompts always get a 413.
  readonly maxInputTokens = envPositiveInt("GROQ_MAX_INPUT_TOKENS", 6500);

  constructor() {
    if (!aiConfig.groqApiKey) {
      throw new Error("GROQ_API_KEY is not configured");
    }

    this.client = new OpenAI({
      apiKey: aiConfig.groqApiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }

  readonly providerName = "groq";

  async generate(
    systemPrompt: string,
    userPrompt: string,
    options?: AIRequestOptions
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
      }, { signal: options?.signal });

    return response.choices[0]?.message?.content ?? "";
  }

  async generateStructured<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: Record<string, unknown>,
    options?: AIRequestOptions
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
      }, { signal: options?.signal });

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