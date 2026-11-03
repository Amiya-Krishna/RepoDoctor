import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { classifyStoredToken, decryptToken, encryptToken, loadKeyring, protectToken, revealToken, storedKeyId, isLowEntropyKey } from "../security/token-encryption.js";
import { assertTokenStoreSecure, migrateTokens, prismaTokenStore, scanTokenStore, type TokenStore } from "../security/token-migration.js";
import { collectSecurityConfigProblems } from "../config/startup-checks.js";
import { createTestDatabase, integrationSkipReason, useDatabase } from "./db.js";

const b64 = () => randomBytes(32).toString("base64");
const KEY = b64(), OLD = b64();
const ring = (extra: Record<string, string | undefined> = {}) => loadKeyring({ GITHUB_TOKEN_ENCRYPTION_KEY: KEY, GITHUB_TOKEN_ENCRYPTION_KEY_ID: "k2", ...extra });
const legacy = (token: string, key: string) => {
  const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  const ct = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
};
const memStore = (rows: Record<string, string>): TokenStore & { rows: Record<string, string> } => ({
  rows,
  list: async () => Object.entries(rows).map(([id, githubAccessToken]) => ({ id, githubAccessToken })),
  compareAndSet: async (id, e, n) => (rows[id] === e ? ((rows[id] = n), true) : false),
  read: async (id) => rows[id] ?? null,
});

test("v1 format: versioned, key id recorded, AAD binds key id, no plaintext leak", () => {
  const r = ring(); const s = encryptToken("gho_secret123", r);
  assert.match(s, /^v1:k2:/); assert.equal(classifyStoredToken(s), "v1"); assert.equal(storedKeyId(s), "k2");
  assert.ok(!s.includes("gho_secret123"));
  assert.equal(decryptToken(s, r), "gho_secret123");
  assert.throws(() => decryptToken(s.replace(":k2:", ":k3:"), r), /could not be decrypted/);
});

test("classification of plaintext, legacy GCM, v1 and garbage", () => {
  assert.equal(classifyStoredToken("gho_abc"), "plaintext");
  assert.equal(classifyStoredToken(legacy("gho_x", KEY)), "legacy-gcm");
  assert.equal(classifyStoredToken("v1:k1:@@:@@:@@"), "invalid");
  assert.equal(classifyStoredToken(""), "invalid");
  assert.equal(classifyStoredToken("a b c"), "invalid");
});

test("legacy GCM still decrypts with the current key; wrong key fails without leaking", () => {
  const r = ring();
  assert.equal(decryptToken(legacy("gho_legacy", KEY), r), "gho_legacy");
  try { decryptToken(legacy("gho_legacy", OLD), r); assert.fail("should throw"); } catch (e) { assert.ok(!String((e as Error).message).includes("gho_legacy")); assert.ok(!String((e as Error).message).includes(KEY)); }
});

test("old keys decrypt but are never used to encrypt; key-id reuse and bad lists are rejected", () => {
  const oldRing = loadKeyring({ GITHUB_TOKEN_ENCRYPTION_KEY: OLD, GITHUB_TOKEN_ENCRYPTION_KEY_ID: "k1" });
  const sealedOld = encryptToken("gho_old", oldRing);
  const r = ring({ GITHUB_TOKEN_ENCRYPTION_OLD_KEYS: `k1:${OLD}` });
  assert.equal(decryptToken(sealedOld, r), "gho_old");
  assert.match(encryptToken("x", r), /^v1:k2:/);
  assert.throws(() => ring({ GITHUB_TOKEN_ENCRYPTION_OLD_KEYS: `k2:${OLD}` }), /reuse/);
  assert.throws(() => ring({ GITHUB_TOKEN_ENCRYPTION_OLD_KEYS: "garbage" }), /OLD_KEYS/);
  assert.throws(() => ring({ GITHUB_TOKEN_ENCRYPTION_OLD_KEYS: `k1:${OLD},k1:${OLD}` }), /duplicate/);
});

test("fail closed: production never returns plaintext; no key means no save", () => {
  const saved = { ...process.env };
  try {
    process.env.NODE_ENV = "production"; process.env.GITHUB_TOKEN_ENCRYPTION_KEY = KEY; delete process.env.ALLOW_PLAINTEXT_TOKENS;
    assert.throws(() => revealToken("gho_plain"), /not encrypted/);
    process.env.ALLOW_PLAINTEXT_TOKENS = "true";
    assert.throws(() => revealToken("gho_plain"), /not encrypted/, "opt-in is ignored in production");
    delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
    assert.throws(() => protectToken("gho_x"), /required/);
    assert.throws(() => revealToken(encryptToken("gho_x", ring())), /not set/);
    assert.throws(() => revealToken("not a token!"), /unrecognised/);
  } finally { process.env = saved; }
});

test("migration: plaintext and legacy rows become v1, values round-trip, dry-run changes nothing", async () => {
  const rows = { a: "gho_plain", b: legacy("gho_legacy", KEY), c: encryptToken("gho_cur", ring()), d: "bad value!" };
  const store = memStore({ ...rows });
  const r = ring();
  const dry = await migrateTokens(store, { dryRun: true, keyring: r });
  assert.deepEqual([dry.migrated, dry.alreadyCurrent, dry.failed], [2, 1, 1]);
  assert.deepEqual(store.rows, rows, "dry run writes nothing");
  const res = await migrateTokens(store, { keyring: r });
  assert.deepEqual([res.migrated, res.alreadyCurrent, res.failed, res.failedIds], [2, 1, 1, ["d"]]);
  assert.equal(decryptToken(store.rows.a, r), "gho_plain");
  assert.equal(decryptToken(store.rows.b, r), "gho_legacy");
  assert.equal(store.rows.d, "bad value!", "unreadable rows are left untouched, never deleted");
  assert.deepEqual(await migrateTokens(store, { keyring: r }), { ...res, migrated: 0, alreadyCurrent: 3, failed: 1, failedIds: ["d"] }, "idempotent");
});

test("rotation re-encrypts only rows under a retired key, and only with rotate", async () => {
  const oldRing = loadKeyring({ GITHUB_TOKEN_ENCRYPTION_KEY: OLD, GITHUB_TOKEN_ENCRYPTION_KEY_ID: "k1" });
  const r = ring({ GITHUB_TOKEN_ENCRYPTION_OLD_KEYS: `k1:${OLD}` });
  const store = memStore({ a: encryptToken("gho_a", oldRing) });
  assert.equal((await migrateTokens(store, { keyring: r })).rotated, 0);
  assert.equal((await migrateTokens(store, { keyring: r, rotate: true })).rotated, 1);
  assert.equal(storedKeyId(store.rows.a), "k2");
  assert.equal(decryptToken(store.rows.a, r), "gho_a");
});

test("a row whose old key is missing is left unchanged and reported (never lost)", async () => {
  const gone = encryptToken("gho_a", loadKeyring({ GITHUB_TOKEN_ENCRYPTION_KEY: OLD, GITHUB_TOKEN_ENCRYPTION_KEY_ID: "k1" }));
  const store = memStore({ a: gone });
  const res = await migrateTokens(store, { keyring: ring(), rotate: true });
  assert.equal(res.failed, 1); assert.equal(store.rows.a, gone);
});

test("concurrent change during migration: compare-and-set refuses to clobber", async () => {
  const store = memStore({ a: "gho_plain" });
  const orig = store.compareAndSet;
  store.compareAndSet = async (id, e, n) => { store.rows[id] = "gho_newer_login"; return orig(id, e, n); };
  const res = await migrateTokens(store, { keyring: ring() });
  assert.equal(res.failed, 1); assert.equal(store.rows.a, "gho_newer_login");
});

test("failed post-write verification restores the original value", async () => {
  const store = memStore({ a: "gho_plain" });
  const origRead = store.read;
  let reads = 0;
  store.read = async (id) => (++reads === 1 ? "corrupted-after-write" : origRead(id));
  const res = await migrateTokens(store, { keyring: ring() });
  assert.equal(res.failed, 1); assert.equal(store.rows.a, "gho_plain");
});

test("startup gate: production refuses plaintext, invalid and missing key; development only warns; counts only in messages", async () => {
  const prod = { NODE_ENV: "production", GITHUB_TOKEN_ENCRYPTION_KEY: KEY };
  await assert.rejects(assertTokenStoreSecure(memStore({ a: "gho_supersecretvalue" }), prod), (e: Error) => /1 stored GitHub token/.test(e.message) && !e.message.includes("supersecret"));
  await assert.rejects(assertTokenStoreSecure(memStore({ a: "bad value!" }), prod), /unrecognised/);
  await assert.rejects(assertTokenStoreSecure(memStore({}), { NODE_ENV: "production" }), /GITHUB_TOKEN_ENCRYPTION_KEY/);
  const ok = await assertTokenStoreSecure(memStore({ a: encryptToken("gho_x", ring()) }), prod);
  assert.equal(ok.v1, 1);
  await assertTokenStoreSecure(memStore({ a: "gho_plain" }), { NODE_ENV: "development", GITHUB_TOKEN_ENCRYPTION_KEY: KEY });
});

test("startup checks: weak, short, malformed keys and bad key ids are rejected", () => {
  const base = { NODE_ENV: "production", JWT_SECRET: randomBytes(32).toString("hex"), GITHUB_WEBHOOK_SECRET: randomBytes(24).toString("hex"), FRONTEND_URL: "https://app.test", REDIS_PASSWORD: "p" };
  const errs = (k: Record<string, string>) => collectSecurityConfigProblems({ ...base, ...k }, "api").filter((p) => p.level === "error").map((p) => p.message).join("|");
  assert.equal(errs({ GITHUB_TOKEN_ENCRYPTION_KEY: KEY }), "");
  assert.match(errs({ GITHUB_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64") }), /entropy/);
  assert.match(errs({ GITHUB_TOKEN_ENCRYPTION_KEY: Buffer.alloc(16, 7).toString("base64") }), /32 bytes/);
  assert.match(errs({ GITHUB_TOKEN_ENCRYPTION_KEY: "not base64!!" }), /32 bytes/);
  assert.match(errs({ GITHUB_TOKEN_ENCRYPTION_KEY: KEY, GITHUB_TOKEN_ENCRYPTION_KEY_ID: "bad id" }), /KEY_ID/);
  assert.equal(isLowEntropyKey(Buffer.from(KEY, "base64")), false);
});

test("scan counts formats", async () => {
  const s = await scanTokenStore(memStore({ a: "gho_p", b: legacy("x", KEY), c: encryptToken("y", ring()), d: "?" }));
  assert.deepEqual(s, { plaintext: 1, legacyGcm: 1, v1: 1, invalid: 1, total: 4 });
});

const skip = integrationSkipReason({ postgres: true });
test("real PostgreSQL: Prisma token store migrates representative legacy rows via CAS", { skip }, async () => {
  const db = await createTestDatabase("tokens");
  try {
    await db.applyMigrations(); useDatabase(db);
    const { prisma } = await import("../config/prisma.js");
    const r = ring();
    for (const [i, tok] of ["gho_plain1", legacy("gho_leg", KEY), encryptToken("gho_cur", r), null].entries())
      await prisma.user.create({ data: { id: `u${i}`, name: "n", email: `u${i}@x.test`, password: "x", githubAccessToken: tok as string | null } });
    const store = await prismaTokenStore();
    const res = await migrateTokens(store, { keyring: r });
    assert.deepEqual([res.scanned, res.migrated, res.alreadyCurrent, res.failed], [3, 2, 1, 0]);
    for (const u of await prisma.user.findMany({ where: { githubAccessToken: { not: null } } })) assert.equal(classifyStoredToken(u.githubAccessToken!), "v1");
    assert.equal((await prisma.user.findUnique({ where: { id: "u3" } }))!.githubAccessToken, null);
    assert.equal(decryptToken((await prisma.user.findUnique({ where: { id: "u0" } }))!.githubAccessToken!, r), "gho_plain1");
    await prisma.$disconnect();
  } finally { await db.drop(); }
});
