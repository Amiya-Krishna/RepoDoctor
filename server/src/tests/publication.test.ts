import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createTestDatabase, integrationSkipReason, useDatabase, type TestDatabase } from "./db.js";
import { mockRes } from "./helpers.js";

/**
 * Integration evidence for the publication state machine: REAL PostgreSQL, REAL git (a local bare
 * repository stands in for github.com via GITHUB_GIT_BASE_URL) and a LOCAL FAKE of the few GitHub REST
 * endpoints used (GITHUB_API_URL). This is not github.com; the sandbox step is a stub (no Docker here).
 */
const skip = integrationSkipReason({ postgres: true, redis: true });

process.env.GITHUB_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.REDIS_HOST = "127.0.0.1";
process.env.REDIS_PORT = "6380";
process.env.REDIS_PASSWORD = "testpass";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-pub-"));
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();

interface Fake { server: http.Server; url: string; prs: any[]; canPush: boolean; failCreate: number; creates: number }
let fake: Fake;
let db: TestDatabase;
let prisma: typeof import("../config/prisma.js").prisma;
let pub: typeof import("../services/publish-approved.service.js");
let pubLib: typeof import("../repair/publication.js");
let hash: typeof import("../repair/patch-hash.js");
let controller: typeof import("../controllers/repair.controller.js");
let queues: typeof import("../queue/repair.queue.js");
let recovery: typeof import("../services/repair-recovery.service.js");
let seq = 0;

function startFake(): Promise<Fake> {
  const f: Fake = { server: undefined as never, url: "", prs: [], canPush: true, failCreate: 0, creates: 0 };
  f.server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    const send = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(\/pulls)?$/);
      if (!m) return send(404, { message: "nf" });
      if (!m[3]) return send(200, { permissions: { push: f.canPush }, default_branch: "main" });
      if (req.method === "GET") {
        const head = url.searchParams.get("head") ?? "";
        return send(200, f.prs.filter((p) => `${m[1]}:${p.headRef}` === head).map((p) => ({ number: p.number, html_url: p.url, state: p.state, merged_at: p.merged ? "x" : null })));
      }
      const body = JSON.parse(data);
      f.creates++;
      if (f.failCreate > 0) { f.failCreate--; return send(500, { message: "boom" }); }
      if (f.prs.some((p) => p.headRef === body.head && p.state === "open")) return send(422, { message: "A pull request already exists" });
      const n = f.prs.length + 1;
      const pr = { number: n, url: `https://github.test/${m[1]}/${m[2]}/pull/${n}`, headRef: body.head, state: "open", merged: false };
      f.prs.push(pr);
      send(201, { number: n, html_url: pr.url, title: body.title, state: "open", head: { ref: body.head }, base: { ref: body.base } });
    });
  });
  return new Promise((resolve) => f.server.listen(0, "127.0.0.1", () => { f.url = `http://127.0.0.1:${(f.server.address() as any).port}`; resolve(f); }));
}

test.before(async () => {
  if (skip) return;
  fake = await startFake();
  process.env.GITHUB_API_URL = fake.url;
  process.env.GITHUB_GIT_BASE_URL = `file://${root}/remotes`;
  db = await createTestDatabase("publish");
  await db.applyMigrations();
  useDatabase(db);
  ({ prisma } = await import("../config/prisma.js"));
  pub = await import("../services/publish-approved.service.js");
  pubLib = await import("../repair/publication.js");
  hash = await import("../repair/patch-hash.js");
  controller = await import("../controllers/repair.controller.js");
  queues = await import("../queue/repair.queue.js");
  recovery = await import("../services/repair-recovery.service.js");
});
test.after(async () => {
  if (skip) return;
  fake.server.close();
  await Promise.race([Promise.all([queues.closeRepairQueue(), queues.closePublishQueue(), (await import("../queue/scan.queue.js")).closeScanQueue()]).catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
  await prisma.$disconnect();
  await db.drop();
  fs.rmSync(root, { recursive: true, force: true });
});

const CHANGE = { filePath: "src/a.js", changeType: "REPLACE", startLine: 2, endLine: 2, originalCode: "  return a - b;", replacementCode: "  return a + b;", explanation: "fix" };

interface World { n: number; owner: string; repo: string; jobId: string; userId: string; repoId: string; remote: string; work: string; effects: { audits: any[]; notes: any[] } }

/** Seeds Postgres + a bare remote with main; the job is AWAITING_APPROVAL with binding recorded, like the repair worker leaves it. */
async function seed(opts: { approve?: boolean } = {}): Promise<World> {
  const n = ++seq;
  const owner = `o${n}`, repo = `r${n}`, userId = `u${n}`, repoId = `repo${n}`;
  const remote = path.join(root, "remotes", owner, `${repo}.git`);
  fs.mkdirSync(remote, { recursive: true });
  git(remote, "init", "--bare", "--initial-branch=main");
  const work = path.join(root, `work${n}`);
  git(root, "clone", remote, work);
  fs.mkdirSync(path.join(work, "src"));
  fs.writeFileSync(path.join(work, "src/a.js"), "function add(a, b) {\n  return a - b;\n}\nmodule.exports = add;\n");
  fs.writeFileSync(path.join(work, "check.js"), "const add = require('./src/a.js');\nif (add(1, 2) !== 3) { console.error('add(1,2) !== 3'); process.exit(1); }\nconsole.log('ok');\n");
  fs.writeFileSync(path.join(work, "src/other.js"), "module.exports = 1;\n");
  git(work, "add", "."); git(work, "commit", "-m", "init"); git(work, "branch", "-M", "main"); git(work, "push", "origin", "main");
  const baseSha = git(work, "rev-parse", "HEAD");

  const { protectToken } = await import("../security/token-encryption.js");
  await prisma.user.create({ data: { id: userId, name: "n", email: `${userId}@x.test`, password: "x", githubAccessToken: protectToken("gho_faketoken") } });
  await prisma.repository.create({ data: { id: repoId, githubId: String(n), name: repo, fullName: `${owner}/${repo}`, ownerLogin: owner, defaultBranch: "main", htmlUrl: "h", cloneUrl: `https://github.com/${owner}/${repo}.git`, userId } });
  const analysis = await prisma.analysis.create({ data: { repositoryId: repoId, status: "COMPLETED", sourceRef: "main" } });
  const proposal = await prisma.fixProposal.create({ data: { analysisId: analysis.id, findingId: "f1", source: "BUG", title: "Fix add", summary: "s", risk: "LOW", confidence: 0.9, reasoning: "r", changes: [CHANGE] } });
  const ver = await prisma.verificationResult.create({ data: { analysisId: analysis.id, findingId: "f1", fixProposalId: proposal.id, status: "VERIFIED", title: "t", summary: "s", confidence: 0.9, evidence: ["e"], reasoning: "r", testPassed: true, regressionDetected: false } });
  const patchHash = hash.computePatchHash([CHANGE as never], repoId);
  const job = await prisma.repairJob.create({
    data: {
      analysisId: analysis.id, findingId: "f1", status: opts.approve === false ? "AWAITING_APPROVAL" : "APPROVED", fixProposalId: proposal.id, verificationResultId: ver.id,
      testCommand: ["npm", "test"], patchHash, baseCommitSha: baseSha, preImageHashes: await hash.computePreImageHashes(work, [CHANGE as never]),
      ...(opts.approve === false ? {} : { approvedPatchHash: patchHash, approvedBaseCommitSha: baseSha, approvedAt: new Date(), approvedBy: userId }),
    },
  });
  return { n, owner, repo, jobId: job.id, userId, repoId, remote, work, effects: { audits: [], notes: [] } };
}

const deps = (w: World, over: Partial<import("../repair/publication.js").PublicationDeps> = {}, tests = { success: true, exitCode: 0 as number | null, timedOut: false }) => ({
  ...pub.defaultPublicationDeps(),
  sandbox: { runTests: async () => tests },
  effects: () => ({ audit: async (e: any) => { w.effects.audits.push(e); }, notify: async (n: any) => { w.effects.notes.push(n); } }),
  ...over,
});
const crashing = (point: string) => ({ crashAt: (p: string) => { if (p === point) throw new pubLib.SimulatedCrash(p as never); } });
const later = () => new Date(Date.now() + 30 * 60_000); // after any lease
const branches = (w: World) => git(w.remote, "for-each-ref", "--format=%(refname:short)", "refs/heads/").split("\n").filter((b) => b.startsWith("repodoctor/"));
const prsFor = (w: World) => fake.prs.filter((p) => p.url.includes(`/${w.owner}/${w.repo}/`));
const job = (w: World) => prisma.repairJob.findUniqueOrThrow({ where: { id: w.jobId } });
const run = (w: World, d = deps(w)) => pub.publishApprovedRepair({ repairJobId: w.jobId, userId: w.userId }, d);

test("happy path: one branch, one PR, COMPLETED, PullRequest row saved, notification states the PR", { skip }, async () => {
  const w = await seed();
  const out = await run(w);
  assert.equal(out.status, "PUBLISHED");
  assert.equal(branches(w).length, 1);
  assert.equal(prsFor(w).length, 1);
  const j = await job(w);
  assert.equal(j.status, "COMPLETED");
  assert.equal(j.pullRequestNumber, prsFor(w)[0].number);
  assert.equal(await prisma.pullRequest.count({ where: { analysisId: j.analysisId } }), 1);
  assert.match(w.effects.notes.at(-1).message, /pull request #/i);
  assert.equal(git(w.remote, "show", `${branches(w)[0]}:src/a.js`).includes("a + b"), true);
});

const POINTS = ["after-claim", "after-patch", "after-tests", "after-push-before-persist", "after-branch-persisted", "after-pr-created-before-persist", "after-pr-persisted"];
for (const point of POINTS) {
  test(`crash at ${point} then recovery: exactly one branch and one PR`, { skip }, async () => {
    const w = await seed();
    await assert.rejects(() => run(w, deps(w, crashing(point))), pubLib.SimulatedCrash);
    assert.ok(branches(w).length <= 1 && prsFor(w).length <= 1);
    // The lease still protects the crashed worker's claim from a concurrent duplicate...
    const early = await run(w, deps(w, { now: () => new Date(Date.now() + 1000) }));
    assert.equal(early.status, "SKIPPED", "a live lease is respected");
    // ...and after it expires the retry finishes the job without duplicating anything.
    const out = await run(w, deps(w, { now: later }));
    assert.ok(["PUBLISHED", "ALREADY_PUBLISHED"].includes(out.status), JSON.stringify(out));
    assert.equal(branches(w).length, 1);
    assert.equal(prsFor(w).length, 1);
    assert.equal((await job(w)).status, "COMPLETED");
    assert.equal(await prisma.pullRequest.count({ where: { analysisId: (await job(w)).analysisId } }), 1);
  });
}

test("existing remote branch with identical content is reused (no second push, one PR)", { skip }, async () => {
  const w = await seed();
  await assert.rejects(() => run(w, deps(w, crashing("after-push-before-persist"))), pubLib.SimulatedCrash);
  const tip = git(w.remote, "rev-parse", branches(w)[0]);
  await run(w, deps(w, { now: later }));
  assert.equal(git(w.remote, "rev-parse", branches(w)[0]), tip, "tip unchanged: not force-pushed or re-created");
  assert.equal((await job(w)).headCommitSha, tip);
});

test("existing remote branch with DIFFERENT content blocks publication; never overwritten", { skip }, async () => {
  const w = await seed();
  const name = pubLib.repairBranchName(hash.computePatchHash([CHANGE as never], w.repoId));
  git(w.work, "checkout", "-b", name); fs.writeFileSync(path.join(w.work, "src/other.js"), "module.exports = 2;\n"); git(w.work, "commit", "-am", "someone else"); git(w.work, "push", "origin", name);
  const tip = git(w.remote, "rev-parse", name);
  const out = await run(w);
  assert.equal(out.status, "BLOCKED");
  assert.equal(git(w.remote, "rev-parse", name), tip);
  assert.equal(prsFor(w).length, 0);
  assert.equal((await job(w)).status, "PUBLISH_BLOCKED");
  assert.match(w.effects.notes.at(-1).message, /already exists on GitHub/);
});

test("existing open PR for the branch is reused, never duplicated", { skip }, async () => {
  const w = await seed();
  await assert.rejects(() => run(w, deps(w, crashing("after-pr-created-before-persist"))), pubLib.SimulatedCrash);
  const createsBefore = fake.creates;
  const out = await run(w, deps(w, { now: later }));
  assert.equal(out.status, "PUBLISHED");
  assert.equal(fake.creates, createsBefore, "no second create call");
  assert.equal(prsFor(w).length, 1);
});

test("a closed or merged PR is reported as such and no new PR is created", { skip }, async () => {
  const w = await seed();
  await assert.rejects(() => run(w, deps(w, crashing("after-pr-created-before-persist"))), pubLib.SimulatedCrash);
  prsFor(w)[0].state = "closed"; prsFor(w)[0].merged = true;
  await run(w, deps(w, { now: later }));
  assert.equal(prsFor(w).length, 1);
  assert.match(w.effects.notes.at(-1).message, /merged/);
  assert.equal((await prisma.pullRequest.findFirstOrThrow({ where: { analysisId: (await job(w)).analysisId } })).status, "MERGED");
});

test("GitHub 5xx after the branch was pushed: retryable, message says the branch exists, retry completes with one PR", { skip }, async () => {
  const w = await seed();
  fake.failCreate = 1;
  const first = await run(w);
  assert.equal(first.status, "RETRYABLE");
  const j = await job(w);
  assert.equal(j.status, "PUBLISH_FAILED_RETRYABLE");
  assert.ok(j.headCommitSha);
  assert.match(w.effects.notes.at(-1).message, /already exists on GitHub/);
  assert.doesNotMatch(w.effects.notes.at(-1).message, /Nothing was pushed/);
  const out = await run(w, deps(w, { now: later }));
  assert.equal(out.status, "PUBLISHED");
  assert.equal(prsFor(w).length, 1);
  assert.equal(branches(w).length, 1);
});

test("failing tests block publication and say nothing was pushed", { skip }, async () => {
  const w = await seed();
  const out = await run(w, deps(w, {}, { success: false, exitCode: 1, timedOut: false }));
  assert.equal(out.status, "BLOCKED");
  assert.equal(branches(w).length, 0);
  assert.match(w.effects.notes.at(-1).message, /Nothing was pushed/);
});

test("sandbox infrastructure failure is retryable, not a verdict on the patch", { skip }, async () => {
  const w = await seed();
  const out = await run(w, deps(w, {}, { success: false, exitCode: null, timedOut: false }));
  assert.equal(out.status, "RETRYABLE");
  assert.equal(branches(w).length, 0);
});

test("approval revoked before publishing: nothing is pushed", { skip }, async () => {
  const w = await seed();
  const res = mockRes();
  await controller.revokeApproval({ user: { userId: w.userId }, params: { repairJobId: w.jobId } } as never, res as never);
  assert.equal(res.statusCode, 200);
  const out = await run(w);
  assert.equal(out.status, "SKIPPED");
  assert.equal(branches(w).length, 0);
});

test("approval revoked WHILE publishing: no branch is pushed after the revocation", { skip }, async () => {
  const w = await seed();
  const out = await run(w, deps(w, { crashAt: async (p) => {
    if (p === "after-patch") await controller.revokeApproval({ user: { userId: w.userId }, params: { repairJobId: w.jobId } } as never, mockRes() as never);
  } }));
  assert.equal(out.status, "SKIPPED");
  assert.equal(branches(w).length, 0);
  assert.equal((await job(w)).status, "APPROVAL_REVOKED");
});

test("duplicate approval requests: exactly one wins, the other gets 409", { skip }, async () => {
  const w = await seed({ approve: false });
  const j = await job(w);
  const call = () => { const res = mockRes(); return controller.approveRepair({ user: { userId: w.userId }, params: { repairJobId: w.jobId }, body: { patchHash: j.patchHash } } as never, res as never).then(() => res); };
  const [a, b] = await Promise.all([call(), call()]);
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [202, 409]);
  const after = await job(w);
  assert.equal(after.approvedPatchHash, j.patchHash);
  assert.equal(after.approvedBaseCommitSha, j.baseCommitSha);
});

test("approval with a wrong or missing patch hash is refused (PATCH_CHANGED); the patch edited after verification cannot be approved", { skip }, async () => {
  const w = await seed({ approve: false });
  const call = (body: unknown) => { const res = mockRes(); return controller.approveRepair({ user: { userId: w.userId }, params: { repairJobId: w.jobId }, body } as never, res as never).then(() => res); };
  assert.equal((await call({})).statusCode, 409);
  assert.equal(((await call({ patchHash: "0".repeat(64) })).body as any).code, "PATCH_CHANGED");
  const j = await job(w);
  await prisma.fixProposal.update({ where: { id: j.fixProposalId! }, data: { changes: [{ ...CHANGE, replacementCode: "  return 0; // tampered" }] } });
  assert.equal(((await call({ patchHash: j.patchHash })).body as any).code, "PATCH_CHANGED", "stale hash for a modified patch");
  assert.equal((await job(w)).status, "AWAITING_APPROVAL");
});

test("patch modified AFTER approval is never published: NEEDS_REAPPROVAL", { skip }, async () => {
  const w = await seed();
  const j = await job(w);
  await prisma.fixProposal.update({ where: { id: j.fixProposalId! }, data: { changes: [{ ...CHANGE, replacementCode: "  return 42;" }] } });
  const out = await run(w);
  assert.equal(out.status, "NEEDS_REAPPROVAL");
  assert.equal(branches(w).length, 0);
  assert.equal((await job(w)).status, "NEEDS_REAPPROVAL");
});

test("base commit changed in an unrelated file: revalidated and published; in a touched file: renewed approval required", { skip }, async () => {
  const unrelated = await seed();
  fs.writeFileSync(path.join(unrelated.work, "src/other.js"), "module.exports = 3;\n"); git(unrelated.work, "commit", "-am", "other"); git(unrelated.work, "push", "origin", "main");
  assert.equal((await run(unrelated)).status, "PUBLISHED");

  const touched = await seed();
  fs.writeFileSync(path.join(touched.work, "src/a.js"), "function add(a, b) {\n  return a * b;\n}\n"); git(touched.work, "commit", "-am", "conflicting"); git(touched.work, "push", "origin", "main");
  const out = await run(touched);
  assert.equal(out.status, "NEEDS_REAPPROVAL");
  assert.equal(branches(touched).length, 0);
});

test("unauthorized user cannot publish or approve another user's repair", { skip }, async () => {
  const w = await seed();
  const other = await seed();
  await assert.rejects(() => pub.publishApprovedRepair({ repairJobId: w.jobId, userId: other.userId }, deps(w)), /not found/);
  assert.ok(w.effects.audits.some((a) => a.eventType === "AUTHZ_DENIED"));
  assert.equal(branches(w).length, 0);
  const res = mockRes();
  await controller.approveRepair({ user: { userId: other.userId }, params: { repairJobId: w.jobId }, body: {} } as never, res as never);
  assert.equal(res.statusCode, 404);
});

test("repository authorization lost since approval (no push access) blocks publication", { skip }, async () => {
  const w = await seed();
  fake.canPush = false;
  try { assert.equal((await run(w)).status, "BLOCKED"); } finally { fake.canPush = true; }
  assert.equal(branches(w).length, 0);
  assert.match(w.effects.notes.at(-1).message, /push access/);
});

test("recovery sweep re-queues stale publication stages with a new generation and blocks after too many attempts", { skip }, async () => {
  // The sweep is database-wide: park jobs left over from earlier tests so this test observes only its own.
  await prisma.repairJob.updateMany({ where: { status: { in: ["APPROVED", "RUNNING", "REVALIDATING", "TESTING", "BRANCH_PUSHED", "PR_CREATED", "PUBLISH_FAILED_RETRYABLE"] } }, data: { status: "CANCELLED" } });
  const w = await seed();
  await assert.rejects(() => run(w, deps(w, crashing("after-branch-persisted"))), pubLib.SimulatedCrash);
  const queued: [unknown, number | undefined][] = [];
  const r = await recovery.recoverStaleRepairJobs(async (d, g) => { queued.push([d, g]); }, later());
  assert.equal(r.requeued, 1);
  assert.equal(queued[0][1], 1, "generation = attempts so far, so the job id is new");
  await prisma.repairJob.update({ where: { id: w.jobId }, data: { publishAttempts: 5 } });
  const r2 = await recovery.recoverStaleRepairJobs(async () => undefined, later());
  assert.equal(r2.blocked, 1);
  assert.equal((await job(w)).status, "PUBLISH_BLOCKED");
});

// ---------------------------------------------------------------------------------------------------------------------
// REAL sandbox: the default dependencies (real `docker run` via buildSandboxRunArgs) instead of the stub.
// ---------------------------------------------------------------------------------------------------------------------
import { spawnSync } from "node:child_process";
const dockerUp = spawnSync("docker", ["image", "inspect", "node:22-bookworm-slim"], { encoding: "utf8" }).status === 0;
const dockerSkip = skip || (dockerUp ? false : "Docker daemon or node:22-bookworm-slim image unavailable");
if (!dockerUp && process.env.REQUIRE_DOCKER_TESTS === "true") test("docker required for real-sandbox publication", () => assert.fail("REQUIRE_DOCKER_TESTS=true but Docker/image unavailable"));
const realDeps = (w: World) => ({ ...pub.defaultPublicationDeps(), effects: () => ({ audit: async (e: any) => { w.effects.audits.push(e); }, notify: async (n: any) => { w.effects.notes.push(n); } }) });
const setCheck = (w: World) => prisma.repairJob.update({ where: { id: w.jobId }, data: { testCommand: ["node", "check.js"] } });

test("REAL SANDBOX: the patch is re-tested in a real container (fails before, passes after) and only then pushed", { skip: dockerSkip }, async () => {
  process.env.REPAIR_INSTALL_DEPENDENCIES = "false";
  const w = await seed(); await setCheck(w);
  const out = await run(w, realDeps(w));
  assert.equal(out.status, "PUBLISHED", JSON.stringify(out) + JSON.stringify(w.effects.notes.at(-1)));
  assert.equal(branches(w).length, 1); assert.equal(prsFor(w).length, 1);
  assert.equal(spawnSync("docker", ["ps", "-aq", "--filter", "label=repodoctor.sandbox"], { encoding: "utf8" }).stdout.trim(), "", "no sandbox container left behind");
});

test("REAL SANDBOX: a patch whose tests still fail in the container is NOT pushed", { skip: dockerSkip }, async () => {
  process.env.REPAIR_INSTALL_DEPENDENCIES = "false";
  const w = await seed(); await setCheck(w);
  // Same patch location, but the replacement leaves the bug in place (it is still approved and hash-bound).
  const bad = { ...CHANGE, replacementCode: "  return a * b;" };
  const proposal = await prisma.fixProposal.findFirstOrThrow({ where: { id: (await job(w)).fixProposalId! } });
  const newHash = hash.computePatchHash([bad as never], w.repoId);
  await prisma.fixProposal.update({ where: { id: proposal.id }, data: { changes: [bad] } });
  await prisma.repairJob.update({ where: { id: w.jobId }, data: { patchHash: newHash, approvedPatchHash: newHash } });
  const out = await run(w, realDeps(w));
  assert.equal(out.status, "BLOCKED");
  assert.equal(branches(w).length, 0); assert.equal(prsFor(w).length, 0);
  assert.match(w.effects.notes.at(-1).message, /Nothing was pushed/);
});
