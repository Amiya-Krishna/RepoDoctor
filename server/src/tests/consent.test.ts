import test from "node:test";
import assert from "node:assert/strict";
import {
  CURRENT_CONSENT_VERSION, DEFAULT_PRIVACY_SETTINGS, PrivacyPolicyError, evaluateAIEgress, clampRetentionDays,
  type PrivacySettingsView,
} from "../privacy/privacy.policy.js";
import { createAIProviderForUser, updatePrivacySettings, getPrivacySettings, type PrivacyDeps, type PrivacyStore } from "../privacy/privacy.service.js";
import type { AIProvider } from "../ai/ai.provider.js";
import { GuardedAIProvider } from "../ai/guarded.provider.js";
import { captureAudit, fake } from "./helpers.js";
import { recordAudit } from "../audit/audit.service.js";

const env = { localAiBaseUrl: "http://llm.internal:11434/v1", cloudProvidersConfigured: true };
const consented = (mode: "CLOUD" | "LOCAL", over: Partial<PrivacySettingsView> = {}): PrivacySettingsView => ({
  ...DEFAULT_PRIVACY_SETTINGS, dataMode: mode, consentVersion: CURRENT_CONSENT_VERSION, consentedAt: new Date(), ...over,
});

function memoryStore(initial?: PrivacySettingsView): PrivacyStore & { data: Map<string, PrivacySettingsView> } {
  const data = new Map<string, PrivacySettingsView>();
  if (initial) data.set("u1", initial);
  return {
    data,
    async get(id) { return data.get(id) ?? null; },
    // Emulates the Prisma transaction: the audit event is written first and a failure aborts the save.
    async saveWithAudit(id, s, audit) { await recordAudit(audit, { failClosed: true }); data.set(id, s); return s; },
    async repositoryOwner(r) { return r === "r1" ? "u1" : null; },
  };
}

function depsWith(store: PrivacyStore, calls: string[], e = env): PrivacyDeps {
  const inner: AIProvider = {
    async generate(_s, u) { calls.push(u); return "ok"; },
    async generateStructured<T>(_s: string, u: string) { calls.push(u); return {} as T; },
  };
  return {
    store,
    env: () => e,
    buildProvider: ({ mode, onEgress, authorize }) => new GuardedAIProvider(inner, { mode, onEgress, authorize }),
  };
}

test("default settings send nothing anywhere (safest default)", () => {
  const d = evaluateAIEgress(undefined, env);
  assert.equal(d.allowed, false);
  assert.equal(!d.allowed && d.error.code, "NO_MODE_SELECTED");
});

test("choosing a mode without recorded consent is refused", () => {
  for (const mode of ["CLOUD", "LOCAL"] as const) {
    const d = evaluateAIEgress({ ...DEFAULT_PRIVACY_SETTINGS, dataMode: mode }, env);
    assert.equal(!d.allowed && d.error.code, "CONSENT_MISSING");
  }
});

test("consent for an older version of the terms stops working", () => {
  const d = evaluateAIEgress(consented("CLOUD", { consentVersion: CURRENT_CONSENT_VERSION - 1 }), env);
  assert.equal(!d.allowed && d.error.code, "CONSENT_OUTDATED");
});

test("consented CLOUD / LOCAL are allowed; LOCAL never needs cloud providers", () => {
  assert.deepEqual(evaluateAIEgress(consented("CLOUD"), env), { allowed: true, mode: "CLOUD" });
  assert.deepEqual(evaluateAIEgress(consented("LOCAL"), { ...env, cloudProvidersConfigured: false }), { allowed: true, mode: "LOCAL" });
});

test("fails closed when the selected backend is not configured (no silent switch to the other mode)", () => {
  const local = evaluateAIEgress(consented("LOCAL"), { cloudProvidersConfigured: true });
  assert.equal(!local.allowed && local.error.code, "LOCAL_AI_NOT_CONFIGURED");
  const cloud = evaluateAIEgress(consented("CLOUD"), { localAiBaseUrl: env.localAiBaseUrl, cloudProvidersConfigured: false });
  assert.equal(!cloud.allowed && cloud.error.code, "CLOUD_AI_NOT_CONFIGURED");
  assert.ok(!local.allowed && local.error.recovery.length > 10, "errors carry a recovery suggestion");
});

test("no AI provider object is created without consent, and no prompt reaches a model", async () => {
  const events = captureAudit();
  const calls: string[] = [];
  const deps = depsWith(memoryStore(), calls);
  await assert.rejects(() => createAIProviderForUser("u1", "r1", deps), (e: unknown) => e instanceof PrivacyPolicyError && e.code === "NO_MODE_SELECTED");
  assert.equal(calls.length, 0);
  assert.ok(events.some((e) => e.eventType === "AI_EGRESS_BLOCKED" && e.outcome === "DENIED"));
});

test("with consent, prompts are redacted before they reach the model and egress is audited without content", async () => {
  const events = captureAudit();
  const calls: string[] = [];
  const store = memoryStore(consented("CLOUD"));
  const provider = await createAIProviderForUser("u1", "r1", depsWith(store, calls));
  const token = fake.githubToken();
  await provider.generate("system", `const apiKey = "${token}"; function f(){}`);
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].includes(token), "secret must not reach the model");
  assert.match(calls[0], /\[REDACTED/);
  const egress = events.find((e) => e.eventType === "AI_EGRESS");
  assert.ok(egress);
  assert.ok(!JSON.stringify(egress).includes(token), "audit trail never holds the secret");
  assert.ok(!JSON.stringify(egress).includes("function f"), "audit trail never holds source code");
  assert.ok((egress!.details as any).promptSha256);
});

test("withdrawing consent (mode NONE) stops AI immediately and clears the consent record", async () => {
  captureAudit();
  const store = memoryStore(consented("CLOUD"));
  const deps = depsWith(store, []);
  await updatePrivacySettings("u1", { dataMode: "NONE" }, deps);
  const s = await getPrivacySettings("u1", deps);
  assert.equal(s.dataMode, "NONE");
  assert.equal(s.consentedAt, null);
  await assert.rejects(() => createAIProviderForUser("u1", undefined, deps), PrivacyPolicyError);
});

test("enabling AI requires explicit consent for the current version in the same request", async () => {
  captureAudit();
  const deps = depsWith(memoryStore(), []);
  await assert.rejects(() => updatePrivacySettings("u1", { dataMode: "CLOUD" }, deps), (e: unknown) => (e as PrivacyPolicyError).code === "CONSENT_MISSING");
  await assert.rejects(() => updatePrivacySettings("u1", { dataMode: "CLOUD", consent: true, consentVersion: 0 }, deps), (e: unknown) => (e as PrivacyPolicyError).code === "CONSENT_OUTDATED");
  const ok = await updatePrivacySettings("u1", { dataMode: "LOCAL", consent: true, consentVersion: CURRENT_CONSENT_VERSION, retentionDays: 7 }, deps);
  assert.equal(ok.dataMode, "LOCAL");
  assert.equal(ok.retentionDays, 7);
});

test("consent changes are written to the audit log, and a failing audit write blocks the change (fail closed)", async () => {
  const events = captureAudit();
  const deps = depsWith(memoryStore(), []);
  await updatePrivacySettings("u1", { dataMode: "CLOUD", consent: true, consentVersion: CURRENT_CONSENT_VERSION }, deps);
  assert.ok(events.some((e) => e.eventType === "CONSENT_GRANTED"));

  const { setAuditSink } = await import("../audit/audit.service.js");
  setAuditSink({ async write() { throw new Error("db down"); } });
  await assert.rejects(() => updatePrivacySettings("u1", { dataMode: "NONE" }, deps));
});

test("an unavailable audit log blocks AI egress rather than sending unaudited data", async () => {
  const { setAuditSink } = await import("../audit/audit.service.js");
  setAuditSink({ async write() { throw new Error("db down"); } });
  const calls: string[] = [];
  const provider = await createAIProviderForUser("u1", "r1", depsWith(memoryStore(consented("CLOUD")), calls));
  await assert.rejects(() => provider.generate("s", "u"));
  assert.equal(calls.length, 0);
});

test("retention days are clamped to a sane range", () => {
  assert.equal(clampRetentionDays(0), 1);
  assert.equal(clampRetentionDays(100000), 365);
  assert.equal(clampRetentionDays("abc"), 30);
  assert.equal(clampRetentionDays(14.9), 14);
});
