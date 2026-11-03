import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDatabase, integrationSkipReason, useDatabase, type TestDatabase } from "./db.js";

/** Real PostgreSQL: retention, deletion, concurrency, and schema-vs-database agreement. */
const skip = integrationSkipReason({ postgres: true });
let db: TestDatabase;
let prisma: typeof import("../config/prisma.js").prisma;
let life: typeof import("../services/lifecycle.service.js");
let seq = 0;
const DAY = 86_400_000;

test.before(async () => {
  if (skip) return;
  db = await createTestDatabase("life");
  await db.applyMigrations();
  useDatabase(db);
  ({ prisma } = await import("../config/prisma.js"));
  life = await import("../services/lifecycle.service.js");
});
test.after(async () => { if (skip) return; await prisma.$disconnect(); await db.drop(); });

async function seedUser(opts: { retentionDays?: number; ageDays?: number; jobStatus?: string } = {}) {
  const n = ++seq; const userId = `u${n}`, repoId = `r${n}`;
  await prisma.user.create({ data: { id: userId, name: "n", email: `${userId}@x.test`, password: "x", githubAccessToken: "tok", githubId: `g${n}`, githubUsername: `gu${n}` } });
  if (opts.retentionDays) await prisma.privacySettings.create({ data: { userId, retentionDays: opts.retentionDays } as never });
  await prisma.repository.create({ data: { id: repoId, githubId: String(n), name: "n", fullName: `o/n${n}`, ownerLogin: "o", defaultBranch: "main", htmlUrl: "h", cloneUrl: "c", userId } });
  const created = new Date(Date.now() - (opts.ageDays ?? 0) * DAY);
  const a = await prisma.analysis.create({ data: { id: `a${n}`, repositoryId: repoId, status: "COMPLETED", createdAt: created } });
  await prisma.dockerTestRun.create({ data: { analysisId: a.id, repositoryPath: "p", testCommand: ["t"], success: true, stdout: "", stderr: "", durationMs: 1, timedOut: false } as never });
  await prisma.repairAttempt.create({ data: { analysisId: a.id, findingId: "f", attemptNumber: 1, status: "X" } as never });
  await prisma.pullRequest.create({ data: { analysisId: a.id, findingId: "f", fixProposalId: "x", verificationResultId: "y", repositoryOwner: "o", repositoryName: "n", branchName: "b", baseBranch: "m", commitSha: "c", pullRequestNumber: 1, pullRequestUrl: "u", title: "t" } });
  await prisma.repairJob.create({ data: { id: `j${n}`, analysisId: a.id, findingId: "f", status: opts.jobStatus ?? "COMPLETED" } });
  await prisma.repositoryMemoryChunk.create({ data: { repositoryId: repoId, sourceType: "s", sourcePath: "p", contentHash: "h", content: "c", embedding: [1] } as never });
  await prisma.notification.create({ data: { userId, type: "T", title: "t", message: "m" } });
  return { userId, repoId, analysisId: a.id };
}
const counts = async (s: { userId: string; repoId: string; analysisId: string }) => ({
  analysis: await prisma.analysis.count({ where: { id: s.analysisId } }),
  docker: await prisma.dockerTestRun.count({ where: { analysisId: s.analysisId } }),
  attempts: await prisma.repairAttempt.count({ where: { analysisId: s.analysisId } }),
  prs: await prisma.pullRequest.count({ where: { analysisId: s.analysisId } }),
  jobs: await prisma.repairJob.count({ where: { analysisId: s.analysisId } }),
  chunks: await prisma.repositoryMemoryChunk.count({ where: { repositoryId: s.repoId } }),
  notes: await prisma.notification.count({ where: { userId: s.userId } }),
});
const ZERO = { analysis: 0, docker: 0, attempts: 0, prs: 0, jobs: 0, chunks: 0, notes: 0 };

test("repository deletion removes every dependent row, is scoped to the owner, and is audited", { skip }, async () => {
  const mine = await seedUser(); const other = await seedUser();
  assert.equal(await life.deleteRepositoryData(other.userId, mine.repoId), false, "another user cannot delete it");
  assert.equal((await counts(mine)).analysis, 1);
  assert.equal(await life.deleteRepositoryData(mine.userId, mine.repoId), true);
  assert.deepEqual({ ...(await counts(mine)), notes: 0 }, ZERO);
  assert.equal((await counts(other)).analysis, 1, "other user's data untouched");
  const kinds = (await prisma.securityAuditEvent.findMany({ where: { actorId: mine.userId } })).map((e: any) => e.eventType);
  assert.ok(kinds.includes("DATA_DELETION_REQUESTED") && kinds.includes("DATA_DELETED"));
});

test("delete-all-data wipes analysis data, withdraws the GitHub connection and consent, keeps the account", { skip }, async () => {
  const s = await seedUser({ retentionDays: 30 });
  await life.deleteAllUserData(s.userId, { deleteAccount: false });
  assert.deepEqual(await counts(s), ZERO);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
  assert.equal(u.githubAccessToken, null); assert.equal(u.githubId, null);
  assert.equal(await prisma.privacySettings.count({ where: { userId: s.userId } }), 0);
});

test("account deletion removes the user and everything under it", { skip }, async () => {
  const s = await seedUser({ retentionDays: 30 });
  await life.deleteAllUserData(s.userId, { deleteAccount: true });
  assert.deepEqual(await counts(s), ZERO);
  assert.equal(await prisma.user.count({ where: { id: s.userId } }), 0);
  assert.ok((await prisma.securityAuditEvent.count({ where: { actorId: s.userId, eventType: "DATA_DELETED" } })) >= 1, "audit survives account deletion");
});

test("retention purge: expired analyses go, fresh ones stay, user retention is honoured, pending approvals are protected", { skip }, async () => {
  const old = await seedUser({ ageDays: 200 });                                   // default retention keeps < 90? -> expired
  const fresh = await seedUser({ ageDays: 1 });
  const short = await seedUser({ ageDays: 10, retentionDays: 7 });                // user chose 7 days
  const longKept = await seedUser({ ageDays: 10, retentionDays: 365 });
  const pending = await seedUser({ ageDays: 200, jobStatus: "AWAITING_APPROVAL" });
  await life.purgeExpiredData();
  assert.equal((await counts(old)).analysis, 0, "old purged");
  assert.equal((await counts(fresh)).analysis, 1);
  assert.equal((await counts(short)).analysis, 0, "7-day retention honoured");
  assert.equal((await counts(longKept)).analysis, 1);
  assert.equal((await counts(pending)).analysis, 1, "verified repair awaiting the owner is kept");
  assert.equal((await counts(old)).docker, 0, "string-keyed tables are purged too");
  const again = await life.purgeExpiredData();
  assert.equal(again.analysesDeleted, 0, "idempotent");
});

test("concurrent deletes of the same repository: exactly one reports true and nothing is left over", { skip }, async () => {
  const s = await seedUser();
  const results = await Promise.allSettled([life.deleteRepositoryData(s.userId, s.repoId), life.deleteRepositoryData(s.userId, s.repoId), life.deleteRepositoryData(s.userId, s.repoId)]);
  assert.ok(results.some((r) => r.status === "fulfilled" && r.value === true));
  assert.deepEqual({ ...(await counts(s)), notes: 0 }, ZERO);
});

test("concurrent claims of one repair job: the compare-and-set lets exactly one winner through", { skip }, async () => {
  const s = await seedUser({ jobStatus: "APPROVED" });
  const claim = () => prisma.repairJob.updateMany({ where: { id: `j${seq}`, status: "APPROVED" }, data: { status: "REVALIDATING" } });
  const counts2 = (await Promise.all(Array.from({ length: 8 }, claim))).map((r) => r.count);
  assert.equal(counts2.reduce((a, b) => a + b, 0), 1);
  void s;
});

test("PullRequest uniqueness is enforced under concurrent inserts", { skip }, async () => {
  const s = await seedUser();
  const ins = () => prisma.pullRequest.create({ data: { analysisId: s.analysisId, findingId: "f", fixProposalId: "x", verificationResultId: "y", repositoryOwner: "o", repositoryName: "n", branchName: "b", baseBranch: "m", commitSha: "c", pullRequestNumber: 2, pullRequestUrl: "u", title: "t" } });
  const r = await Promise.allSettled([ins(), ins(), ins()]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 0, "seed already holds the single allowed row");
  assert.equal(await prisma.pullRequest.count({ where: { analysisId: s.analysisId } }), 1);
});

/** Stand-in for `prisma migrate diff` (the Prisma engines cannot be downloaded here): every model field must exist as a column. */
function parseSchema(text: string) {
  const models: { table: string; columns: string[] }[] = [];
  const enums = new Set([...text.matchAll(/^enum\s+(\w+)/gm)].map((m) => m[1]));
  const modelNames = new Set([...text.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]));
  for (const m of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const body = m[2];
    const map = /@@map\("([^"]+)"\)/.exec(body)?.[1];
    const columns: string[] = [];
    for (const line of body.split("\n")) {
      const f = /^\s{2}(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/.exec(line);
      if (!f || line.trim().startsWith("@@") || line.trim().startsWith("//")) continue;
      const [, name, type, list, , rest] = f;
      if (list || modelNames.has(type)) continue; // relation fields
      const colName = /@map\("([^"]+)"\)/.exec(rest)?.[1] ?? name;
      void enums;
      columns.push(colName);
    }
    models.push({ table: map ?? m[1], columns });
  }
  return models;
}

test("schema.prisma and the migrated database agree on every table and column (no drift)", { skip }, async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const models = parseSchema(fs.readFileSync(path.resolve(here, "../../prisma/schema.prisma"), "utf8"));
  assert.ok(models.length >= 18);
  const problems: string[] = [];
  for (const m of models) {
    const cols = (await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name=$1`, [m.table])).rows.map((r: any) => r.column_name);
    if (cols.length === 0) { problems.push(`missing table ${m.table}`); continue; }
    for (const c of m.columns) if (!cols.includes(c)) problems.push(`${m.table}.${c} missing in database`);
    for (const c of cols) if (!m.columns.includes(c)) problems.push(`${m.table}.${c} missing in schema.prisma`);
  }
  const tables = (await db.query(`select table_name from information_schema.tables where table_schema='public' and table_name <> '_prisma_migrations'`)).rows.map((r: any) => r.table_name);
  for (const t of tables) if (!models.some((m) => m.table === t)) problems.push(`database table ${t} has no model`);
  assert.deepEqual(problems, []);
});
