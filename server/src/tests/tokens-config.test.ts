import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptToken, encryptToken, isEncryptedPayload, protectToken, revealToken } from "../security/token-encryption.js";
import { collectSecurityConfigProblems, assertSecureConfiguration } from "../config/startup-checks.js";
import { fake } from "./helpers.js";

const KEY = "GITHUB_TOKEN_ENCRYPTION_KEY";
const saved = { key: process.env[KEY], env: process.env.NODE_ENV, plain: process.env.ALLOW_PLAINTEXT_TOKENS };
const restore = () => {
  for (const [k, v] of [[KEY, saved.key], ["NODE_ENV", saved.env], ["ALLOW_PLAINTEXT_TOKENS", saved.plain]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
};

test("stored token is ciphertext, never contains the plaintext, and round-trips", () => {
  process.env[KEY] = randomBytes(32).toString("base64");
  const t = fake.githubToken();
  const stored = protectToken(t);
  assert.ok(isEncryptedPayload(stored));
  assert.ok(!stored.includes(t));
  assert.equal(revealToken(stored), t);
  assert.notEqual(encryptToken(t), encryptToken(t), "fresh IV each time");
  restore();
});

test("tampering, truncation and the wrong key are detected (GCM authentication)", () => {
  process.env[KEY] = randomBytes(32).toString("base64");
  const sealed = encryptToken("gho_abc");
  const [iv, tag, ct] = sealed.split(".");
  assert.throws(() => decryptToken([iv, tag, Buffer.from("xx").toString("base64")].join(".")));
  assert.throws(() => decryptToken([iv, Buffer.alloc(16).toString("base64"), ct].join(".")));
  process.env[KEY] = randomBytes(32).toString("base64");
  assert.throws(() => decryptToken(sealed));
  restore();
});

test("without a key, saving a token FAILS rather than storing plaintext", () => {
  delete process.env[KEY];
  delete process.env.ALLOW_PLAINTEXT_TOKENS;
  assert.throws(() => protectToken(fake.githubToken()), /ENCRYPTION_KEY is required/);
  restore();
});

test("plaintext opt-in works only outside production", () => {
  delete process.env[KEY];
  process.env.ALLOW_PLAINTEXT_TOKENS = "true";
  process.env.NODE_ENV = "development";
  assert.equal(protectToken("tok"), "tok");
  process.env.NODE_ENV = "production";
  assert.throws(() => protectToken("tok"));
  restore();
});

test("a malformed key is rejected", () => {
  process.env[KEY] = randomBytes(16).toString("base64");
  assert.throws(() => encryptToken("x"), /32 bytes/);
  restore();
});

const good = {
  NODE_ENV: "production",
  JWT_SECRET: randomBytes(32).toString("hex"),
  GITHUB_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  GITHUB_WEBHOOK_SECRET: randomBytes(24).toString("hex"),
  FRONTEND_URL: "https://app.example.com",
  REDIS_PASSWORD: randomBytes(16).toString("hex"),
};

test("a correct production configuration has no errors", () => {
  assert.deepEqual(collectSecurityConfigProblems(good, "api").filter((p) => p.level === "error"), []);
});

test("production refuses to start with each insecure setting", () => {
  const bad: Record<string, Record<string, string | undefined>> = {
    "weak JWT secret": { JWT_SECRET: "short" },
    "placeholder JWT secret": { JWT_SECRET: "replace_with_a_long_random_string_please_x" },
    "missing encryption key": { GITHUB_TOKEN_ENCRYPTION_KEY: undefined },
    "short encryption key": { GITHUB_TOKEN_ENCRYPTION_KEY: randomBytes(8).toString("base64") },
    "missing webhook secret": { GITHUB_WEBHOOK_SECRET: undefined },
    "http origin": { FRONTEND_URL: "http://app.example.com" },
    "wildcard origin": { FRONTEND_URL: "*" },
    "no redis password": { REDIS_PASSWORD: undefined },
    "plaintext tokens": { ALLOW_PLAINTEXT_TOKENS: "true" },
  };
  for (const [name, patch] of Object.entries(bad)) {
    assert.throws(() => assertSecureConfiguration("api", { ...good, ...patch }), /Refusing to start/, name);
  }
});

test("outside production the same problems are warnings, not startup failures", () => {
  assert.doesNotThrow(() => assertSecureConfiguration("api", { NODE_ENV: "development" }));
});
