
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const encoded = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;

  if (!encoded) {
    throw new Error("GITHUB_TOKEN_ENCRYPTION_KEY is required");
  }

  const key = Buffer.from(encoded, "base64");

  if (key.length !== 32) {
    throw new Error(
      "GITHUB_TOKEN_ENCRYPTION_KEY must decode to 32 bytes",
    );
  }

  return key;
}

export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);

  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}

export function decryptToken(payload: string): string {
  const parts = payload.split(".");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format");
  }

  const [ivPart, tagPart, encryptedPart] = parts;

  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivPart, "base64"),
  );

  decipher.setAuthTag(Buffer.from(tagPart, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64")),
    decipher.final(),
  ]).toString("utf8");
}


let warnedPlaintext = false;

export function isEncryptionConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN_ENCRYPTION_KEY);
}

/**
 * Plaintext token storage is allowed only for local development and only when
 * explicitly requested. Anywhere else a missing key is a hard error: a token
 * is never silently stored unencrypted.
 */
function plaintextAllowed(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.ALLOW_PLAINTEXT_TOKENS === "true";
}

/**
 * Value to persist for a GitHub access token (AES-256-GCM). Throws when
 * GITHUB_TOKEN_ENCRYPTION_KEY is missing unless ALLOW_PLAINTEXT_TOKENS=true in
 * a non-production environment.
 */
export function protectToken(token: string): string {
  if (isEncryptionConfigured()) {
    return encryptToken(token);
  }

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

export function isEncryptedPayload(stored: string): boolean {
  return stored.split(".").length === 3;
}

/**
 * Inverse of protectToken. GitHub tokens never contain "." so a value with
 * three dot-separated parts is an encrypted payload. A legacy plaintext value
 * is still readable (so existing users keep working) but is re-encrypted by
 * `npm run tokens:migrate`; it is never written back as plaintext.
 */
export function revealToken(stored: string): string {
  if (!isEncryptedPayload(stored)) {
    return stored;
  }

  if (!isEncryptionConfigured()) {
    throw new Error(
      "GitHub token is encrypted but GITHUB_TOKEN_ENCRYPTION_KEY is not set",
    );
  }

  return decryptToken(stored);
}
