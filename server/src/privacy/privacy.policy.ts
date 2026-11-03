/**
 * Pure privacy policy: decides whether repository-derived text may leave this
 * server for a language model. No I/O so it can be unit tested exhaustively.
 */

export type DataMode = "NONE" | "CLOUD" | "LOCAL";

/** Bump when the consent text materially changes; older consents stop working. */
export const CURRENT_CONSENT_VERSION = 1;

/** Consent older than this stops working and must be re-confirmed (CONSENT_MAX_AGE_DAYS overrides). */
export const DEFAULT_CONSENT_MAX_AGE_DAYS = 365;

export const DEFAULT_RETENTION_DAYS = 30;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 365;

export interface PrivacySettingsView {
  dataMode: DataMode;
  consentVersion: number | null;
  consentedAt: Date | null;
  retentionDays: number;
  notifyOnCritical: boolean;
}

/** Safest configuration: nothing is sent anywhere until the user decides. */
export const DEFAULT_PRIVACY_SETTINGS: PrivacySettingsView = {
  dataMode: "NONE",
  consentVersion: null,
  consentedAt: null,
  retentionDays: DEFAULT_RETENTION_DAYS,
  notifyOnCritical: true,
};

export class PrivacyPolicyError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NO_MODE_SELECTED"
      | "CONSENT_MISSING"
      | "CONSENT_OUTDATED"
      | "CONSENT_EXPIRED"
      | "MODE_CHANGED"
      | "LOCAL_AI_NOT_CONFIGURED"
      | "CLOUD_AI_NOT_CONFIGURED"
      | "PROMPT_TOO_LARGE"
      | "SECRET_REMAINS",
    /** Actionable text shown to the user. */
    readonly recovery: string,
  ) {
    super(message);
    this.name = "PrivacyPolicyError";
  }
}

export interface EgressEnvironment {
  localAiBaseUrl?: string;
  cloudProvidersConfigured: boolean;
  /** Consent older than this many days is expired. Defaults to DEFAULT_CONSENT_MAX_AGE_DAYS. */
  consentMaxAgeDays?: number;
}

/** Finds a PrivacyPolicyError in an error or its cause chain (pipeline code wraps errors). */
export function findPrivacyPolicyError(error: unknown): PrivacyPolicyError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth++) {
    if (current instanceof PrivacyPolicyError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export type EgressDecision =
  | { allowed: true; mode: "CLOUD" | "LOCAL" }
  | { allowed: false; error: PrivacyPolicyError };

export function evaluateAIEgress(
  settings: PrivacySettingsView | null | undefined,
  env: EgressEnvironment,
  now: Date = new Date(),
): EgressDecision {
  const s = settings ?? DEFAULT_PRIVACY_SETTINGS;

  if (s.dataMode === "NONE") {
    return deny(
      "No data-processing mode has been chosen, so no code is sent to any AI model.",
      "NO_MODE_SELECTED",
      "Open Privacy settings and choose Cloud AI (with consent) or Self-hosted AI.",
    );
  }

  if (!s.consentedAt || s.consentVersion === null) {
    return deny(
      "Informed consent has not been recorded for this data-processing mode.",
      "CONSENT_MISSING",
      "Open Privacy settings, read what is sent and where, then confirm your consent.",
    );
  }

  if (s.consentVersion !== CURRENT_CONSENT_VERSION) {
    return deny(
      "The data-processing terms changed since you consented.",
      "CONSENT_OUTDATED",
      "Review and re-confirm your choice in Privacy settings.",
    );
  }

  const maxAgeDays = env.consentMaxAgeDays ?? DEFAULT_CONSENT_MAX_AGE_DAYS;
  if (now.getTime() - s.consentedAt.getTime() > maxAgeDays * 86_400_000) {
    return deny(
      "Your consent has expired and must be confirmed again.",
      "CONSENT_EXPIRED",
      "Open Privacy settings and re-confirm your consent.",
    );
  }

  if (s.dataMode === "LOCAL") {
    if (!env.localAiBaseUrl) {
      return deny(
        "Self-hosted AI was selected but the server has no LOCAL_AI_BASE_URL.",
        "LOCAL_AI_NOT_CONFIGURED",
        "Ask your administrator to set LOCAL_AI_BASE_URL (for example an Ollama /v1 endpoint), or switch to Cloud AI.",
      );
    }
    return { allowed: true, mode: "LOCAL" };
  }

  if (!env.cloudProvidersConfigured) {
    return deny(
      "Cloud AI was selected but no cloud provider is configured on the server.",
      "CLOUD_AI_NOT_CONFIGURED",
      "Ask your administrator to configure a provider key, or switch to Self-hosted AI.",
    );
  }
  return { allowed: true, mode: "CLOUD" };
}

function deny(message: string, code: PrivacyPolicyError["code"], recovery: string): EgressDecision {
  return { allowed: false, error: new PrivacyPolicyError(message, code, recovery) };
}

export function clampRetentionDays(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.floor(n)));
}

/** Plain-language disclosure shown in the UI and returned by the API. */
export const DATA_DISCLOSURE = {
  version: CURRENT_CONSENT_VERSION,
  sent: [
    "Only the source files selected for analysis (JavaScript/TypeScript, size-limited) and, for a repair, the finding and the failing test output.",
    "Secrets and credentials are detected and replaced with [REDACTED:...] markers before anything is sent. Files such as .env, *.pem and *.key are never sent.",
  ],
  notSent: ["Your GitHub token, your password, files outside the selected repository, other users' data."],
  destinations: {
    CLOUD: "Hosted model providers configured by the server operator (OpenRouter, Groq, Google Gemini). Their own retention terms apply.",
    LOCAL: "A self-hosted OpenAI-compatible model server that your administrator runs. Nothing is sent to third-party providers; there is no automatic fallback to cloud.",
  },
  storedOnServer: [
    "Findings, proposed patches, test output (secrets redacted) and verification results, kept for your retention period.",
    "Index chunks of the repository (secrets redacted) used to give the model project context.",
    "Security audit events (metadata only, never source code).",
  ],
  controls: [
    "Change mode or withdraw consent at any time; AI processing stops immediately.",
    "Choose a retention period (1-365 days); expired analyses are deleted automatically.",
    "Delete a repository's data, or all of your data, at any time.",
  ],
} as const;
