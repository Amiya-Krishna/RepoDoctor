/**
 * Short, secret-free description of an error for logs.
 *
 * Never log a raw Axios error: it embeds the request config, including the
 * `Authorization: Bearer <token>` header (e.g. a user's GitHub OAuth token).
 */
export function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const e = error as {
      isAxiosError?: boolean;
      response?: { status?: number; data?: { message?: unknown } };
      message?: unknown;
      code?: unknown;
    };
    if (e.isAxiosError) {
      const status = e.response?.status ?? e.code ?? "no response";
      const detail = typeof e.response?.data?.message === "string"
        ? e.response.data.message
        : typeof e.message === "string" ? e.message : "request failed";
      return `HTTP ${status}: ${detail}`;
    }
    if (typeof e.message === "string") return e.message;
  }
  return "Unknown error";
}

/** HTTP status of an upstream (Axios) error, if there is one. */
export function upstreamStatus(error: unknown): number | undefined {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === "number" ? status : undefined;
}
