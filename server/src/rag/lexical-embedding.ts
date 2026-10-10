
const DIMENSIONS = 384;

function tokenize(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .match(/[a-z0-9_$]+/g) ?? [];
}

function hashToken(token: string): number {
  let hash = 2166136261;

  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function createLexicalEmbedding(
  text: string,
): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  const tokens = tokenize(text);

  for (let i = 0; i < tokens.length; i++) {
    const features = [tokens[i]];

    if (i + 1 < tokens.length) {
      features.push(`${tokens[i]}_${tokens[i + 1]}`);
    }

    for (const feature of features) {
      const hash = hashToken(feature);
      const index = hash % DIMENSIONS;
      const sign = (hash & 1) === 0 ? 1 : -1;

      vector[index] += sign;
    }
  }

  const norm = Math.sqrt(
    vector.reduce((sum, value) => sum + value * value, 0),
  );

  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] /= norm;
    }
  }

  return vector;
}

export function cosineSimilarity(
  left: number[],
  right: number[],
): number {
  if (
    left.length !== right.length ||
    left.length === 0
  ) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let i = 0; i < left.length; i++) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / Math.sqrt(leftNorm * rightNorm);
}
