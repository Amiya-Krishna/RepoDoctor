/**
 * Secret detection and redaction.
 *
 * Used (1) before any text leaves the server for an LLM, (2) before text is
 * persisted (RAG chunks, Docker output) and (3) as a verification pass: after
 * redaction the text is scanned again and the caller fails closed if anything
 * that still looks like a secret remains.
 *
 * This is pattern based. It catches well-known token formats and
 * credential-like assignments; it cannot prove a text is secret-free, which is
 * why sensitive files are also excluded by path (see isSensitiveFilePath).
 */

export interface SecretRule {
  type: string;
  pattern: RegExp;
  /** Replacement for the whole match. Defaults to `[REDACTED:<type>]`. */
  replace?: (match: string, ...groups: string[]) => string;
}

const tag = (type: string) => `[REDACTED:${type}]`;

const looksLikeLookup = (value: string): boolean =>
  /^(process\.env|import\.meta|os\.environ|env\.|config\.|settings\.|req\.|request\.|this\.|\$\{|<|\[REDACTED)/i.test(value);

export const SECRET_RULES: SecretRule[] = [
  {
    type: "PRIVATE_KEY",
    // Also matches an unterminated block (truncated context) up to a bounded length.
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]{0,8000}?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
  },
  { type: "GITHUB_TOKEN", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { type: "AWS_ACCESS_KEY", pattern: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}\b/g },
  { type: "GOOGLE_API_KEY", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { type: "SLACK_TOKEN", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { type: "STRIPE_KEY", pattern: /\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}\b/g },
  { type: "NPM_TOKEN", pattern: /\bnpm_[A-Za-z0-9]{30,}\b/g },
  { type: "API_KEY", pattern: /\b(?:sk-[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{30,})\b/g },
  {
    type: "JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    type: "URL_CREDENTIALS",
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@'"`]+:[^\s/@'"`]+@/gi,
    replace: (_m, scheme) => `${scheme}${tag("URL_CREDENTIALS")}@`,
  },
  {
    type: "BEARER_TOKEN",
    pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/-]{20,}=*/gi,
    replace: (_m, prefix) => `${prefix}${tag("BEARER_TOKEN")}`,
  },
  {
    type: "CREDENTIAL_ASSIGNMENT",
    pattern:
      /(\b[\w.-]*(?:api[_-]?key|secret|token|passw(?:or)?d|passwd|pwd|private[_-]?key|credential|auth[_-]?key|access[_-]?key)[\w.-]*["'`]?\s*[:=]\s*["'`]?)([^\s"'`,;)}\]]{6,})/gi,
    replace: (match, prefix, value) =>
      looksLikeLookup(value) ? match : `${prefix}${tag("CREDENTIAL_ASSIGNMENT")}`,
  },
];

export interface RedactionReport {
  text: string;
  /** Count of redactions per rule type. Never contains the secret values. */
  redactions: Record<string, number>;
  total: number;
}

export function redactSecretsDetailed(input: string): RedactionReport {
  let text = input;
  const redactions: Record<string, number> = {};
  let total = 0;

  for (const rule of SECRET_RULES) {
    text = text.replace(rule.pattern, (match: string, ...args: unknown[]) => {
      const groups = args.filter((a): a is string => typeof a === "string").slice(0, -1);
      const replacement = rule.replace ? rule.replace(match, ...groups) : tag(rule.type);
      if (replacement !== match) {
        redactions[rule.type] = (redactions[rule.type] ?? 0) + 1;
        total += 1;
      }
      return replacement;
    });
  }

  return { text, redactions, total };
}

export function redactSecrets(input: string): string {
  return redactSecretsDetailed(input).text;
}

/** Read-only scan: which rule types still match (ignores already-redacted markers). */
export function scanForSecrets(input: string): string[] {
  const found = new Set<string>();
  for (const rule of SECRET_RULES) {
    const probe = new RegExp(rule.pattern.source, rule.pattern.flags);
    for (const m of input.matchAll(probe)) {
      const replacement = rule.replace
        ? rule.replace(m[0], ...(m.slice(1) as string[]))
        : tag(rule.type);
      if (replacement !== m[0]) found.add(rule.type);
    }
  }
  return [...found];
}

const SENSITIVE_FILE =
  /(^|\/)(\.env(\..*)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|id_(rsa|dsa|ecdsa|ed25519)|credentials(\.json)?|secrets?\.(json|ya?ml|toml)|.*\.(pem|key|p12|pfx|jks|keystore|kdbx)|terraform\.tfstate.*|.*\.tfvars)$/i;

/** Files that must never be placed in an LLM prompt or an index, regardless of content. */
export function isSensitiveFilePath(filePath: string): boolean {
  return SENSITIVE_FILE.test(filePath.replace(/\\/g, "/"));
}
