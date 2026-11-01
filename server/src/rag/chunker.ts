
export interface TextChunk {
  index: number;
  content: string;
}

export { redactSecrets } from "../security/secret-redactor.js";
import { redactSecrets } from "../security/secret-redactor.js";

export function chunkText(
  input: string,
  linesPerChunk = 70,
  overlapLines = 10,
): TextChunk[] {
  if (
    !Number.isInteger(linesPerChunk) ||
    linesPerChunk < 1 ||
    !Number.isInteger(overlapLines) ||
    overlapLines < 0 ||
    overlapLines >= linesPerChunk
  ) {
    throw new Error("Invalid chunking configuration");
  }

  const content = redactSecrets(input).trim();

  if (!content) return [];

  const lines = content.split(/\r?\n/);
  const chunks: TextChunk[] = [];
  const step = linesPerChunk - overlapLines;

  for (let start = 0; start < lines.length; start += step) {
    const part = lines
      .slice(start, start + linesPerChunk)
      .join("\n")
      .trim();

    if (part) {
      chunks.push({
        index: chunks.length,
        content: part,
      });
    }
  }

  return chunks;
}
