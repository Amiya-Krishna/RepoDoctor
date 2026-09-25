export interface AIProvider {
  generate(
    systemPrompt: string,
    userPrompt: string
  ): Promise<string>;
}