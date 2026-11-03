import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { createTestDatabase, integrationSkipReason, redisTestConnection, useDatabase, type TestDatabase } from "./db.js";
import { captureAudit, mockReq, mockRes } from "./helpers.js";

const skip = integrationSkipReason({ postgres: true, redis: true });
const SECRET = "test-webhook-secret-0123456789";
const sign = (b: Buffer) => "sha256=" + createHmac("sha256", SECRET).update(b).digest("hex");

let db: TestDatabase;
let store: import("../github/webhook-store.js").WebhookStore;
let queue: import("../queue/scan.queue.js").ScanQueue;
let deadQueue: import("../queue/scan.queue.js").ScanQueue;
let handlerFor: (enqueue: (d: any, id: string) => Promise<unknown>) => (req: any, res: any) => Promise<unknown>;
let recover: typeof import("../github/webhook-recovery.js").recoverWebhookDeliveries;
const prefix = `rdtest-${randomBytes(4).toString("hex")}`;

test.before(async () => {
  if (skip) return;
  process.env.GITHUB_WEBHOOK_SECRET = SECRET;
  process.env.WEBHOOK_ENQUEUE_TIMEOUT_MS = "1500";
  db = await createTestDatabase("webhook");
  await db.applyMigrations();
  useDatabase(db);
  const { createPrismaWebhookStore } = await import("../github/webhook-store.js");
  const { createScanQueue, queueRepositoryScan } = await import("../queue/scan.queue.js");
  const { createWebhookHandler } = await import("../controllers/github-webhook.controller.js");
  ({ recoverWebhookDeliveries: recover } = await import("../github/webhook-recovery.js"));
  store = createPrismaWebhookStore();
  queue = createScanQueue({ connection: redisTestConnection(), prefix });
  deadQueue = createScanQueue({ connection: { host: "127.0.0.1", port: 1, enableOfflineQueue: false, maxRetriesPerRequest: 1, retryStrategy: () => null } as never, prefix });
  handlerFor = (enqueue) => createWebhookHandler({
    store,
    findAutoScanRepositories: async () => [{ id: "repoA", userId: "u1" }, { id: "repoB", userId: "u2" }],
    enqueue,
  }) as never;
  void queueRepositoryScan;
  captureAudit();
});
test.after(async () => {
  if (skip) return;
  const client = (await queue.client) as unknown as { keys(p: string): Promise<string[]>; del(...k: string[]): Promise<number> };
  const keys = await client.keys(`${prefix}:*`);
  if (keys.length) await client.del(...keys); // only this test's prefix
  await queue.close();
  // Importing the queue module also creates the default production queue (no Redis on :6379 here): close it.
  await Promise.race([(await import("../queue/scan.queue.js")).closeScanQueue().catch(() => undefined), new Promise((r) => setTimeout(r, 1000))]);
  await Promise.race([deadQueue.close().catch(() => undefined), new Promise((r) => setTimeout(r, 1000))]); // an unreachable Redis never finishes a graceful close
  const { prisma } = await import("../config/prisma.js");
  await prisma.$disconnect();
  await db.drop();
});

const real = (q: () => typeof queue) => (data: any, jobId: string) => q().add("scan", data, { jobId });
const push = () => Buffer.from(JSON.stringify({ ref: "refs/heads/main", repository: { id: 42 } }));
async function post(h: ReturnType<typeof handlerFor>, b: Buffer, delivery: string) {
  const res = mockRes();
  await h(mockReq({ headers: { "x-hub-signature-256": sign(b), "x-github-event": "push", "x-github-delivery": delivery }, rawBody: b }), res);
  return res;
}
const jobIdsFor = async (delivery: string) => (await queue.getJobs(["waiting", "delayed", "active", "completed", "failed"])).map((j) => j.id).filter((id): id is string => !!id && id.includes(delivery));

test("concurrent identical deliveries against real Postgres + BullMQ: one record, exactly one job per repository", { skip }, async () => {
  const D = "11111111-aaaa-bbbb-cccc-000000000001";
  const h = handlerFor(real(() => queue));
  const results = await Promise.all(Array.from({ length: 10 }, () => post(h, push(), D)));
  assert.ok(results.every((r: any) => [200, 202].includes(r.statusCode)), results.map((r: any) => r.statusCode).join());
  assert.deepEqual((await jobIdsFor(D)).sort(), [`github-${D}-repoA`, `github-${D}-repoB`]);
  assert.equal((await store.get(D))?.status, "QUEUED");
  const { prisma } = await import("../config/prisma.js");
  assert.equal(await prisma.webhookScanOutbox.count({ where: { deliveryId: D, status: "ENQUEUED" } }), 2);
});

test("Redis unreachable: the delivery is durable and truthful, then recovered into the real queue", { skip }, async () => {
  const D = "22222222-aaaa-bbbb-cccc-000000000002";
  const h = handlerFor(real(() => deadQueue));
  const res = await post(h, push(), D);
  assert.equal(res.statusCode, 202);
  assert.equal((res.body as any).queued, false, "never claims queued when it is not");
  const rec = await store.get(D);
  assert.equal(rec?.status, "FAILED_RETRYABLE");
  assert.equal((await jobIdsFor(D)).length, 0);

  const later = new Date(Date.now() + 60_000);
  const r = await recover({ store, enqueue: real(() => queue), now: () => later });
  assert.equal(r.queued, 1);
  assert.deepEqual((await jobIdsFor(D)).sort(), [`github-${D}-repoA`, `github-${D}-repoB`]);
});

test("worker crash between DB update and queue insertion: lease expiry + deterministic job id give exactly one job", { skip }, async () => {
  const D = "33333333-aaaa-bbbb-cccc-000000000003";
  await store.record({ deliveryId: D, event: "push", status: "PENDING", outbox: [{ repositoryId: "repoA", userId: "u1", jobId: `github-${D}-repoA` }] });
  const claim = await store.claim(D, new Date(), 1_000); // process 'dies' holding the claim
  assert.ok(claim);
  await queue.add("scan", { repositoryId: "repoA", userId: "u1", trigger: "github-webhook" }, { jobId: `github-${D}-repoA` }); // it had added the job
  const none = await recover({ store, enqueue: real(() => queue), now: () => new Date() });
  assert.equal(none.examined, 0, "lease still held");
  const later = new Date(Date.now() + 5_000);
  assert.equal((await recover({ store, enqueue: real(() => queue), now: () => later })).queued, 1);
  assert.equal((await jobIdsFor(D)).length, 1, "BullMQ add with an existing id did not create a second job");
});

test("two concurrent claims of one delivery: exactly one winner (compare-and-set)", { skip }, async () => {
  const D = "44444444-aaaa-bbbb-cccc-000000000004";
  await store.record({ deliveryId: D, event: "push", status: "PENDING", outbox: [] });
  const claims = await Promise.all(Array.from({ length: 8 }, () => store.claim(D, new Date(), 60_000)));
  assert.equal(claims.filter(Boolean).length, 1);
});

test("replay of a captured, validly signed delivery is acknowledged as duplicate with no new jobs", { skip }, async () => {
  const D = "55555555-aaaa-bbbb-cccc-000000000005";
  const h = handlerFor(real(() => queue));
  await post(h, push(), D);
  const before = (await jobIdsFor(D)).length;
  const replay = await post(h, push(), D);
  assert.equal((replay as any).statusCode, 200);
  assert.equal((replay as any).body.duplicate, true);
  assert.equal((await jobIdsFor(D)).length, before);
});

test("invalid signature creates no database row", { skip }, async () => {
  const D = "66666666-aaaa-bbbb-cccc-000000000006";
  const res = mockRes();
  await handlerFor(real(() => queue))(mockReq({ headers: { "x-hub-signature-256": "sha256=" + "0".repeat(64), "x-github-event": "push", "x-github-delivery": D }, rawBody: push() }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(await store.get(D), null);
});

test("legacy rows from the pre-lifecycle schema are terminal duplicates", { skip }, async () => {
  const D = "77777777-aaaa-bbbb-cccc-000000000007";
  await db.query(`INSERT INTO "WebhookDelivery"("deliveryId", event, status) VALUES ($1,'push','LEGACY_CLAIMED')`, [D]);
  const res = await post(handlerFor(real(() => queue)), push(), D);
  assert.equal((res as any).statusCode, 200);
  assert.equal((await jobIdsFor(D)).length, 0);
});
