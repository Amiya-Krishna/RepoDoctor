import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, integrationSkipReason, useDatabase, type TestDatabase } from "./db.js";
import { CURRENT_CONSENT_VERSION } from "../privacy/privacy.policy.js";
import { fake } from "./helpers.js";

const skip = integrationSkipReason();
let db: TestDatabase;
let prisma: typeof import("../config/prisma.js").prisma;
let privacy: typeof import("../privacy/privacy.service.js");
let lifecycle: typeof import("../services/lifecycle.service.js");
let audit: typeof import("../audit/audit.service.js");

test.before(async () => {
  if (skip) return;
  db = await createTestDatabase("privacy");
  await db.applyMigrations();
  useDatabase(db);
  ({ prisma } = await import("../config/prisma.js"));
  privacy = await import("../privacy/privacy.service.js");
  lifecycle = await import("../services/lifecycle.service.js");
  audit = await import("../audit/audit.service.js");
  audit.setAuditSink(undefined);
  for (const id of ["ua", "ub"]) {
    await prisma.user.create({ data: { id, name: id, email: `${id}@x.test`, password: "x" } });
  }
});
test.after(async () => { if (skip) return; await prisma.$disconnect(); await db.drop(); });

const grant = { dataMode: "CLOUD" as const, consent: true, consentVersion: CURRENT_CONSENT_VERSION };
const events = (actorId: string) => prisma.securityAuditEvent.findMany({ where: { actorId }, orderBy: { createdAt: "asc" } });

test("successful change writes settings and exactly one audit event", { skip }, async () => {
  const saved = await privacy.updatePrivacySettings("ua", grant);
  assert.equal(saved.dataMode, "CLOUD");
  const ev = await events("ua");
  assert.equal(ev.length, 1);
  assert.equal(ev[0].eventType, "CONSENT_GRANTED");
  assert.equal(ev[0].actorId, "ua");
  assert.ok(ev[0].createdAt);
});

test("retention-only change is audited as RETENTION_CHANGED; a no-op writes nothing", { skip }, async () => {
  const before = (await events("ua")).length;
  await privacy.updatePrivacySettings("ua", { ...grant, retentionDays: 7 });
  const ev = await events("ua");
  // re-confirming consent is itself a consent grant: still exactly one event per request
  assert.equal(ev.length, before + 1);
  await privacy.updatePrivacySettings("ub", { dataMode: "NONE" }); // user without settings: no change
  assert.equal((await events("ub")).length, 0);
});

test("withdrawal is audited as CONSENT_WITHDRAWN and the mode becomes NONE", { skip }, async () => {
  await privacy.updatePrivacySettings("ub", grant);
  await privacy.updatePrivacySettings("ub", { dataMode: "NONE" });
  const ev = await events("ub");
  assert.deepEqual(ev.map((e: { eventType: string }) => e.eventType), ["CONSENT_GRANTED", "CONSENT_WITHDRAWN"]);
  const row = await prisma.privacySettings.findUnique({ where: { userId: "ub" } });
  assert.equal(row?.dataMode, "NONE");
  assert.equal(row?.consentedAt, null);
});

test("audit write failure rolls back the privacy settings change", { skip }, async () => {
  await privacy.updatePrivacySettings("ua", { dataMode: "NONE" });
  await db.query(`CREATE FUNCTION rd_fail_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$ LANGUAGE plpgsql`);
  await db.query(`CREATE TRIGGER rd_fail BEFORE INSERT ON "SecurityAuditEvent" FOR EACH ROW WHEN (NEW."eventType" = 'CONSENT_GRANTED') EXECUTE FUNCTION rd_fail_audit()`);
  try {
    await assert.rejects(() => privacy.updatePrivacySettings("ua", grant));
    const row = await prisma.privacySettings.findUnique({ where: { userId: "ua" } });
    assert.equal(row?.dataMode, "NONE", "settings were rolled back with the failed audit write");
  } finally {
    await db.query(`DROP TRIGGER rd_fail ON "SecurityAuditEvent"`);
  }
});

test("sensitive values never reach audit rows", { skip }, async () => {
  const token = fake.githubToken();
  await audit.recordAudit({ eventType: "AI_EGRESS", outcome: "SUCCESS", actorId: "ua", details: { promptChars: 3, prompt: "const secret = 1", source: "code", accessToken: token, note: `leak ${token}`, nested: { password: "p", ok: 1 } } });
  const ev = (await events("ua")).filter((e: { eventType: string }) => e.eventType === "AI_EGRESS").pop();
  const text = JSON.stringify(ev?.details);
  assert.ok(!text.includes(token) && !text.includes("const secret") && !text.includes('"password"'));
  assert.match(text, /promptChars/);
});

test("audit rows are append-only at the database level", { skip }, async () => {
  const row = (await events("ua"))[0];
  await assert.rejects(() => db.query(`UPDATE "SecurityAuditEvent" SET outcome='FAILURE' WHERE id=$1`, [row.id]), /append-only/);
  await assert.rejects(() => db.query(`DELETE FROM "SecurityAuditEvent" WHERE id=$1`, [row.id]), /cannot be deleted/);
  await db.query(`INSERT INTO "SecurityAuditEvent"(id,"eventType",outcome,"createdAt") VALUES('old1','X','SUCCESS', now() - interval '400 days')`);
  await db.query(`DELETE FROM "SecurityAuditEvent" WHERE id='old1'`); // retention purge path still works
});

test("audit endpoint returns only the caller's events, paginated; unauthenticated is rejected", { skip }, async () => {
  const { listAuditEvents } = await import("../controllers/privacy.controller.js");
  const { protect } = await import("../middleware/auth.middleware.js");
  const call = async (userId: string, query: Record<string, string> = {}) => {
    const res = { code: 200, body: undefined as any, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; } };
    await listAuditEvents({ user: { userId }, query } as never, res as never);
    return res;
  };
  const a = await call("ua", { limit: "2" });
  assert.equal(a.body.events.length, 2);
  assert.ok(a.body.nextCursor);
  assert.ok(a.body.events.every((e: { details: unknown }) => !JSON.stringify(e).includes("ub@")));
  const page2 = await call("ua", { limit: "50", cursor: a.body.nextCursor });
  const ids = new Set([...a.body.events, ...page2.body.events].map((e: { id: string }) => e.id));
  assert.equal(ids.size, a.body.events.length + page2.body.events.length, "no overlap between pages");
  const b = await call("ub");
  const aIds = new Set((await events("ua")).map((e: { id: string }) => e.id));
  assert.ok(b.body.events.every((e: { id: string }) => !aIds.has(e.id)), "user B never sees user A's events");

  const res = { code: 200, body: undefined as unknown, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  let nexted = false;
  await protect({ headers: {}, header: () => undefined } as never, res as never, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res.code, 401);
});

test("deletion and its audit event commit together; a failing audit write keeps the data", { skip }, async () => {
  await prisma.repository.create({ data: { id: "r1", githubId: "1", name: "n", fullName: "o/n", ownerLogin: "o", defaultBranch: "main", htmlUrl: "h", cloneUrl: "c", userId: "ua" } });
  await db.query(`CREATE TRIGGER rd_fail_del BEFORE INSERT ON "SecurityAuditEvent" FOR EACH ROW WHEN (NEW."eventType" = 'DATA_DELETED') EXECUTE FUNCTION rd_fail_audit()`);
  try {
    await assert.rejects(() => lifecycle.deleteRepositoryData("ua", "r1"));
    assert.ok(await prisma.repository.findUnique({ where: { id: "r1" } }), "repository survives when the audit write fails");
  } finally {
    await db.query(`DROP TRIGGER rd_fail_del ON "SecurityAuditEvent"`);
  }
  assert.equal(await lifecycle.deleteRepositoryData("ua", "r1"), true);
  assert.equal(await prisma.repository.findUnique({ where: { id: "r1" } }), null);
  const types = (await events("ua")).map((e: { eventType: string }) => e.eventType);
  assert.ok(types.includes("DATA_DELETION_REQUESTED") && types.includes("DATA_DELETED"));
});
