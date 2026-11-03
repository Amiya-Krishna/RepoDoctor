import {
  classifyStoredToken,
  decryptToken,
  encryptToken,
  loadKeyring,
  storedKeyId,
  type Keyring,
} from "./token-encryption.js";

export interface TokenRow {
  id: string;
  githubAccessToken: string;
}

export interface TokenStore {
  list(): Promise<TokenRow[]>;
  /** Compare-and-set: writes only if the stored value still equals `expected`. Returns true if written. */
  compareAndSet(id: string, expected: string, next: string): Promise<boolean>;
  read(id: string): Promise<string | null>;
}

export interface MigrationOptions {
  dryRun?: boolean;
  rotate?: boolean;
  /** Round-trip verification before and after writing. Default true; there is no reason to disable it outside tests. */
  verify?: boolean;
  keyring?: Keyring;
  /** Plain-value reader for rows that are plaintext (they have no ciphertext to decrypt). */
}

export interface MigrationResult {
  scanned: number;
  migrated: number;
  rotated: number;
  alreadyCurrent: number;
  failed: number;
  /** Row ids only, never values. */
  failedIds: string[];
  dryRun: boolean;
}

/**
 * Encrypts plaintext and legacy-GCM tokens to v1 under the current key (and, with
 * `rotate`, re-encrypts v1 tokens written under a retired key). The original value
 * is only ever replaced by a value that was decrypted back to the same token, and
 * nothing is deleted or nulled.
 */
export async function migrateTokens(store: TokenStore, options: MigrationOptions = {}): Promise<MigrationResult> {
  const keyring = options.keyring ?? loadKeyring();
  const verify = options.verify ?? true;
  const result: MigrationResult = { scanned: 0, migrated: 0, rotated: 0, alreadyCurrent: 0, failed: 0, failedIds: [], dryRun: Boolean(options.dryRun) };

  for (const row of await store.list()) {
    result.scanned++;
    const kind = classifyStoredToken(row.githubAccessToken);
    const needsUpgrade = kind === "plaintext" || kind === "legacy-gcm";
    const needsRotation = kind === "v1" && options.rotate === true && storedKeyId(row.githubAccessToken) !== keyring.currentId;

    if (kind === "invalid") { result.failed++; result.failedIds.push(row.id); continue; }
    if (!needsUpgrade && !needsRotation) { result.alreadyCurrent++; continue; }

    try {
      const plain = kind === "plaintext" ? row.githubAccessToken : decryptToken(row.githubAccessToken, keyring);
      const sealed = encryptToken(plain, keyring);
      if (verify && decryptToken(sealed, keyring) !== plain) throw new Error("verification failed");

      if (!options.dryRun) {
        if (!(await store.compareAndSet(row.id, row.githubAccessToken, sealed))) throw new Error("row changed concurrently");
        if (verify) {
          let verified = false;
          try {
            const after = await store.read(row.id);
            verified = after !== null && decryptToken(after, keyring) === plain;
          } catch {
            verified = false;
          }
          if (!verified) {
            // Post-write verification failed or threw: restore the original (CAS so a newer value is never clobbered).
            await store.compareAndSet(row.id, sealed, row.githubAccessToken).catch(() => false);
            throw new Error("post-write verification failed");
          }
        }
      }
      if (needsRotation) result.rotated++; else result.migrated++;
    } catch {
      result.failed++;
      result.failedIds.push(row.id);
    }
  }
  return result;
}

export async function prismaTokenStore(): Promise<TokenStore> {
  const { prisma } = await import("../config/prisma.js");
  return {
    async list() {
      const rows = await prisma.user.findMany({ where: { githubAccessToken: { not: null } }, select: { id: true, githubAccessToken: true } });
      return rows.flatMap((r: { id: string; githubAccessToken: string | null }) => (r.githubAccessToken ? [{ id: r.id, githubAccessToken: r.githubAccessToken }] : []));
    },
    async compareAndSet(id, expected, next) {
      const r = await prisma.user.updateMany({ where: { id, githubAccessToken: expected }, data: { githubAccessToken: next } });
      return r.count === 1;
    },
    async read(id) {
      const u = await prisma.user.findUnique({ where: { id }, select: { githubAccessToken: true } });
      return u?.githubAccessToken ?? null;
    },
  };
}

export interface StoreScan { plaintext: number; invalid: number; legacyGcm: number; v1: number; total: number }

export async function scanTokenStore(store: Pick<TokenStore, "list">): Promise<StoreScan> {
  const scan: StoreScan = { plaintext: 0, invalid: 0, legacyGcm: 0, v1: 0, total: 0 };
  for (const row of await store.list()) {
    scan.total++;
    const k = classifyStoredToken(row.githubAccessToken);
    if (k === "plaintext") scan.plaintext++;
    else if (k === "invalid") scan.invalid++;
    else if (k === "legacy-gcm") scan.legacyGcm++;
    else scan.v1++;
  }
  return scan;
}

/**
 * Startup gate. Production refuses to start when the key is missing/invalid or any
 * stored token is plaintext or unrecognisable; legacy-GCM rows only warn.
 * Outside production everything is a warning. Messages contain counts only.
 */
export async function assertTokenStoreSecure(
  store?: Pick<TokenStore, "list">,
  env: Record<string, string | undefined> = process.env,
): Promise<StoreScan> {
  const production = env.NODE_ENV === "production";
  const problems: string[] = [];
  try {
    loadKeyring(env);
  } catch (e) {
    problems.push(e instanceof Error ? e.message : "invalid token encryption configuration");
  }

  const scan = await scanTokenStore(store ?? (await prismaTokenStore()));
  if (scan.plaintext > 0) problems.push(`${scan.plaintext} stored GitHub token(s) are unencrypted; run "npm run tokens:migrate" (take a database backup first)`);
  if (scan.invalid > 0) problems.push(`${scan.invalid} stored GitHub token(s) have an unrecognised format`);
  if (scan.legacyGcm > 0) console.warn(`[config] warning: ${scan.legacyGcm} GitHub token(s) use the legacy encryption format; run "npm run tokens:migrate"`);

  if (problems.length > 0) {
    if (production) throw new Error(`Refusing to start: token store is not secure:\n - ${problems.join("\n - ")}`);
    for (const p of problems) console.warn(`[config] warning: ${p}`);
  }
  return scan;
}
