import test from "node:test";
import assert from "node:assert/strict";
import { enforceExecutionEvidence } from "../services/verification-gate.js";
import { decideApproval, decidePublication, decideRepairRequest, publishQueueJobId, repairQueueJobId } from "../repair/repair-guard.js";
import { DAY_MS, classifyStaleRepairJob, isScanDue, retentionCutoff, scheduledScanJobId } from "../services/maintenance.js";
import { sanitizeDetails, recordAudit, setAuditSink } from "../audit/audit.service.js";
import { buildRepairPullRequestBody } from "../github/github.pr-body.js";
import type { VerificationResult } from "../agents/verification.types.js";
import type { DockerTestResult } from "../execution/docker.types.js";
import { fake } from "./helpers.js";

const verified: VerificationResult = { status: "VERIFIED", title: "t", summary: "s", confidence: 0.95, evidence: ["e"], reasoning: "r", testPassed: true, regressionDetected: false };
const run = (o: Partial<DockerTestResult>): DockerTestResult => ({ success: true, exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false, ...o });

test("a model saying VERIFIED cannot override a failing test run", () => {
  const r = enforceExecutionEvidence(verified, run({ success: false, exitCode: 1 }));
  assert.equal(r.status, "FAILED");
  assert.equal(r.testPassed, false);
});

test("timeouts and missing exit codes are INCONCLUSIVE, never VERIFIED", () => {
  assert.equal(enforceExecutionEvidence(verified, run({ success: false, exitCode: null, timedOut: true })).status, "INCONCLUSIVE");
  assert.equal(enforceExecutionEvidence(verified, run({ success: false, exitCode: null })).status, "INCONCLUSIVE");
});

test("only exit code 0 without timeout stays VERIFIED; other verdicts are never upgraded", () => {
  assert.equal(enforceExecutionEvidence(verified, run({})).status, "VERIFIED");
  assert.equal(enforceExecutionEvidence({ ...verified, status: "FAILED" }, run({})).status, "FAILED");
  assert.equal(enforceExecutionEvidence({ ...verified, status: "INCONCLUSIVE" }, run({})).status, "INCONCLUSIVE");
});

test("pre-publication gate: the stored verdict alone never authorises a pull request", () => {
  assert.equal(decidePublication(verified, { success: true, exitCode: 0, timedOut: false }).ok, true);
  for (const rerun of [{ success: false, exitCode: 1, timedOut: false }, { success: false, exitCode: null, timedOut: true }, { success: true, exitCode: 0, timedOut: true }, { success: false, exitCode: null, timedOut: false }]) {
    assert.equal(decidePublication(verified, rerun).ok, false, JSON.stringify(rerun));
  }
  for (const status of ["FAILED", "INCONCLUSIVE", "ERROR"] as const) {
    assert.equal(decidePublication({ ...verified, status }, { success: true, exitCode: 0, timedOut: false }).ok, false, status);
  }
  assert.equal(decidePublication({ ...verified, regressionDetected: true }, { success: true, exitCode: 0, timedOut: false }).ok, false);
});

test("pull request body states evidence and that nothing is auto-merged", () => {
  const body = buildRepairPullRequestBody(verified, "Bug");
  assert.match(body, /No automatic merge/);
});

// ---- approvals / unauthorised PR creation
const job = { status: "AWAITING_APPROVAL", verificationResultId: "v1", fixProposalId: "p1" };

test("only the repository owner can approve; other users and unknown ids get the same 404", () => {
  assert.deepEqual(decideApproval({ actorId: "u1", repositoryOwnerId: "u1", job }), { ok: true });
  const other = decideApproval({ actorId: "attacker", repositoryOwnerId: "u1", job });
  const missing = decideApproval({ actorId: "attacker", repositoryOwnerId: null, job: null });
  assert.deepEqual(other, missing);
  assert.equal(!other.ok && other.status, 404);
});

test("approval requires AWAITING_APPROVAL and stored evidence", () => {
  for (const status of ["RUNNING", "FAILED", "INCONCLUSIVE", "APPROVED", "PUBLISHED", "REJECTED", "INTERRUPTED"]) {
    const d = decideApproval({ actorId: "u1", repositoryOwnerId: "u1", job: { ...job, status } });
    assert.equal(d.ok, false, status);
  }
  assert.equal(decideApproval({ actorId: "u1", repositoryOwnerId: "u1", job: { ...job, verificationResultId: null } }).ok, false);
});

// ---- duplicates
test("duplicate repair requests and duplicate pull requests are refused", () => {
  assert.deepEqual(decideRepairRequest({}), { ok: true });
  const active = decideRepairRequest({ activeJob: { id: "j1", status: "AWAITING_APPROVAL" } });
  assert.equal(!active.ok && active.code, "REPAIR_ALREADY_ACTIVE");
  const pr = decideRepairRequest({ activeJob: { id: "j1", status: "RUNNING" }, existingPullRequest: { url: "https://github.com/o/r/pull/1" } });
  assert.equal(!pr.ok && pr.code, "PULL_REQUEST_EXISTS");
});

test("queue job ids are deterministic so concurrent duplicates collapse", () => {
  assert.equal(repairQueueJobId("a", "f", 0), repairQueueJobId("a", "f", 0));
  assert.notEqual(repairQueueJobId("a", "f", 0), repairQueueJobId("a", "f", 1));
  assert.equal(publishQueueJobId("j"), publishQueueJobId("j"));
});

test("scheduled scans: one job per repository per interval, only when due", () => {
  const now = new Date("2026-11-01T10:00:00Z");
  const interval = DAY_MS;
  assert.equal(scheduledScanJobId("r", now, interval), scheduledScanJobId("r", new Date(now.getTime() + 3600_000), interval));
  assert.equal(isScanDue({ autoScan: false, lastScheduledScanAt: null }, now, interval), false);
  assert.equal(isScanDue({ autoScan: true, lastScheduledScanAt: null }, now, interval), true);
  assert.equal(isScanDue({ autoScan: true, lastScheduledScanAt: new Date(now.getTime() - 3600_000) }, now, interval), false);
  assert.equal(isScanDue({ autoScan: true, lastScheduledScanAt: new Date(now.getTime() - interval) }, now, interval), true);
});

// ---- worker crash / recovery
test("stale-job classification after a worker crash", () => {
  const t = { runningMs: 45 * 60_000, approvedMs: 120_000 };
  assert.equal(classifyStaleRepairJob("RUNNING", 10 * 60_000, t), "NONE", "a healthy long job is left alone");
  assert.equal(classifyStaleRepairJob("RUNNING", 60 * 60_000, t), "MARK_INTERRUPTED");
  // Publication stages are RESUMED (bounded), never abandoned: the state machine re-derives its position.
  for (const stage of ["REVALIDATING", "TESTING", "BRANCH_PUSHED", "PR_CREATED", "PUBLISH_FAILED_RETRYABLE"]) {
    assert.equal(classifyStaleRepairJob(stage, 60_000, t, 1), "REQUEUE_PUBLISH", stage);
    assert.equal(classifyStaleRepairJob(stage, 60_000, t, 5), "BLOCK_PUBLISH_EXHAUSTED", stage);
  }
  assert.equal(classifyStaleRepairJob("APPROVED", 5 * 60_000, t), "REQUEUE_PUBLISH");
  assert.equal(classifyStaleRepairJob("APPROVED", 30_000, t), "NONE");
  for (const s of ["AWAITING_APPROVAL", "VERIFIED", "COMPLETED", "PUBLISHED", "FAILED", "PUBLISH_BLOCKED", "NEEDS_REAPPROVAL", "APPROVAL_REVOKED"]) assert.equal(classifyStaleRepairJob(s, 1e12, t), "NONE", s);
});

test("retention cutoff", () => {
  assert.equal(retentionCutoff(new Date("2026-11-30T00:00:00Z"), 30).toISOString(), "2026-10-31T00:00:00.000Z");
});

// ---- audit log hygiene
test("audit details are scrubbed of secrets and bounded", () => {
  const t = fake.githubToken();
  const d = sanitizeDetails({ note: `token ${t}`, big: "x".repeat(20000) });
  assert.ok(!JSON.stringify(d).includes(t));
  assert.ok(JSON.stringify(d).length <= 8200);
});

test("audit: failClosed rethrows, otherwise a storage failure does not break the request", async () => {
  setAuditSink({ async write() { throw new Error("down"); } });
  await assert.doesNotReject(() => recordAudit({ eventType: "WEBHOOK_ACCEPTED", outcome: "SUCCESS" }));
  await assert.rejects(() => recordAudit({ eventType: "PR_APPROVED", outcome: "SUCCESS" }, { failClosed: true }));
});
