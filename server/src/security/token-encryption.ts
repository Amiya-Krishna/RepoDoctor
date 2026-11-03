import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * GitHub token protection (AES-256-GCM).
 *
 * Stored formats:
 *   v1:<keyId>:<iv>:<tag>:<ciphertext>   (base64url parts; AAD binds version + keyId)  <- written by this code
 *   <iv>.<tag>.<ciphertext>              (legacy GCM, standard base64, no AAD, current key only)
 *   anything else that looks like a bare token = legacy PLAINTEXT (never accepted in production)
 *
 * Errors thrown here never contain token or key material.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,16}$/;
const DEFAULT_KEY_ID = "k1";
const GITHUB_PREFIX = /^(gho_|ghp_|ghu_|ghs_|ghr_|github_pat_)/;
const BARE_TOKEN = /^[A-Za-z0-9_-]{1,512}$/;

export type StoredTokenKind = "v1" | "legacy-gcm" | "plaintext" | "invalid";

export interface Keyring {
  currentId: string;
  current: Buffer;
  /** Retired keys: decrypt-only. */
  old: Map<string, Buffer>;
}

type Env = Record<string, string | undefined>;

const aad = (keyId: string) => Buffer.from(`repodoctor:github-token:v1:${keyId}`, "utf8");

const isStrictBase64 = (value: string): boolean =>
  value.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0;

const decodeKey = (encoded: string): Buffer | null => {
  if (!isStrictBase64(encoded)) return null;
  const key = Buffer.from(encoded, "base64");
  return key.length === 32 ? key : null;
};

/** True for all-equal bytes or a short repeating pattern (e.g. 32 zero bytes). */
export function isLowEntropyKey(key: Buffer): boolean {
  if (key.every((b) => b === key[0])) return true;
  for (const period of [2, 4, 8, 16]) {
    if (key.every((b, i) => b === key[i % period])) return true;
  }
  return new Set(key).size < 8;
}

export function parseOldKeys(raw: string | undefined): { id: string; key: Buffer }[] | { error: string } {
  if (!raw || raw.trim() === "") return [];
  const result: { id: string; key: Buffer }[] = [];
  for (const entry of raw.split(",")) {
    const idx = entry.indexOf(":");
    const id = idx > 0 ? entry.slice(0, idx).trim() : "";
    const key = idx > 0 ? decodeKey(entry.slice(idx + 1).trim()) : null;
    if (!KEY_ID_PATTERN.test(id) || !key) {
      return { error: "GITHUB_TOKEN_ENCRYPTION_OLD_KEYS must be comma-separated <id>:<base64 of 32 bytes> pairs" };
    }
    if (result.some((r) => r.id === id)) return { error: "GITHUB_TOKEN_ENCRYPTION_OLD_KEYS contains a duplicate key id" };
    result.push({ id, key });
  }
  return result;
}

export function loadKeyring(env: Env = process.env): Keyring {
  const encoded = env.GITHUB_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("GITHUB_TOKEN_ENCRYPTION_KEY is required");
  const current = decodeKey(encoded);
  if (!current) throw new Error("GITHUB_TOKEN_ENCRYPTION_KEY must be base64 and decode to exactly 32 bytes");

  const currentId = env.GITHUB_TOKEN_ENCRYPTION_KEY_ID || DEFAULT_KEY_ID;
  if (!KEY_ID_PATTERN.test(currentId)) throw new Error("GITHUB_TOKEN_ENCRYPTION_KEY_ID is invalid");

  const parsed = parseOldKeys(env.GITHUB_TOKEN_ENCRYPTION_OLD_KEYS);
  if ("error" in parsed) throw new Error(parsed.error);
  if (parsed.some((p) => p.id === currentId)) {
    throw new Error("GITHUB_TOKEN_ENCRYPTION_OLD_KEYS must not reuse the current key id");
  }
  return { currentId, current, old: new Map(parsed.map((p) => [p.id, p.key])) };
}

const b64u = (b: Buffer) => b.toString("base64url");
const fromB64u = (s: string) => (/^[A-Za-z0-9_-]+$/.test(s) ? Buffer.from(s, "base64url") : null);

export function encryptToken(token: string, keyring: Keyring = loadKeyring()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyring.current, iv);
  cipher.setAAD(aad(keyring.currentId));
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", keyring.currentId, b64u(iv), b64u(cipher.getAuthTag()), b64u(encrypted)].join(":");
}

export function classifyStoredToken(stored: string): StoredTokenKind {
  if (typeof stored !== "string" || stored.length === 0) return "invalid";

  if (stored.startsWith("v1:")) {
    const parts = stored.split(":");
    if (parts.length !== 5 || !KEY_ID_PATTERN.test(parts[1])) return "invalid";
    const iv = fromB64u(parts[2]);
    const tag = fromB64u(parts[3]);
    const ct = fromB64u(parts[4]);
    return iv?.length === 12 && tag?.length === 16 && ct && ct.length > 0 ? "v1" : "invalid";
  }

  if (stored.includes(".")) {
    const parts = stored.split(".");
    if (parts.length !== 3 || !parts.every(isStrictBase64)) return "invalid";
    const [iv, tag, ct] = parts.map((p) => Buffer.from(p, "base64"));
    return iv.length === 12 && tag.length === 16 && ct.length > 0 ? "legacy-gcm" : "invalid";
  }

  if (GITHUB_PREFIX.test(stored) || BARE_TOKEN.test(stored)) return "plaintext";
  return "invalid";
}

export function isEncryptedPayload(stored: string): boolean {
  const kind = classifyStoredToken(stored);
  return kind === "v1" || kind === "legacy-gcm";
}

/** Key id a v1 payload was written with (null for other formats). */
export function storedKeyId(stored: string): string | null {
  return classifyStoredToken(stored) === "v1" ? stored.split(":")[1] : null;
}

const FAILED = "GitHub token could not be decrypted (wrong key, corrupted data or unsupported format)";

export function decryptToken(payload: string, keyring: Keyring = loadKeyring()): string {
  const kind = classifyStoredToken(payload);
  try {
    if (kind === "v1") {
      const [, keyId, iv, tag, ct] = payload.split(":");
      const key = keyId === keyring.currentId ? keyring.current : keyring.old.get(keyId);
      if (!key) throw new Error("unknown key id");
      const decipher = createDecipheriv(ALGORITHM, key, fromB64u(iv)!);
      decipher.setAAD(aad(keyId));
      decipher.setAuthTag(fromB64u(tag)!);
      return Buffer.concat([decipher.update(fromB64u(ct)!), decipher.final()]).toString("utf8");
    }
    if (kind === "legacy-gcm") {
      const [iv, tag, ct] = payload.split(".").map((p) => Buffer.from(p, "base64"));
      const decipher = createDecipheriv(ALGORITHM, keyring.current, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    }
  } catch {
    throw new Error(FAILED);
  }
  throw new Error(FAILED);
}

export function isEncryptionConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN_ENCRYPTION_KEY);
}

/** Plaintext is allowed only outside production and only when explicitly requested. */
function plaintextAllowed(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.ALLOW_PLAINTEXT_TOKENS === "true";
}

let warnedPlaintext = false;

/** Value to persist for a GitHub token. Always v1 AES-256-GCM; throws (fail closed) without a valid key. */
export function protectToken(token: string): string {
  if (isEncryptionConfigured()) return encryptToken(token);

  if (!plaintextAllowed()) {
    throw new Error(
      "GITHUB_TOKEN_ENCRYPTION_KEY is required to store GitHub tokens. Generate one with: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  if (!warnedPlaintext) {
    warnedPlaintext = true;
    console.warn("ALLOW_PLAINTEXT_TOKENS=true: GitHub tokens are stored UNENCRYPTED (development only).");
  }
  return token;
}

/**
 * Inverse of protectToken. Plaintext (legacy) values are never returned in
 * production; elsewhere only with ALLOW_PLAINTEXT_TOKENS=true. Run
 * `npm run tokens:migrate` to encrypt legacy rows.
 */
export function revealToken(stored: string): string {
  const kind = classifyStoredToken(stored);
  if (kind === "plaintext") {
    if (!plaintextAllowed()) {
      throw new Error("Stored GitHub token is not encrypted and plaintext tokens are not accepted; run tokens:migrate");
    }
    return stored;
  }
  if (kind === "invalid") throw new Error("Stored GitHub token has an unrecognised format");
  if (!isEncryptionConfigured()) {
    throw new Error("GitHub token is encrypted but GITHUB_TOKEN_ENCRYPTION_KEY is not set");
  }
  return decryptToken(stored);
}
