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
        "HTTP-Referer": "http://localhost:8080",
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

          // OpenRouter-specific: only route to providers that really support
          // response_format; otherwise the schema is silently ignored and the
          // model returns free text that fails JSON.parse.
          provider: { require_parameters: true },
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

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

      // 404 "No endpoints found": the routed model cannot honour a strict
      // json_schema. Ask for plain JSON and validate on our side instead.
      if (status === 404 || status === 400) {
        return this.generateStructuredFallback<T>(systemPrompt, userPrompt, schema);
      }

      const message =
        error?.error?.message ??
        error?.message ??
        "Unknown OpenRouter error";

      throw new Error(
        `OpenRouter structured request failed (${status ?? "unknown"}): ${message}`
      );
    }
  }

  private async generateStructuredFallback<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: Record<string, unknown>
  ): Promise<T> {
    try {
      const response = await this.client.chat.completions.create({
        model: aiConfig.openrouterModel,
        messages: [
          {
            role: "system",
            content:
              `${systemPrompt}\n\nRespond with ONLY a single JSON object (no markdown, no commentary) ` +
              `that conforms to this JSON schema:\n${JSON.stringify(schema)}`,
          },
          { role: "user", content: userPrompt },
        ],
      });

      const raw = response.choices[0]?.message?.content ?? "";
      const cleaned = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");

      if (start === -1 || end <= start) {
        throw new Error("OpenRouter fallback returned no JSON object");
      }

      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    } catch (error: any) {
      const message =
        error?.error?.message ?? error?.message ?? "Unknown OpenRouter error";

      throw new Error(
        `OpenRouter structured fallback failed (${error?.status ?? "unknown"}): ${message}`
      );
    }
  }
}