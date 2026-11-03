import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { FixChange } from "../agents/fix.types.js";

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

/**
 * Hash of the exact patch the owner reviews and approves, bound to the repository.
 * Canonical (sorted, fixed key order) so the same stored patch always yields the same hash, and
 * any edit to a path, line range, original or replacement text yields a different one.
 */
export function computePatchHash(changes: FixChange[], repositoryId: string): string {
  const canonical = [...changes]
    .map((c) => ({
      filePath: c.filePath,
      changeType: c.changeType,
      startLine: c.startLine,
      endLine: c.endLine,
      originalCode: c.originalCode ?? "",
      replacementCode: c.replacementCode ?? "",
    }))
    .sort((a, b) => a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine || a.endLine - b.endLine || a.changeType.localeCompare(b.changeType));
  return sha256(JSON.stringify({ repositoryId, changes: canonical }));
}

export type PreImageHashes = Record<string, string | null>;

/** SHA-256 of each file the patch touches as it is NOW in `repositoryPath` (null = file does not exist). */
export async function computePreImageHashes(repositoryPath: string, changes: FixChange[]): Promise<PreImageHashes> {
  const out: PreImageHashes = {};
  for (const file of [...new Set(changes.map((c) => c.filePath))].sort()) {
    const abs = path.resolve(repositoryPath, file);
    const rel = path.relative(repositoryPath, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`Path escapes the repository: ${file}`);
    out[file] = await fs.readFile(abs).then(sha256, () => null);
  }
  return out;
}

/** True when every touched file still has the content the patch was verified against. */
export function preImagesMatch(expected: PreImageHashes | null | undefined, actual: PreImageHashes): boolean {
  if (!expected) return false; // nothing recorded: the context cannot be proven unchanged
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const k of keys) if ((expected[k] ?? null) !== (actual[k] ?? null)) return false;
  return true;
}
