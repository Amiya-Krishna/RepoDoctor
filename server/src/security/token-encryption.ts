
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
