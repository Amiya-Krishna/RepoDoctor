import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDatabase, integrationSkipReason, migrationNames, MIGRATIONS_DIR } from "./db.js";

/**
 * Real PostgreSQL. Migration IMMUTABILITY and the four install paths:
 *   fresh · upgrade (no duplicates) · upgrade (duplicates, with the pre-deploy script) · already-applied (original text)
 *   · already-applied (the EDITED variant that circulated in an earlier remediation build).
 */
const skip = integrationSkipReason({ postgres: true });
const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.resolve(here, "../..");
const OLD = "20261010190000_repository_memory_chunks";
const HARDENING = "20261031000000_privacy_security_hardening";
const RELIABILITY = "20261101000000_reliability_hardening";
const CORRECTIVE = "20261102000000_pull_request_duplicate_archive";
const preScript = fs.readFileSync(path.join(server, "scripts/pre-migrate-archive-duplicate-pull-requests.sql"), "utf8");
const editedVariant = fs.readFileSync(path.resolve(server, "../docs/migration-variants/20261031_privacy_security_hardening.EDITED-VARIANT.sql"), "utf8");
type DB = Awaited<ReturnType<typeof createTestDatabase>>;
const sha = (t: string | Buffer) => createHash("sha256").update(t).digest("hex");
const sql = (n: string) => fs.readFileSync(path.join(MIGRATIONS_DIR, n, "migration.sql"), "utf8");

async function seed(db: DB, duplicates: boolean) {
  await db.query(`INSERT INTO "users"(id,name,email,password,"githubAccessToken","updatedAt") VALUES ('u1','A','a@x.test','x','gho_plaintext_legacy',now()),('u2','B','b@x.test','x',NULL,now())`);
  await db.query(`INSERT INTO "Repository"(id,"githubId",name,"fullName","ownerLogin","defaultBranch","htmlUrl","cloneUrl","userId","updatedAt") VALUES ('r1','1','n','o/n','o','main','h','c','u1',now())`);
  await db.query(`INSERT INTO "Analysis"(id,"repositoryId","updatedAt") VALUES ('a1','r1',now()),('a2','r1',now())`);
  const pr = (id: string, a: string, f: string, n: number, at: string) =>
    db.query(`INSERT INTO "PullRequest"(id,"analysisId","findingId","fixProposalId","verificationResultId","repositoryOwner","repositoryName","branchName","baseBranch","commitSha","pullRequestNumber","pullRequestUrl",title,"createdAt") VALUES ($1,$2,$3,'fp','vr','o','n','b','main','c',$4::int,'https://x/'||$4::text,'t',$5)`, [id, a, f, n, at]);
  await pr("pr1", "a1", "f1", 1, "2026-10-01"); await pr("pr4", "a2", "f9", 4, "2026-10-04");
  if (duplicates) { await pr("pr2", "a1", "f1", 2, "2026-10-02"); await pr("pr3", "a1", "f1", 3, "2026-10-03"); }
  const job = (id: string, status: string) => db.query(`INSERT INTO "RepairJob"(id,"analysisId","findingId",status,"updatedAt") VALUES ($1,'a1',$2,$3,now())`, [id, id, status]);
  await job("j-pub", "PUBLISHED"); await job("j-app", "APPROVED"); await job("j-await", "AWAITING_APPROVAL");
  await db.query(`INSERT INTO "SecurityAuditEvent"(id,"eventType",outcome) VALUES ('e1','LOGIN','SUCCESS')`);
}
const apply = async (db: DB, name: string, text = sql(name)) => {
  const c = await db.query("BEGIN"); void c;
  try { await db.query(text); await db.query("COMMIT"); } catch (e) { await db.query("ROLLBACK").catch(() => undefined); throw e; }
};
const prCount = async (db: DB) => (await db.query(`select count(*)::int c from "PullRequest"`)).rows[0].c as number;

test("IMMUTABILITY: every migration shipped in the original release is byte-identical to its recorded sha256", () => {
  const manifest = fs.readFileSync(path.join(server, "prisma/SHIPPED_MIGRATIONS.sha256"), "utf8").trim().split("\n").map((l) => l.split(/\s+/) as [string, string]);
  assert.ok(manifest.length >= 17);
  for (const [hash, name] of manifest) assert.equal(sha(fs.readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"))), hash, `${name} was modified after it shipped; add a NEW corrective migration instead`);
});

test("IMMUTABILITY: the edited variant differs from the original, and the original is restored in prisma/migrations", () => {
  assert.notEqual(sha(editedVariant), sha(sql(HARDENING)));
  assert.doesNotMatch(sql(HARDENING), /PullRequestDuplicateArchive/, "the shipped migration must not contain the archive logic");
});

test("migration directory is well-formed: lock file, chronological names, no empty SQL, corrective migration is last", () => {
  assert.ok(fs.existsSync(path.join(MIGRATIONS_DIR, "migration_lock.toml")));
  const names = migrationNames();
  assert.deepEqual(names, [...names].sort());
  assert.equal(names.at(-1), CORRECTIVE);
  for (const n of names) assert.ok(sql(n).trim().length > 0, n);
});

test("PATH 1 fresh installation: every migration applies in order; archive table exists", { skip }, async () => {
  const db = await createTestDatabase("fresh");
  try {
    assert.deepEqual(await db.applyMigrations(), migrationNames());
    assert.equal((await db.query(`select to_regclass('"PullRequestDuplicateArchive"') r`)).rows[0].r, "\"PullRequestDuplicateArchive\"");
  } finally { await db.drop(); }
});

test("PATH 2 upgrade from the previous production schema, no duplicates: all new migrations apply, data preserved", { skip }, async () => {
  const db = await createTestDatabase("up2");
  try {
    await db.applyMigrations({ upTo: OLD }); await seed(db, false);
    assert.deepEqual(await db.applyMigrations({ after: OLD }), [HARDENING, RELIABILITY, CORRECTIVE]);
    assert.equal(await prCount(db), 2);
    const s = Object.fromEntries((await db.query(`select id,status from "RepairJob"`)).rows.map((r: any) => [r.id, r.status]));
    assert.deepEqual([s["j-pub"], s["j-app"], s["j-await"]], ["COMPLETED", "AWAITING_APPROVAL", "AWAITING_APPROVAL"]);
    assert.equal((await db.query(`select "githubAccessToken" t from "users" where id='u1'`)).rows[0].t, "gho_plaintext_legacy");
    assert.equal((await db.query(`select count(*)::int c from "PullRequestDuplicateArchive"`)).rows[0].c, 0);
  } finally { await db.drop(); }
});

test("PATH 3a duplicates WITHOUT the pre-deploy script: the ORIGINAL migration fails atomically and leaves the database untouched", { skip }, async () => {
  const db = await createTestDatabase("up3a");
  try {
    await db.applyMigrations({ upTo: OLD }); await seed(db, true);
    await assert.rejects(apply(db, HARDENING), /could not create unique index|duplicate key/);
    assert.equal(await prCount(db), 4, "no row lost");
    assert.equal((await db.query(`select to_regclass('"PullRequestDuplicateArchive"') r`)).rows[0].r, null, "nothing half-applied");
    assert.equal((await db.query(`select count(*)::int c from information_schema.columns where table_name='RepairJob' and column_name='patchHash'`)).rows[0].c, 0);
  } finally { await db.drop(); }
});

test("PATH 3b duplicates WITH the pre-deploy script: earliest kept, others archived, then every migration applies", { skip }, async () => {
  const db = await createTestDatabase("up3b");
  try {
    await db.applyMigrations({ upTo: OLD }); await seed(db, true);
    await db.query(preScript);
    await db.query(preScript); // idempotent
    assert.equal(await prCount(db), 2);
    assert.equal((await db.query(`select id from "PullRequest" where "analysisId"='a1' and "findingId"='f1'`)).rows[0].id, "pr1", "earliest kept");
    const archived = (await db.query(`select id,"keptPullRequestId" from "PullRequestDuplicateArchive" order by id`)).rows;
    assert.deepEqual(archived.map((a: any) => a.id), ["pr2", "pr3"]);
    assert.ok(archived.every((a: any) => a.keptPullRequestId === "pr1"));
    assert.deepEqual(await db.applyMigrations({ after: OLD }), [HARDENING, RELIABILITY, CORRECTIVE]);
    assert.equal(await prCount(db) + archived.length, 4, "every row is kept or archived");
    await assert.rejects(db.query(`INSERT INTO "PullRequest"(id,"analysisId","findingId","fixProposalId","verificationResultId","repositoryOwner","repositoryName","branchName","baseBranch","commitSha","pullRequestNumber","pullRequestUrl",title) VALUES ('dup','a2','f9','x','x','o','n','b','m','c',9,'u','t')`), /unique|duplicate/i);
  } finally { await db.drop(); }
});

test("PATH 4 EXISTING install that already applied the ORIGINAL 20261031: only the new migrations run; corrective one creates the archive", { skip }, async () => {
  const db = await createTestDatabase("up4");
  try {
    await db.applyMigrations({ upTo: HARDENING }); await seed(db, false);
    assert.equal((await db.query(`select to_regclass('"PullRequestDuplicateArchive"') r`)).rows[0].r, null);
    assert.deepEqual(await db.applyMigrations({ after: HARDENING }), [RELIABILITY, CORRECTIVE]);
    assert.equal((await db.query(`select to_regclass('"PullRequestDuplicateArchive"') r`)).rows[0].r, "\"PullRequestDuplicateArchive\"");
    assert.equal(await prCount(db), 2);
  } finally { await db.drop(); }
});

test("PATH 5 EXISTING install that applied the EDITED variant: the corrective migration is an idempotent no-op; archived rows survive", { skip }, async () => {
  const db = await createTestDatabase("up5");
  try {
    await db.applyMigrations({ upTo: OLD }); await seed(db, true);
    await apply(db, HARDENING, editedVariant); // what an install of the earlier remediation build ran
    assert.equal(await prCount(db), 2);
    const archivedBefore = (await db.query(`select count(*)::int c from "PullRequestDuplicateArchive"`)).rows[0].c;
    assert.equal(archivedBefore, 2);
    assert.deepEqual(await db.applyMigrations({ after: HARDENING }), [RELIABILITY, CORRECTIVE]);
    assert.equal((await db.query(`select count(*)::int c from "PullRequestDuplicateArchive"`)).rows[0].c, 2, "archive contents untouched");
  } finally { await db.drop(); }
});

test("audit trail is append-only after upgrade (UPDATE always rejected; DELETE only past the 365-day floor)", { skip }, async () => {
  const db = await createTestDatabase("audit");
  try {
    await db.applyMigrations({ upTo: OLD }); await seed(db, false); await db.applyMigrations({ after: OLD });
    await assert.rejects(db.query(`UPDATE "SecurityAuditEvent" SET outcome='x' WHERE id='e1'`), /append-only/i);
    await assert.rejects(db.query(`DELETE FROM "SecurityAuditEvent" WHERE id='e1'`), /newer than 365 days cannot be deleted/i);
    await db.query(`INSERT INTO "SecurityAuditEvent"(id,"eventType",outcome,"createdAt") VALUES ('old','LOGIN','SUCCESS', now() - interval '400 days')`);
    await db.query(`DELETE FROM "SecurityAuditEvent" WHERE id='old'`);
  } finally { await db.drop(); }
});

test("a failing migration leaves no partial change (all-or-nothing)", { skip }, async () => {
  const db = await createTestDatabase("atomic");
  try {
    await db.applyMigrations({ upTo: OLD });
    await assert.rejects(apply(db, "x", `CREATE TABLE "Tmp"(id int); SELECT 1/0;`));
    assert.equal((await db.query(`select to_regclass('"Tmp"') r`)).rows[0].r, null);
  } finally { await db.drop(); }
});
