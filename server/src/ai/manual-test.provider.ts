import { createAIProvider } from "./ai.provider.factory.js";
import type { AIProvider } from "./ai.provider.js";

/**
 * For the manual `npm run test:*` scripts that call a live model with bundled
 * fixture repositories only. Requires an explicit opt-in so it cannot be used
 * by accident against real user code; the production code path never uses it.
 */
export const createManualTestProvider = (): AIProvider => {
  if (process.env.REPODOCTOR_ALLOW_MANUAL_AI !== "1") {
    throw new Error("Manual AI scripts send fixture code to the configured model. Set REPODOCTOR_ALLOW_MANUAL_AI=1 to proceed.");
  }
  const mode = process.env.LOCAL_AI_BASE_URL && process.env.LOCAL_AI_MODEL ? "LOCAL" : "CLOUD";
  return createAIProvider({ mode, onEgress: () => undefined });
};
