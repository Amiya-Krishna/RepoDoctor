import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createWebhookHandler, type WebhookDeps } from "../controllers/github-webhook.controller.js";
import { createMemoryWebhookStore } from "../github/webhook-store.js";
import { dispatchDelivery } from "../github/webhook-dispatcher.js";
import { recoverWebhookDeliveries } from "../github/webhook-recovery.js";
import { captureAudit, mockReq, mockRes } from "./helpers.js";

const SECRET = "test-webhook-secret-0123456789";
const sign = (b: Buffer) => "sha256=" + createHmac("sha256", SECRET).update(b).digest("hex");
const D1 = "aaaaaaaa-0000-0000-0000-000000000001";

function world(opts: { failFor?: Set<string> } = {}) {
  let clock = new Date("2026-11-01T10:00:00Z");
  const store = createMemoryWebhookStore();
  const added: string[] = [];
  const failFor = opts.failFor ?? new Set<string>();
  const enqueue = async (_d: unknown, jobId: string) => {
    if ([...failFor].some((f) => jobId.endsWith(f))) throw new Error("ECONNREFUSED redis:6379");
    if (!added.includes(jobId)) added.push(jobId); // BullMQ add with an existing id is a no-op
  };
  const deps: WebhookDeps = {
    store, enqueue, now: () => clock,
    findAutoScanRepositories: async () => [{ id: "repoA", userId: "u1" }, { id: "repoB", userId: "u2" }],
  };
  return {
    store, added, failFor, deps, handler: createWebhookHandler(deps),
    advance: (ms: number) => { clock = new Date(clock.getTime() + ms); },
    now: () => clock,
  };
}

const body = (extra: object = {}) => Buffer.from(JSON.stringify({ ref: "refs/heads/main", repository: { id: 42 }, ...extra }));
async function post(h: ReturnType<typeof createWebhookHandler>, b: Buffer, delivery = D1, event = "push") {
  const res = mockRes();
  await h(mockReq({ headers: { "x-hub-signature-256": sign(b), "x-github-event": event, "x-github-delivery": delivery }, rawBody: b }), res);
  return res;
}
test.beforeEach(() => { process.env.GITHUB_WEBHOOK_SECRET = SECRET; captureAudit(); });

test("happy path: durable record, both jobs queued with deterministic ids, state QUEUED", async () => {
  const w = world();
  const res = await post(w.handler, body());
  assert.equal(res.statusCode, 202);
  assert.equal((res.body as any).state, "QUEUED");
  assert.deepEqual(w.added, [`github-${D1}-repoA`, `github-${D1}-repoB`]);
  assert.equal((await w.store.get(D1))?.status, "QUEUED");
});

test("Redis unavailable: delivery is recorded, response is truthful (not queued), recovery completes it", async () => {
  const w = world({ failFor: new Set(["repoA", "repoB"]) });
  const res = await post(w.handler, body());
  assert.equal(res.statusCode, 202);
  assert.equal((res.body as any).queued, false);
  assert.equal((res.body as any).state, "FAILED_RETRYABLE");
  assert.equal(w.added.length, 0);
  // Still inside the backoff window: the sweep does not hammer Redis.
  assert.equal((await recoverWebhookDeliveries({ ...w.deps, limit: 10 })).examined, 0);
  w.failFor.clear(); w.advance(10_000);
  const r = await recoverWebhookDeliveries({ ...w.deps, limit: 10 });
  assert.equal(r.queued, 1);
  assert.equal(w.added.length, 2);
  assert.equal((await w.store.get(D1))?.status, "QUEUED");
});

test("partial repository failure: only the failed repository is retried; no duplicate job for the first", async () => {
  const w = world({ failFor: new Set(["repoB"]) });
  await post(w.handler, body());
  assert.deepEqual(w.added, [`github-${D1}-repoA`]);
  assert.equal((await w.store.get(D1))?.status, "FAILED_RETRYABLE");
  const enqueueCalls: string[] = [];
  w.failFor.clear(); w.advance(10_000);
  await recoverWebhookDeliveries({ ...w.deps, enqueue: async (d, id) => { enqueueCalls.push(id); return w.deps.enqueue(d, id); } });
  assert.deepEqual(enqueueCalls, [`github-${D1}-repoB`], "repoA was not re-added");
  assert.deepEqual(w.added.sort(), [`github-${D1}-repoA`, `github-${D1}-repoB`]);
});

test("worker crash during processing: lease blocks others, expiry lets recovery finish exactly once", async () => {
  const w = world();
  // Record the delivery, then 'crash' right after claiming it (before any enqueue).
  await w.store.record({ deliveryId: D1, event: "push", status: "PENDING", outbox: [{ repositoryId: "repoA", userId: "u1", jobId: `github-${D1}-repoA` }] });
  assert.ok(await w.store.claim(D1, w.now(), 60_000));
  const live = await dispatchDelivery(w.deps, D1);
  assert.equal(live.claimed, false, "live lease: nobody else processes it");
  assert.equal(live.state, "PROCESSING");
  w.advance(61_000);
  const r = await recoverWebhookDeliveries(w.deps);
  assert.equal(r.queued, 1);
  assert.deepEqual(w.added, [`github-${D1}-repoA`]);
});

test("crash after enqueue but before the outbox row was marked: re-dispatch does not duplicate the job", async () => {
  const w = world();
  await w.store.record({ deliveryId: D1, event: "push", status: "PENDING", outbox: [{ repositoryId: "repoA", userId: "u1", jobId: `github-${D1}-repoA` }] });
  await w.deps.enqueue({} as never, `github-${D1}-repoA`); // the job was added, then the process died
  assert.ok(await w.store.claim(D1, w.now(), 1_000));
  w.advance(2_000);
  const r = await recoverWebhookDeliveries(w.deps);
  assert.equal(r.queued, 1);
  assert.equal(w.added.length, 1, "deterministic job id: still exactly one job");
});

test("retry of the same delivery id (GitHub redelivery) resumes a recoverable delivery and acknowledges a finished one as duplicate", async () => {
  const w = world({ failFor: new Set(["repoA", "repoB"]) });
  const b = body();
  await post(w.handler, b);
  w.failFor.clear(); w.advance(10_000);
  const retry = await post(w.handler, b);
  assert.equal(retry.statusCode, 202);
  assert.equal((retry.body as any).resumed, true);
  assert.equal((retry.body as any).state, "QUEUED");
  const again = await post(w.handler, b);
  assert.equal(again.statusCode, 200);
  assert.equal((again.body as any).duplicate, true);
  assert.equal(w.added.length, 2);
});

test("attempt budget exhausted -> FAILED_PERMANENT and is never retried automatically", async () => {
  const w = world({ failFor: new Set(["repoA", "repoB"]) });
  process.env.WEBHOOK_MAX_DISPATCH_ATTEMPTS = "3";
  try {
    await post(w.handler, body());
    for (let i = 0; i < 4; i++) { w.advance(20 * 60_000); await recoverWebhookDeliveries({ ...w.deps, maxAttempts: 3 }); }
    assert.equal((await w.store.get(D1))?.status, "FAILED_PERMANENT");
    assert.equal((await recoverWebhookDeliveries(w.deps)).examined, 0);
  } finally { delete process.env.WEBHOOK_MAX_DISPATCH_ATTEMPTS; }
});

test("concurrent identical deliveries produce one record and one job per repository", async () => {
  const w = world();
  const b = body();
  const results = await Promise.all(Array.from({ length: 12 }, () => post(w.handler, b)));
  assert.ok(results.every((r) => [200, 202].includes(r.statusCode)));
  assert.equal(w.added.length, 2);
  assert.equal(w.store.deliveries.size, 1);
});

test("a failed store write is never acknowledged (503) and queues nothing", async () => {
  const w = world();
  const store = { ...w.store, record: async () => { throw new Error("db down"); } };
  const h = createWebhookHandler({ ...w.deps, store });
  const res = await post(h, body());
  assert.equal(res.statusCode, 503);
  assert.equal(w.added.length, 0);
});

test("stale events are refused; ignored events are stored so replays are acknowledged", async () => {
  const w = world();
  const stale = body({ head_commit: { timestamp: "2026-01-01T00:00:00Z" } });
  const res = await post(w.handler, stale, "bbbbbbbb-0000-0000-0000-000000000002");
  assert.equal(res.statusCode, 400);
  assert.equal((await w.store.get("bbbbbbbb-0000-0000-0000-000000000002")), null);

  const tag = Buffer.from(JSON.stringify({ ref: "refs/tags/v1", repository: { id: 42 } }));
  assert.equal((await post(w.handler, tag, "cccccccc-0000-0000-0000-000000000003")).statusCode, 202);
  const dup = await post(w.handler, tag, "cccccccc-0000-0000-0000-000000000003");
  assert.equal(dup.statusCode, 200);
  assert.equal((dup.body as any).state, "IGNORED");
});

test("legacy-claimed deliveries are terminal duplicates; purge removes only terminal rows", async () => {
  const w = world();
  await w.store.record({ deliveryId: "dddddddd-0000-0000-0000-000000000004", event: "push", status: "PENDING", outbox: [] });
  w.store.deliveries.get("dddddddd-0000-0000-0000-000000000004")!.status = "LEGACY_CLAIMED";
  const dup = await post(w.handler, body(), "dddddddd-0000-0000-0000-000000000004");
  assert.equal(dup.statusCode, 200);
  assert.equal(w.added.length, 0);
  await w.store.record({ deliveryId: "eeeeeeee-0000-0000-0000-000000000005", event: "push", status: "PENDING", outbox: [] });
  const old = new Date(Date.now() + 100 * 86_400_000);
  assert.equal(await w.store.purgeTerminal(old), 1);
  assert.ok(await w.store.get("eeeeeeee-0000-0000-0000-000000000005"), "PENDING delivery survives the purge");
});
