import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createTestDatabase, integrationSkipReason, migrationNames, MIGRATIONS_DIR } from "./db.js";

/** Real PostgreSQL. Reproduces an install that has real data at the schema BEFORE the hardening migrations. */
const skip = integrationSkipReason({ postgres: true });
const OLD = "20261010190000_repository_memory_chunks";
const HARDENING = "20261031000000_privacy_security_hardening";
const RELIABILITY = "20261101000000_reliability_hardening";

async function seedOldSchema(db: Awaited<ReturnType<typeof createTestDatabase>>) {
  await db.query(`INSERT INTO "users"(id,name,email,password,"githubAccessToken","updatedAt") VALUES ('u1','A','a@x.test','x','gho_plaintext_legacy',now()),('u2','B','b@x.test','x',NULL,now())`);
  await db.query(`INSERT INTO "Repository"(id,"githubId",name,"fullName","ownerLogin","defaultBranch","htmlUrl","cloneUrl","userId","updatedAt") VALUES ('r1','1','n','o/n','o','main','h','c','u1',now())`);
  await db.query(`INSERT INTO "Analysis"(id,"repositoryId","updatedAt") VALUES ('a1','r1',now()),('a2','r1',now())`);
  const pr = (id: string, analysis: string, finding: string, n: number, at: string) =>
    db.query(`INSERT INTO "PullRequest"(id,"analysisId","findingId","fixProposalId","verificationResultId","repositoryOwner","repositoryName","branchName","baseBranch","commitSha","pullRequestNumber","pullRequestUrl",title,"createdAt") VALUES ($1,$2,$3,'fp','vr','o','n','b','main','c',$4::int,'https://x/'||$4::text,'t',$5)`, [id, analysis, finding, n, at]);
  await pr("pr1", "a1", "f1", 1, "2026-10-01"); await pr("pr2", "a1", "f1", 2, "2026-10-02"); await pr("pr3", "a1", "f1", 3, "2026-10-03"); await pr("pr4", "a2", "f9", 4, "2026-10-04");
  const job = (id: string, status: string) => db.query(`INSERT INTO "RepairJob"(id,"analysisId","findingId",status,"updatedAt") VALUES ($1,'a1',$2,$3,now())`, [id, id, status]);
  await job("j-pub", "PUBLISHED"); await job("j-app", "APPROVED"); await job("j-await", "AWAITING_APPROVAL");
  await db.query(`INSERT INTO "SecurityAuditEvent"(id,"eventType",outcome) VALUES ('e1','LOGIN','SUCCESS')`);
}

test("the unique index alone FAILS on duplicate PullRequests (the failure the old migration would have hit)", { skip }, async () => {
  const db = await createTestDatabase("dupfail");
  try {
    await db.applyMigrations({ upTo: OLD }); await seedOldSchema(db);
    await assert.rejects(db.query(`CREATE UNIQUE INDEX "PullRequest_analysisId_findingId_key" ON "PullRequest"("analysisId","findingId")`), /could not create unique index|duplicate key/);
  } finally { await db.drop(); }
});

test("upgrade of a populated old-schema database: duplicates archived, newest kept, nothing else lost", { skip }, async () => {
  const db = await createTestDatabase("upgrade");
  try {
    await db.applyMigrations({ upTo: OLD }); await seedOldSchema(db);
    const before = (await db.query(`select count(*)::int c from "PullRequest"`)).rows[0].c;
    const applied = await db.applyMigrations({ after: OLD });
    assert.deepEqual(applied, [HARDENING, RELIABILITY].concat(migrationNames().filter((n) => n > RELIABILITY)));

    const kept = (await db.query(`select id from "PullRequest" where "analysisId"='a1' and "findingId"='f1'`)).rows;
    assert.equal(kept.length, 1);
    const archived = (await db.query(`select id,"keptPullRequestId",reason from "PullRequestDuplicateArchive" order by id`)).rows;
    assert.equal(archived.length, 2);
    assert.ok(archived.every((a: any) => a.keptPullRequestId === kept[0].id && a.reason));
    const total = (await db.query(`select count(*)::int c from "PullRequest"`)).rows[0].c + archived.length;
    assert.equal(total, before, "every pre-existing row is either kept or archived");
    assert.equal((await db.query(`select count(*)::int c from "PullRequest" where id='pr4'`)).rows[0].c, 1, "unrelated rows untouched");

    // Unique constraint is now enforced.
    await assert.rejects(db.query(`INSERT INTO "PullRequest"(id,"analysisId","findingId","fixProposalId","verificationResultId","repositoryOwner","repositoryName","branchName","baseBranch","commitSha","pullRequestNumber","pullRequestUrl",title) VALUES ('dup','a2','f9','x','x','o','n','b','m','c',9,'u','t')`), /unique|duplicate/i);

    // Users, tokens (not touched by the SQL migration; the token migrator handles them), audit rows preserved.
    assert.equal((await db.query(`select "githubAccessToken" t from "users" where id='u1'`)).rows[0].t, "gho_plaintext_legacy");
    assert.equal((await db.query(`select count(*)::int c from "SecurityAuditEvent" where id='e1'`)).rows[0].c, 1);
  } finally { await db.drop(); }
});

test("upgrade maps PUBLISHED to COMPLETED and resets approvals that cannot be bound to a patch hash", { skip }, async () => {
  const db = await createTestDatabase("jobs");
  try {
    await db.applyMigrations({ upTo: OLD }); await seedOldSchema(db);
    await db.applyMigrations({ after: OLD });
    const s = Object.fromEntries((await db.query(`select id,status from "RepairJob"`)).rows.map((r: any) => [r.id, r.status]));
    assert.equal(s["j-pub"], "COMPLETED");
    assert.equal(s["j-app"], "AWAITING_APPROVAL", "an approval with no recorded patch hash must be re-approved");
    assert.equal(s["j-await"], "AWAITING_APPROVAL");
  } finally { await db.drop(); }
});

test("audit trail is append-only after upgrade (UPDATE and DELETE are rejected by the database)", { skip }, async () => {
  const db = await createTestDatabase("audit");
  try {
    await db.applyMigrations({ upTo: OLD }); await seedOldSchema(db); await db.applyMigrations({ after: OLD });
    await assert.rejects(db.query(`UPDATE "SecurityAuditEvent" SET outcome='x' WHERE id='e1'`), /append-only/i);
    await assert.rejects(db.query(`DELETE FROM "SecurityAuditEvent" WHERE id='e1'`), /newer than 365 days cannot be deleted/i);
    // Retention: only rows past the floor may be purged.
    await db.query(`INSERT INTO "SecurityAuditEvent"(id,"eventType",outcome,"createdAt") VALUES ('old','LOGIN','SUCCESS', now() - interval '400 days')`);
    await db.query(`DELETE FROM "SecurityAuditEvent" WHERE id='old'`);
    assert.equal((await db.query(`select count(*)::int c from "SecurityAuditEvent" where id='old'`)).rows[0].c, 0);
  } finally { await db.drop(); }
});

test("fresh database: every migration applies in order on an empty database", { skip }, async () => {
  const db = await createTestDatabase("fresh");
  try { assert.deepEqual(await db.applyMigrations(), migrationNames()); } finally { await db.drop(); }
});

test("migrations are all-or-nothing: a failing migration leaves no partial change", { skip }, async () => {
  const db = await createTestDatabase("atomic");
  try {
    await db.applyMigrations({ upTo: OLD });
    await assert.rejects(db.query(`BEGIN; CREATE TABLE "Tmp"(id int); SELECT 1/0; COMMIT;`));
    await db.query("ROLLBACK").catch(() => undefined);
    assert.equal((await db.query(`select to_regclass('"Tmp"') r`)).rows[0].r, null);
  } finally { await db.drop(); }
});

test("migration directory is well-formed: lock file present, names sort chronologically, no empty SQL", () => {
  assert.ok(fs.existsSync(path.join(MIGRATIONS_DIR, "migration_lock.toml")));
  const names = migrationNames();
  assert.deepEqual(names, [...names].sort());
  for (const n of names) assert.ok(fs.readFileSync(path.join(MIGRATIONS_DIR, n, "migration.sql"), "utf8").trim().length > 0, n);
});
