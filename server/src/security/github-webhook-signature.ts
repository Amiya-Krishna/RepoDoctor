
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGitHubSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || !signature) return false;
  if (!/^sha256=[0-9a-f]{64}$/i.test(signature)) return false;

  const expected =
    "sha256=" +
    createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
