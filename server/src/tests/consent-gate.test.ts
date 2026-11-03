import test from "node:test";
import assert from "node:assert/strict";
import { CURRENT_CONSENT_VERSION, DEFAULT_PRIVACY_SETTINGS, PrivacyPolicyError, evaluateAIEgress, type PrivacySettingsView } from "../privacy/privacy.policy.js";
import { createAIProviderForUser, type PrivacyDeps, type PrivacyStore } from "../privacy/privacy.service.js";
import { createAIProvider } from "../ai/ai.provider.factory.js";
import { AIProviderManager } from "../ai/ai.provider.manager.js";
import type { AIProvider } from "../ai/ai.provider.js";
import { captureAudit, fake } from "./helpers.js";

process.env.AI_RETRY_BASE_DELAY_MS = "20";

const env = { localAiBaseUrl: "http://llm.internal:11434/v1", cloudProvidersConfigured: true };
const consented = (mode: "CLOUD" | "LOCAL", over: Partial<PrivacySettingsView> = {}): PrivacySettingsView => ({
  ...DEFAULT_PRIVACY_SETTINGS, dataMode: mode, consentVersion: CURRENT_CONSENT_VERSION, consentedAt: new Date(), ...over,
});

function mutableStore(initial: PrivacySettingsView) {
  let current: PrivacySettingsView | null = initial;
  let failReads = false;
  const store: PrivacyStore = {
    async get() { if (failReads) throw new Error("db down"); return current; },
    async saveWithAudit(_id, s) { current = s; return s; },
    async repositoryOwner() { return "u1"; },
  };
  return { store, set: (s: PrivacySettingsView | null) => { current = s; }, failReads: (v: boolean) => { failReads = v; } };
}

/** Leaf providers that count every call that would have left the server. */
function leaf(name: string, calls: string[], behaviour: (n: number) => Promise<string> | string = () => "ok"): AIProvider {
  let n = 0;
  return {
    providerName: name,
    async generate(_s, u) { calls.push(`${name}:${u}`); return behaviour(++n); },
    async generateStructured<T>(_s: string, u: string) { calls.push(`${name}:${u}`); return (await behaviour(++n)) as unknown as T; },
  };
}

function build(m: ReturnType<typeof mutableStore>, leaves: AIProvider[], now?: () => Date, e = env): Promise<AIProvider> {
  const deps: PrivacyDeps = {
    store: m.store,
    env: () => e,
    now,
    buildProvider: (req) => createAIProvider({ ...req, leafProviders: leaves, recheckMs: 10 }),
  };
  return createAIProviderForUser("u1", "r1", deps);
}

test.beforeEach(() => { captureAudit(); });

test("provider created while consented sends nothing after consent is revoked", async () => {
  const calls: string[] = [];
  const m = mutableStore(consented("CLOUD"));
  const provider = await build(m, [leaf("a", calls)]);
  assert.equal(await provider.generate("s", "first"), "ok");
  assert.equal(calls.length, 1);
  m.set({ ...DEFAULT_PRIVACY_SETTINGS }); // withdrawn
  await assert.rejects(() => provider.generate("s", "second"), (e: unknown) => e instanceof PrivacyPolicyError && e.code === "NO_MODE_SELECTED");
  await assert.rejects(() => provider.generateStructured("s", "third", {}), PrivacyPolicyError);
  assert.equal(calls.length, 1, "zero external model calls after revocation");
});

test("a queued job holding an old provider cannot bypass revoked consent", async () => {
  const calls: string[] = [];
  const m = mutableStore(consented("CLOUD"));
  const provider = await build(m, [leaf("a", calls)]);
  m.set(consented("CLOUD", { consentedAt: null, consentVersion: null }));
  await assert.rejects(() => provider.generate("s", "queued"), (e: unknown) => (e as PrivacyPolicyError).code === "CONSENT_MISSING");
  assert.equal(calls.length, 0);
});

test("a transient failure retries only while consent still holds (retry rechecks consent)", async () => {
  const calls: string[] = [];
  const m = mutableStore(consented("CLOUD"));
  const flaky = leaf("a", calls, (n) => {
    if (n === 1) { m.set({ ...DEFAULT_PRIVACY_SETTINGS }); throw new Error("503 UNAVAILABLE overloaded"); }
    return "late";
  });
  const provider = await build(m, [flaky]);
  await assert.rejects(() => provider.generate("s", "x"), (e: unknown) => e instanceof PrivacyPolicyError);
  assert.equal(calls.length, 1, "the retry made no model call");
});

test("fallback to the next provider rechecks consent too", async () => {
  const calls: string[] = [];
  const m = mutableStore(consented("CLOUD"));
  const first = leaf("a", calls, () => { m.set({ ...DEFAULT_PRIVACY_SETTINGS }); throw new Error("401 invalid api key"); });
  const provider = await build(m, [first, leaf("b", calls)]);
  await assert.rejects(() => provider.generate("s", "x"), PrivacyPolicyError);
  assert.deepEqual(calls, ["a:x"], "second provider never called");
});

test("consent withdrawn while a request is in flight aborts it and discards the result", async () => {
  const calls: string[] = [];
  const m = mutableStore(consented("CLOUD"));
  let aborted = false;
  const slow: AIProvider = {
    async generate(_s, u, o) {
      calls.push(u);
      await new Promise<void>((resolve) => { o?.signal?.addEventListener("abort", () => { aborted = true; resolve(); }); setTimeout(resolve, 2000); });
      return "SENSITIVE RESULT";
    },
    async generateStructured<T>() { return {} as T; },
  };
  const provider = await build(m, [slow]);
  const pending = provider.generate("s", "inflight");
  setTimeout(() => m.set({ ...DEFAULT_PRIVACY_SETTINGS }), 40);
  await assert.rejects(() => pending, (e: unknown) => e instanceof PrivacyPolicyError);
  assert.equal(aborted, true, "provider received the abort signal");
  await assert.rejects(() => provider.generate("s", "after"), PrivacyPolicyError);
  assert.equal(calls.length, 1);
});

test("a provider that ignores the abort signal still cannot return its result after revocation", async () => {
  const m = mutableStore(consented("CLOUD"));
  const stubborn: AIProvider = {
    async generate() { await new Promise((r) => setTimeout(r, 150)); return "LEAK"; },
    async generateStructured<T>() { return {} as T; },
  };
  const provider = await build(m, [stubborn]);
  const pending = provider.generate("s", "x");
  setTimeout(() => m.set({ ...DEFAULT_PRIVACY_SETTINGS }), 30);
  await assert.rejects(() => pending, PrivacyPolicyError);
});

test("self-hosted mode never builds or calls a cloud provider, and a mid-run switch is refused", async () => {
  const calls: string[] = [];
  const m = mutableStore(consented("LOCAL"));
  // Real factory, no leaf override: LOCAL must construct only LocalProvider.
  process.env.LOCAL_AI_BASE_URL = "http://127.0.0.1:9/v1"; process.env.LOCAL_AI_MODEL = "m";
  process.env.OPENROUTER_API_KEY = "or-test"; process.env.GROQ_API_KEY = "groq-test"; process.env.GEMINI_API_KEY = "gem-test";
  const real = createAIProvider({ mode: "LOCAL", authorize: async () => undefined, onEgress: () => undefined });
  assert.ok(real instanceof AIProviderManager);
  const names = ((real as unknown as { providers: AIProvider[] }).providers).map((p) => p.providerName);
  assert.deepEqual(names, ["local"]);

  const provider = await build(m, [leaf("local", calls)]);
  await provider.generate("s", "one");
  m.set(consented("CLOUD")); // user switches to cloud mid-run: the LOCAL provider must not serve it
  await assert.rejects(() => provider.generate("s", "two"), (e: unknown) => (e as PrivacyPolicyError).code === "MODE_CHANGED");
  assert.equal(calls.length, 1);
});

test("an unreadable settings store fails closed", async () => {
  const calls: string[] = [];
  const m = mutableStore(consented("CLOUD"));
  const provider = await build(m, [leaf("a", calls)]);
  m.failReads(true);
  await assert.rejects(() => provider.generate("s", "x"), PrivacyPolicyError);
  assert.equal(calls.length, 0);
});

test("expired consent stops working", async () => {
  const calls: string[] = [];
  const old = new Date(Date.now() - 400 * 86_400_000);
  assert.equal((evaluateAIEgress(consented("CLOUD", { consentedAt: old }), env) as { error: PrivacyPolicyError }).error.code, "CONSENT_EXPIRED");
  const m = mutableStore(consented("CLOUD"));
  let clock = new Date();
  const provider = await build(m, [leaf("a", calls)], () => clock);
  await provider.generate("s", "ok");
  clock = new Date(Date.now() + 366 * 86_400_000);
  await assert.rejects(() => provider.generate("s", "expired"), (e: unknown) => (e as PrivacyPolicyError).code === "CONSENT_EXPIRED");
  assert.equal(calls.length, 1);
});

test("redaction and size limits apply to every request, including retries and fallbacks", async () => {
  const calls: string[] = [];
  const m = mutableStore(consented("CLOUD"));
  const token = fake.githubToken();
  const failing = leaf("a", calls, (n) => { if (n === 1) throw new Error("503 UNAVAILABLE"); return "ok"; });
  const provider = await build(m, [failing]);
  await provider.generate("s", `const k = "${token}";`);
  assert.equal(calls.length, 2, "one failure then one retry");
  assert.ok(calls.every((c) => !c.includes(token) && /REDACTED/.test(c)), "secret absent from BOTH attempts");

  const big = await build(m, [leaf("a", calls)]);
  const before = calls.length;
  await assert.rejects(() => big.generate("s", "x".repeat(700_000)), (e: unknown) => (e as PrivacyPolicyError).code === "PROMPT_TOO_LARGE");
  assert.equal(calls.length, before);
});
