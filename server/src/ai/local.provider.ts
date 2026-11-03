import OpenAI from "openai";
import type { AIProvider, AIRequestOptions } from "./ai.provider.js";

/**
 * Self-hosted model through an OpenAI-compatible endpoint (Ollama /v1,
 * llama.cpp server, vLLM, LM Studio...). Code never leaves the operator's
 * network in this mode.
 */
export class LocalProvider implements AIProvider {
  private readonly client: OpenAI;

  constructor(
    baseURL = process.env.LOCAL_AI_BASE_URL ?? "",
    private readonly model = process.env.LOCAL_AI_MODEL ?? "",
    apiKey = process.env.LOCAL_AI_API_KEY || "local",
  ) {
    if (!/^https?:\/\//i.test(baseURL)) {
      throw new Error("LOCAL_AI_BASE_URL must be an http(s) URL");
    }
    if (!model) throw new Error("LOCAL_AI_MODEL is required for self-hosted AI");
    this.client = new OpenAI({ apiKey, baseURL, timeout: 10 * 60_000, maxRetries: 0 });
  }

  readonly providerName = "local";

  async generate(systemPrompt: string, userPrompt: string, options?: AIRequestOptions): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }, { signal: options?.signal });
    return response.choices[0]?.message?.content ?? "";
  }

  async generateStructured<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: Record<string, unknown>,
    options?: AIRequestOptions,
  ): Promise<T> {
    const raw = await this.generate(
      `${systemPrompt}\n\nRespond with ONLY a single JSON object (no markdown, no commentary) conforming to this JSON schema:\n${JSON.stringify(schema)}`,
      userPrompt,
      options,
    );
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("Local model returned no JSON object");
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    } catch {
      throw new Error("Local model returned invalid JSON");
    }
  }
}
