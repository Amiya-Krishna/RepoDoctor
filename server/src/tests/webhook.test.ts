import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createWebhookHandler, type WebhookDeps } from "../controllers/github-webhook.controller.js";
import { verifyGitHubWebhookSignature } from "../github/github-webhook.signature.js";
import { claimDelivery, type DeliveryStore } from "../github/webhook-replay.js";
import { captureAudit, mockReq, mockRes } from "./helpers.js";

const SECRET = "test-webhook-secret-0123456789";
const sign = (b: Buffer, s = SECRET) => "sha256=" + createHmac("sha256", s).update(b).digest("hex");

function memoryDeliveries(): DeliveryStore & { seen: Set<string> } {
  const seen = new Set<string>();
  return { seen, async claim(id) { if (seen.has(id)) return false; seen.add(id); return true; } };
}

function setup(over: Partial<WebhookDeps> = {}) {
  const queued: string[] = [];
  const deliveries = memoryDeliveries();
  const deps: WebhookDeps = {
    deliveries,
    findAutoScanRepositories: async () => [{ id: "repoA", userId: "u1" }, { id: "repoB", userId: "u2" }],
    queueScan: async (_d, jobId) => { queued.push(jobId); return { jobId }; },
    ...over,
  };
  return { handler: createWebhookHandler(deps), queued, deliveries };
}

const push = (extra: object = {}) => Buffer.from(JSON.stringify({ ref: "refs/heads/main", repository: { id: 42 }, ...extra }));

function call(handler: ReturnType<typeof createWebhookHandler>, body: Buffer, o: { sig?: string; delivery?: string; event?: string } = {}) {
  const res = mockRes();
  const headers: Record<string, string> = {
    "x-hub-signature-256": o.sig ?? sign(body),
    "x-github-event": o.event ?? "push",
    "x-github-delivery": o.delivery ?? "11111111-aaaa-bbbb-cccc-000000000001",
  };
  return handler(mockReq({ headers, rawBody: body }), res).then(() => res);
}

test.beforeEach(() => { process.env.GITHUB_WEBHOOK_SECRET = SECRET; captureAudit(); });

test("signature: valid accepted; tampered body, wrong secret, malformed header rejected", () => {
  const b = Buffer.from('{"a":1}');
  assert.equal(verifyGitHubWebhookSignature(b, sign(b), SECRET), true);
  assert.equal(verifyGitHubWebhookSignature(Buffer.from('{"a":2}'), sign(b), SECRET), false);
  assert.equal(verifyGitHubWebhookSignature(b, sign(b, "other"), SECRET), false);
  for (const bad of ["", "sha256=", "sha1=abc", "sha256=" + "z".repeat(64), sign(b).toUpperCase().replace("SHA256", "sha256") + "00"]) {
    assert.equal(verifyGitHubWebhookSignature(b, bad, SECRET), false, bad);
  }
});

test("unsigned / badly signed requests get 401 and trigger nothing", async () => {
  const { handler, queued, deliveries } = setup();
  const res = await call(handler, push(), { sig: "sha256=" + "0".repeat(64) });
  assert.equal(res.statusCode, 401);
  assert.equal(queued.length, 0);
  assert.equal(deliveries.seen.size, 0, "unauthenticated requests must not consume delivery ids");
});

test("missing secret configuration disables the endpoint (503)", async () => {
  delete process.env.GITHUB_WEBHOOK_SECRET;
  const { handler } = setup();
  assert.equal((await call(handler, push())).statusCode, 503);
});

test("a captured, correctly signed delivery cannot be replayed", async () => {
  const { handler, queued } = setup();
  const body = push();
  assert.equal((await call(handler, body)).statusCode, 202);
  const jobsAfterFirst = queued.length;
  const second = await call(handler, body);
  assert.equal(second.statusCode, 200);
  assert.equal((second.body as any).accepted, false);
  assert.equal(queued.length, jobsAfterFirst, "no additional jobs");
});

test("if the replay store is down, the webhook fails closed (503) and queues nothing", async () => {
  const { handler, queued } = setup({ deliveries: { claim: async () => { throw new Error("db down"); } } });
  assert.equal((await call(handler, push())).statusCode, 503);
  assert.equal(queued.length, 0);
});

test("malformed delivery ids are rejected", async () => {
  const { handler } = setup();
  assert.equal((await call(handler, push(), { delivery: "x; DROP TABLE" })).statusCode, 400);
});

test("fork pull requests and non-opted-in repositories are ignored", async () => {
  const { handler, queued } = setup();
  const fork = Buffer.from(JSON.stringify({ action: "opened", repository: { id: 42 }, pull_request: { head: { ref: "x", repo: { id: 99 } } } }));
  assert.equal((await call(handler, fork, { event: "pull_request", delivery: "22222222-0000-0000-0000-000000000002" })).statusCode, 202);
  assert.equal(queued.length, 0);

  const none = setup({ findAutoScanRepositories: async () => [] });
  const res = await call(none.handler, push(), { delivery: "33333333-0000-0000-0000-000000000003" });
  assert.match(String((res.body as any).ignored), /not enabled/);
  assert.equal(none.queued.length, 0);
});

test("accepted push queues one scan per opted-in repository, with per-repository job ids", async () => {
  const { handler, queued } = setup();
  await call(handler, push(), { delivery: "44444444-0000-0000-0000-000000000004" });
  assert.deepEqual(queued, ["github-44444444-0000-0000-0000-000000000004-repoA", "github-44444444-0000-0000-0000-000000000004-repoB"]);
});

test("claimDelivery: new, replay, invalid", async () => {
  const s = memoryDeliveries();
  assert.equal(await claimDelivery(s, "abcdef12-3456", "push"), "new");
  assert.equal(await claimDelivery(s, "abcdef12-3456", "push"), "replay");
  assert.equal(await claimDelivery(s, "../etc", "push"), "invalid");
});
