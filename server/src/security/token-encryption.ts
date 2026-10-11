
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
 * Value to persist for a GitHub access token. Encrypted when
 * GITHUB_TOKEN_ENCRYPTION_KEY is configured; otherwise stored as-is (with a
 * one-time warning) so existing development setups keep working.
 */
export function protectToken(token: string): string {
  if (isEncryptionConfigured()) {
    return encryptToken(token);
  }

  if (!warnedPlaintext) {
    warnedPlaintext = true;
    console.warn(
      "GITHUB_TOKEN_ENCRYPTION_KEY is not set: GitHub access tokens are stored unencrypted.",
    );
  }

  return token;
}

/**
 * Inverse of protectToken. GitHub tokens never contain "." so a value with
 * three dot-separated parts is an encrypted payload; anything else is a legacy
 * plaintext token and is returned unchanged.
 */
export function revealToken(stored: string): string {
  if (stored.split(".").length !== 3) {
    return stored;
  }

  if (!isEncryptionConfigured()) {
    throw new Error(
      "GitHub token is encrypted but GITHUB_TOKEN_ENCRYPTION_KEY is not set",
    );
  }

  return decryptToken(stored);
}
