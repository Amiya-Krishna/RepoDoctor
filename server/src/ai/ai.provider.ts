export interface AIRequestOptions {
  /** Aborted when consent is withdrawn (or the caller gives up). Providers pass it to their SDK where supported. */
  signal?: AbortSignal;
}

export interface AIProvider {
  /** Approximate maximum request size in tokens; larger requests skip this provider. */
  readonly maxInputTokens?: number;

  /** Short label for logs (never a secret). */
  readonly providerName?: string;

  generate(
    systemPrompt: string,
    userPrompt: string,
    options?: AIRequestOptions,
  ): Promise<string>;

  generateStructured<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: Record<string, unknown>,
    options?: AIRequestOptions,
  ): Promise<T>;
}
