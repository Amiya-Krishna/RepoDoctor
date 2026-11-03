import test from "node:test";
import assert from "node:assert/strict";
import { isSensitiveFilePath, redactSecrets, redactSecretsDetailed, scanForSecrets } from "../security/secret-redactor.js";
import { GuardedAIProvider, DEFAULT_MAX_PROMPT_CHARS } from "../ai/guarded.provider.js";
import { PrivacyPolicyError } from "../privacy/privacy.policy.js";
import { fake } from "./helpers.js";
import type { AIProvider } from "../ai/ai.provider.js";

const samples: Record<string, string> = {
  GITHUB_TOKEN: fake.githubToken(),
  AWS_ACCESS_KEY: fake.awsKey(),
  SLACK_TOKEN: fake.slack(),
  STRIPE_KEY: fake.stripe(),
  API_KEY: fake.openai(),
  GOOGLE_API_KEY: fake.google(),
  JWT: fake.jwt(),
};

for (const [type, secret] of Object.entries(samples)) {
  test(`detects and redacts ${type}`, () => {
    const out = redactSecretsDetailed(`const x = "${secret}"; // keep going`);
    assert.ok(!out.text.includes(secret), `${type} leaked`);
    assert.ok(out.total >= 1);
    assert.deepEqual(scanForSecrets(out.text), [], "nothing detectable remains");
  });
}

test("redacts PEM private keys, including a truncated block", () => {
  assert.ok(!redactSecrets(`a\n${fake.pem()}\nb`).includes("MIIEow"));
  const truncated = "-----BEGIN PRIV" + "ATE KEY-----\nMIIEowIBAAKCAQEAabc123";
  assert.ok(!redactSecrets(truncated).includes("MIIEow"));
});

test("redacts credential assignments in code, JSON and env style", () => {
  for (const line of [
    'const password = "hunter2hunter2";',
    '{"api_key": "abcdef123456"}',
    "DB_PASSWORD=supersecretvalue",
    "client_secret: 'abcd1234efgh'",
    "headers = { Authorization: 'Bearer abcdefghijklmnopqrstuvwxyz123456' }",
    "const url = 'postgres://admin:s3cretpw@db.internal:5432/app'",
  ]) {
    const out = redactSecrets(line);
    assert.match(out, /\[REDACTED/, line);
    assert.ok(!/hunter2|abcdef123456|supersecretvalue|abcd1234efgh|abcdefghijklmnopqrstuvwxyz123456|s3cretpw/.test(out), `leaked from: ${line}`);
  }
});

test("does not mangle ordinary code (no false redaction of env lookups)", () => {
  const code = "const key = process.env.API_KEY;\nconst token = config.token;\nfunction add(a, b) { return a + b; }";
  assert.equal(redactSecrets(code), code);
});

test("redaction report counts types but never contains the secret", () => {
  const out = redactSecretsDetailed(`a ${fake.githubToken()} b ${fake.awsKey()}`);
  assert.equal(out.redactions.GITHUB_TOKEN, 1);
  assert.equal(out.redactions.AWS_ACCESS_KEY, 1);
  assert.ok(!JSON.stringify(out.redactions).includes("AKIA"));
});

test("sensitive files are recognised by path", () => {
  for (const p of [".env", "src/.env.production", "deploy/id_rsa", "certs/server.pem", "a/b/credentials.json", ".npmrc", "infra/prod.tfvars"]) {
    assert.equal(isSensitiveFilePath(p), true, p);
  }
  for (const p of ["src/index.ts", "README.md", "src/environment.ts"]) assert.equal(isSensitiveFilePath(p), false, p);
});

function spy() {
  const seen: { system: string; user: string }[] = [];
  const inner: AIProvider = {
    async generate(system, user) { seen.push({ system, user }); return "ok"; },
    async generateStructured<T>(system: string, user: string) { seen.push({ system, user }); return {} as T; },
  };
  return { inner, seen };
}

test("guarded provider: secrets in either prompt never reach the model", async () => {
  const { inner, seen } = spy();
  const g = new GuardedAIProvider(inner, { authorize: async () => undefined, mode: "CLOUD", onEgress: () => undefined });
  const t = fake.githubToken();
  await g.generateStructured("sys " + t, "user " + t, {});
  assert.equal(seen.length, 1);
  assert.ok(!seen[0].system.includes(t) && !seen[0].user.includes(t));
});

test("guarded provider: oversized prompts are refused (data minimisation)", async () => {
  const { inner, seen } = spy();
  const g = new GuardedAIProvider(inner, { authorize: async () => undefined, mode: "CLOUD", onEgress: () => undefined, maxPromptChars: 1000 });
  await assert.rejects(() => g.generate("s", "x".repeat(2000)), (e: unknown) => (e as PrivacyPolicyError).code === "PROMPT_TOO_LARGE");
  assert.equal(seen.length, 0);
  assert.ok(DEFAULT_MAX_PROMPT_CHARS > 0);
});

test("guarded provider: fails closed if the audit hook throws", async () => {
  const { inner, seen } = spy();
  const g = new GuardedAIProvider(inner, { authorize: async () => undefined, mode: "LOCAL", onEgress: () => { throw new Error("audit unavailable"); } });
  await assert.rejects(() => g.generate("s", "u"));
  assert.equal(seen.length, 0);
});
