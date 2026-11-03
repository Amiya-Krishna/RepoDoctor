import fs from "node:fs/promises";
import path from "node:path";

export interface WorkspaceViolation {
  path: string;
  reason: "SYMLINK_ESCAPES" | "SPECIAL_FILE" | "TOO_MANY_FILES" | "TOO_DEEP" | "UNREADABLE";
}

export interface WorkspaceScanLimits {
  maxEntries: number;
  maxDepth: number;
}

export const DEFAULT_SCAN_LIMITS: WorkspaceScanLimits = { maxEntries: 200_000, maxDepth: 64 };

/** True when `candidate` is `root` or lies beneath it, after lexical normalisation. */
export const isInside = (root: string, candidate: string): boolean => {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/**
 * Walks an untrusted repository checkout BEFORE it is bind-mounted into a container and reports
 * anything that could let a process inside reach outside the workspace or confuse tooling:
 *  - symlinks whose target (resolved lexically, not followed) is outside the workspace
 *  - FIFOs, sockets and device nodes
 *  - absurd entry counts or directory depth (resource exhaustion)
 * Symlinks inside the workspace are allowed. Nothing is followed, so a hostile link cannot make the scan itself escape.
 * This is defence in depth: the container, not this scan, is the isolation boundary.
 */
export async function scanWorkspace(root: string, limits: WorkspaceScanLimits = DEFAULT_SCAN_LIMITS): Promise<WorkspaceViolation[]> {
  const resolvedRoot = path.resolve(root);
  const violations: WorkspaceViolation[] = [];
  let entries = 0;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (violations.length >= 50) return;
    if (depth > limits.maxDepth) { violations.push({ path: path.relative(resolvedRoot, dir), reason: "TOO_DEEP" }); return; }
    let items;
    try { items = await fs.readdir(dir, { withFileTypes: true }); }
    catch { violations.push({ path: path.relative(resolvedRoot, dir), reason: "UNREADABLE" }); return; }

    for (const item of items) {
      if (++entries > limits.maxEntries) { violations.push({ path: ".", reason: "TOO_MANY_FILES" }); return; }
      const full = path.join(dir, item.name);
      const rel = path.relative(resolvedRoot, full);
      if (item.isSymbolicLink()) {
        let target: string;
        try { target = await fs.readlink(full); } catch { violations.push({ path: rel, reason: "UNREADABLE" }); continue; }
        const resolved = path.resolve(dir, target);
        if (path.isAbsolute(target) ? !isInside(resolvedRoot, path.resolve(target)) : !isInside(resolvedRoot, resolved)) {
          violations.push({ path: rel, reason: "SYMLINK_ESCAPES" });
        }
      } else if (item.isDirectory()) {
        await walk(full, depth + 1);
      } else if (!item.isFile()) {
        violations.push({ path: rel, reason: "SPECIAL_FILE" });
      }
    }
  };

  await walk(resolvedRoot, 0);
  return violations;
}

/** Throws (fail closed) when the workspace is unsafe to mount. Message lists relative paths only. */
export async function assertWorkspaceSafe(root: string, limits?: WorkspaceScanLimits): Promise<void> {
  const violations = await scanWorkspace(root, limits);
  if (violations.length > 0) {
    const shown = violations.slice(0, 5).map((v) => `${v.reason}: ${v.path}`).join("; ");
    throw new Error(`Refusing to run untrusted repository code: unsafe workspace (${shown}${violations.length > 5 ? "; …" : ""}).`);
  }
}
