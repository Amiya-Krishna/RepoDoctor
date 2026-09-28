export interface AIProvider {
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