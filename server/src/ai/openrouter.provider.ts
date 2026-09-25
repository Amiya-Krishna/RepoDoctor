import OpenAI from "openai";
import { AIProvider } from "./ai.provider";
import { aiConfig } from "./ai.config";

export class OpenRouterProvider implements AIProvider {
  private client: OpenAI;

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
    const response = await this.client.chat.completions.create({
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
}