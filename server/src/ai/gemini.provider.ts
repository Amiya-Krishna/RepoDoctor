import { GoogleGenAI } from "@google/genai";

import type { AIProvider } from "./ai.provider.js";
import { aiConfig } from "./ai.config.js";

export class GeminiProvider implements AIProvider {
  private readonly client: GoogleGenAI;

  constructor() {
    if (!aiConfig.geminiApiKey) {
      throw new Error(
        "GEMINI_API_KEY is not configured"
      );
    }

    this.client = new GoogleGenAI({
      apiKey: aiConfig.geminiApiKey,
    });
  }

  async generate(
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    const response =
      await this.client.models.generateContent({
        model: aiConfig.geminiModel,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${systemPrompt}\n\n${userPrompt}`,
              },
            ],
          },
        ],
      });

    return response.text ?? "";
  }

  async generateStructured<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: Record<string, unknown>
  ): Promise<T> {
    const response =
      await this.client.models.generateContent({
        model: aiConfig.geminiModel,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${systemPrompt}\n\n${userPrompt}`,
              },
            ],
          },
        ],
        config: {
          responseMimeType:
            "application/json",
          responseSchema: schema,
        },
      });

    const content = response.text;

    if (!content) {
      throw new Error(
        "Gemini returned an empty structured response"
      );
    }

    return JSON.parse(content) as T;
  }
}