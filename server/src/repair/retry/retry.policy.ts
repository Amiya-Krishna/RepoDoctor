import type { RetryPolicy } from "./retry.types.js";

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
};

export const canRetry = (
  attemptNumber: number,
  policy: RetryPolicy,
): boolean => {
  return attemptNumber < policy.maxAttempts;
};