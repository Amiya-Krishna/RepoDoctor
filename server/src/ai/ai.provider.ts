export interface AIProvider {
  /** Approximate maximum request size in tokens; larger requests skip this provider. */
  readonly maxInputTokens?: number;

  generate(
    systemPrompt: string,
    userPrompt: string
  ): Promise<string>;

  generateStructured<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: Record<string, unknown>
  ): Promise<T>;
}