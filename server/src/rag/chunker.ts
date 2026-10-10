
export interface TextChunk {
  index: number;
  content: string;
}

export function redactSecrets(text: string): string {
  return text
    .replace(
      /((?:api[_-]?key|access[_-]?token|password|client[_-]?secret|secret[_-]?key)\s*[:=]\s*["']?)[^"' \r\n,}]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
      "[REDACTED_GITHUB_TOKEN]",
    )
    .replace(
      /\bsk-[A-Za-z0-9_-]{20,}\b/g,
      "[REDACTED_API_KEY]",
    );
}

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
