/**
 * Crash-recoverable, idempotent publication of an approved repair.
 *
 *  APPROVED -> REVALIDATING -> TESTING -> BRANCH_PUSHED -> PR_CREATED -> COMPLETED
 *
 * Failure / recovery states: PUBLISH_FAILED_RETRYABLE (transient; resumed by recovery up to a bound),
 * PUBLISH_BLOCKED (permanent), NEEDS_REAPPROVAL (the approved context changed), APPROVAL_REVOKED.
 *
 * Every transition is a persisted compare-and-set. A retry never trusts a previous run's memory: it
 * re-derives where it is from the persisted facts (branch / commit / PR number) AND the remote truth
 * (ls-remote, the pulls API), so a crash at any instruction leaves at most one branch and one PR.
 * Nothing here merges, force-pushes or publishes a patch that differs from the approved hash.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FixChange, FixResult } from "../agents/fix.types.js";
import type { VerificationResult } from "../agents/verification.types.js";
import { computePatchHash, computePreImageHashes, preImagesMatch, type PreImageHashes } from "./patch-hash.js";
import { decidePublication } from "./repair-guard.js";
import { validateTestCommand } from "../security/test-command-policy.js";
import { GitHubApiError } from "../github/github.client.js";

const execFileAsync = promisify(execFile);

export const MAX_PUBLISH_ATTEMPTS = 5;
export const PUBLISH_LEASE_MS = 10 * 60_000;

export type PublicationStage = "REVALIDATING" | "TESTING" | "BRANCH_PUSHED" | "PR_CREATED";

export interface PublicationJob {
  id: string;
  status: string;
  analysisId: string;
  findingId: string;
  fixProposalId: string | null;
  verificationResultId: string | null;
  testCommand: unknown;
  workingDirectory: string | null;
  baseCommitSha: string | null;
  preImageHashes: PreImageHashes | null;
  approvedPatchHash: string | null;
  approvedBaseCommitSha: string | null;
  branchName: string | null;
  headCommitSha: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  publishAttempts: number;
}

export interface PublicationContext {
  job: PublicationJob;
  repository: { id: string; ownerLogin: string; name: string; defaultBranch: string; cloneUrl: string; userId: string };
  sourceRef: string | null;
  proposal: { title: string; summary: string; risk: string; confidence: number; reasoning: string; changes: FixChange[] } | null;
  verification: VerificationResult | null;
  token: string | null;
}

export interface PublicationStore {
  load(repairJobId: string): Promise<PublicationContext | null>;
  /** CAS claim. Returns the job as claimed (status REVALIDATING for a first run, unchanged when resuming) or null. */
  claim(repairJobId: string, now: Date, leaseMs: number): Promise<{ job: PublicationJob; resumed: boolean } | null>;
  /** CAS on status; also extends the lease. False means another actor changed it (revoked, re-claimed): stop. */
  transition(repairJobId: string, from: string, to: string, data?: Partial<{
    branchName: string; headCommitSha: string; pullRequestNumber: number; pullRequestUrl: string; errorMessage: string | null; publishLockedUntil: Date | null;
  }>, now?: Date): Promise<boolean>;
  /** Status check without changing anything (revocation check). */
  currentStatus(repairJobId: string): Promise<string | null>;
  /** Idempotent: creating the same (analysis, finding) twice is not an error. */
  savePullRequest(input: SavedPullRequest): Promise<void>;
}

export interface SavedPullRequest {
  analysisId: string; findingId: string; fixProposalId: string; verificationResultId: string;
  owner: string; repo: string; branchName: string; baseBranch: string; commitSha: string;
  pullRequestNumber: number; pullRequestUrl: string; title: string; status: string;
}

export interface GitOps {
  /** Fresh shallow clone of `ref` into a new temp dir; returns the directory and HEAD sha. */
  clone(cloneUrl: string, ref: string, token: string): Promise<{ dir: string; headSha: string }>;
  createBranch(dir: string, branch: string): Promise<void>;
  /** Stage exactly `files`, commit, return {sha, tree}. Throws if the commit touches anything else. */
  commit(dir: string, files: string[], message: string): Promise<{ sha: string; tree: string }>;
  /** Tip sha of refs/heads/<branch> on the remote, or null. */
  remoteBranchTip(dir: string, branch: string, token: string): Promise<string | null>;
  /** Tree sha of the remote branch tip (fetches it). */
  remoteBranchTree(dir: string, branch: string, token: string): Promise<string>;
  /** Plain push of the branch (never force). */
  push(dir: string, branch: string, token: string): Promise<void>;
  cleanup(dir: string): Promise<void>;
}

export interface GitHubOps {
  access(owner: string, repo: string, token: string): Promise<{ canPush: boolean }>;
  findPullRequest(owner: string, repo: string, branch: string, token: string): Promise<{ number: number; htmlUrl: string; state: "open" | "closed"; merged: boolean } | null>;
  createPullRequest(i: { owner: string; repo: string; head: string; base: string; title: string; body: string; token: string }): Promise<{ number: number; htmlUrl: string }>;
}

export interface SandboxResult { success: boolean; exitCode: number | null; timedOut: boolean; errorMessage?: string }
export interface SandboxOps {
  /** Applies nothing: runs install + the FULL configured test command against `dir`. */
  runTests(dir: string, workingDirectory: string | null, testCommand: string[]): Promise<SandboxResult>;
}

export interface PatchOps {
  /** Applies the approved patch (policy enforced inside) to `dir`. */
  apply(dir: string, fix: FixResult): Promise<void>;
}

export interface PublicationEffects {
  audit(event: { eventType: "PR_CREATED" | "PR_BLOCKED" | "AUTHZ_DENIED"; outcome: "SUCCESS" | "DENIED" | "FAILURE"; details?: Record<string, unknown> }): Promise<void>;
  notify(n: { type: "PR_CREATED" | "REPAIR_FAILED"; severity?: "INFO" | "WARNING"; title: string; message: string }): Promise<void>;
}

export interface PublicationDeps {
  store: PublicationStore;
  git: GitOps;
  github: GitHubOps;
  sandbox: SandboxOps;
  patch: PatchOps;
  effects: (ctx: { repairJobId: string; userId: string; repositoryId: string }) => PublicationEffects;
  now?: () => Date;
  leaseMs?: number;
  /** Test seam: throw SimulatedCrash at a named point to emulate the process dying there. */
  crashAt?: (point: CrashPoint) => void | Promise<void>;
}

export type CrashPoint =
  | "after-claim" | "after-revalidate" | "after-patch" | "after-tests"
  | "after-push-before-persist" | "after-branch-persisted"
  | "after-pr-created-before-persist" | "after-pr-persisted";

export class SimulatedCrash extends Error {
  constructor(readonly point: CrashPoint) { super(`simulated crash at ${point}`); this.name = "SimulatedCrash"; }
}

export type PublishOutcome =
  | { status: "PUBLISHED"; pullRequestUrl: string; pullRequestNumber: number }
  | { status: "ALREADY_PUBLISHED"; pullRequestUrl: string }
  | { status: "SKIPPED"; reason: string }
  | { status: "BLOCKED"; reason: string }
  | { status: "NEEDS_REAPPROVAL"; reason: string }
  | { status: "RETRYABLE"; reason: string };

class Stop extends Error {
  constructor(readonly outcome: PublishOutcome) { super(outcome.status); }
}

export const repairBranchName = (approvedPatchHash: string) => `repodoctor/fix-${approvedPatchHash.slice(0, 12)}`;

const fileSet = (changes: FixChange[]) => [...new Set(changes.map((c) => c.filePath))].sort();

export async function runPublication(input: { repairJobId: string; userId: string }, deps: PublicationDeps): Promise<PublishOutcome> {
  const now = deps.now ?? (() => new Date());
  const crash = async (p: CrashPoint) => { if (deps.crashAt) await deps.crashAt(p); };

  const ctx0 = await deps.store.load(input.repairJobId);
  if (!ctx0 || ctx0.repository.userId !== input.userId) {
    await deps.effects({ repairJobId: input.repairJobId, userId: input.userId, repositoryId: ctx0?.repository.id ?? "" })
      .audit({ eventType: "AUTHZ_DENIED", outcome: "DENIED", details: { action: "publish" } });
    throw new Error("Repair not found for this account");
  }
  const fx = deps.effects({ repairJobId: ctx0.job.id, userId: input.userId, repositoryId: ctx0.repository.id });

  if (ctx0.job.status === "COMPLETED" || ctx0.job.status === "PUBLISHED") {
    return ctx0.job.pullRequestUrl
      ? { status: "ALREADY_PUBLISHED", pullRequestUrl: ctx0.job.pullRequestUrl }
      : { status: "SKIPPED", reason: "Already completed." };
  }

  const claimed = await deps.store.claim(input.repairJobId, now(), deps.leaseMs ?? PUBLISH_LEASE_MS);
  if (!claimed) return { status: "SKIPPED", reason: `Repair is ${ctx0.job.status}; it is not waiting to be published, or another worker holds it.` };

  let workDir: string | undefined;
  // `stage` is the status we currently hold; transitions move it forward with a CAS.
  let stage: string = claimed.job.status;
  const move = async (to: PublicationStage, data?: Parameters<PublicationStore["transition"]>[3]) => {
    if (!(await deps.store.transition(input.repairJobId, stage, to, data, now()))) {
      const current = await deps.store.currentStatus(input.repairJobId);
      throw new Stop({ status: "SKIPPED", reason: `Publication stopped: the repair is now ${current ?? "unknown"} (for example approval was revoked).` });
    }
    stage = to;
  };

  try {
    await crash("after-claim");
    const ctx = (await deps.store.load(input.repairJobId))!; // fresh facts after the claim
    const job = ctx.job;
    const repo = ctx.repository;

    // ---- Revalidation: authorization, approval binding, evidence -------------------------------------
    if (!ctx.token) throw new Stop(await block(deps, input, job, "GitHub connection is missing or expired. Reconnect GitHub and approve again.", true));
    const access = await deps.github.access(repo.ownerLogin, repo.name, ctx.token).catch((e) => {
      if (e instanceof GitHubApiError && (e.status === 401 || e.status === 403 || e.status === 404)) return { canPush: false };
      throw e;
    });
    if (!access.canPush) throw new Stop(await block(deps, input, job, "Your GitHub account no longer has push access to this repository.", true));

    if (!ctx.proposal || !ctx.verification || !job.fixProposalId || !job.verificationResultId) {
      throw new Stop(await block(deps, input, job, "The stored patch or verification record is missing.", true));
    }
    if (!job.approvedPatchHash) throw new Stop(await reapprove(deps, input, job, "This approval predates patch binding; please approve again."));
    const currentHash = computePatchHash(ctx.proposal.changes, repo.id);
    if (currentHash !== job.approvedPatchHash) {
      throw new Stop(await reapprove(deps, input, job, "The patch changed after it was approved. Review it and approve again."));
    }
    const command = validateTestCommand(job.testCommand);
    if (!command.ok) throw new Stop(await block(deps, input, job, `Stored test command is not allowed: ${command.reason}`, true));

    const branch = job.branchName ?? repairBranchName(job.approvedPatchHash);
    const baseBranch = repo.defaultBranch;
    const title = `fix: ${ctx.proposal.title}`;

    // ---- Resume point: branch already pushed (and maybe the PR) -> go straight to the PR stage ----------
    const alreadyPushed = Boolean(job.headCommitSha && job.branchName);
    let headSha = job.headCommitSha;

    if (!alreadyPushed) {
      workDir = undefined;
      if (stage !== "REVALIDATING") {
        // Resuming a pre-push stage after a crash: re-enter revalidation from the top.
        if (stage === "TESTING") { await move("REVALIDATING"); }
      }

      const clone = await deps.git.clone(repo.cloneUrl, ctx.sourceRef || baseBranch, ctx.token);
      workDir = clone.dir;
      if (job.approvedBaseCommitSha && clone.headSha !== job.approvedBaseCommitSha) {
        const actual = await computePreImageHashes(clone.dir, ctx.proposal.changes);
        if (!preImagesMatch(job.preImageHashes, actual)) {
          throw new Stop(await reapprove(deps, input, job, "The repository changed in files this patch touches since it was approved. Review the new state and approve again."));
        }
      }
      await deps.git.createBranch(clone.dir, branch);
      await deps.patch.apply(clone.dir, {
        title: ctx.proposal.title, summary: ctx.proposal.summary, changes: ctx.proposal.changes,
        risk: ctx.proposal.risk as FixResult["risk"], confidence: ctx.proposal.confidence, reasoning: ctx.proposal.reasoning,
      });
      await crash("after-patch");
      await crash("after-revalidate");

      // ---- Tests: the FULL configured suite, fresh, on the patched fresh clone -----------------------
      await move("TESTING");
      const run = await deps.sandbox.runTests(clone.dir, job.workingDirectory, command.argv);
      await crash("after-tests");
      const decision = decidePublication(ctx.verification, run);
      if (!decision.ok) {
        const infra = run.exitCode === null && !run.timedOut;
        throw new Stop(await block(deps, input, job, decision.reason, !infra, infra));
      }

      // ---- Branch: reuse an identical remote branch, never overwrite a different one ------------------
      const commit = await deps.git.commit(clone.dir, fileSet(ctx.proposal.changes), `fix: ${ctx.proposal.title.slice(0, 120)}`);
      const remoteTip = await deps.git.remoteBranchTip(clone.dir, branch, ctx.token);
      if (remoteTip) {
        const remoteTree = await deps.git.remoteBranchTree(clone.dir, branch, ctx.token);
        if (remoteTree !== commit.tree) {
          throw new Stop(await block(deps, input, job, `The branch ${branch} already exists on GitHub with different content. RepoDoctor never overwrites or force-pushes a branch; remove or rename it and approve again.`, true, false, true));
        }
        headSha = remoteTip; // identical content already there: reuse it, no push
      } else {
        await deps.git.push(clone.dir, branch, ctx.token);
        headSha = commit.sha;
      }
      await crash("after-push-before-persist");
      await move("BRANCH_PUSHED", { branchName: branch, headCommitSha: headSha! });
      await crash("after-branch-persisted");
    } else if (stage === "REVALIDATING" || stage === "TESTING") {
      // Persisted facts say the branch is pushed even though the status is earlier (crash between writes): normalise forward.
      await move("BRANCH_PUSHED", { branchName: job.branchName!, headCommitSha: job.headCommitSha! });
    }

    // ---- Pull request: reuse an existing one, otherwise create exactly one ----------------------------
    let number = job.pullRequestNumber;
    let url = job.pullRequestUrl;
    let prState = "OPEN";
    if (!number || !url) {
      let pr = await deps.github.findPullRequest(repo.ownerLogin, repo.name, branch, ctx.token);
      if (!pr) {
        try {
          const created = await deps.github.createPullRequest({
            owner: repo.ownerLogin, repo: repo.name, head: branch, base: baseBranch, title,
            body: buildBody(ctx, job.approvedPatchHash, headSha!), token: ctx.token,
          });
          pr = { number: created.number, htmlUrl: created.htmlUrl, state: "open", merged: false };
        } catch (e) {
          if (e instanceof GitHubApiError && e.status === 422) {
            pr = await deps.github.findPullRequest(repo.ownerLogin, repo.name, branch, ctx.token); // lost a race / crashed after creating
            if (!pr) throw e;
          } else throw e;
        }
      }
      await crash("after-pr-created-before-persist");
      number = pr.number; url = pr.htmlUrl;
      prState = pr.merged ? "MERGED" : pr.state === "closed" ? "CLOSED" : "OPEN";
      await move("PR_CREATED", { pullRequestNumber: number, pullRequestUrl: url });
    } else if (stage !== "PR_CREATED") {
      await move("PR_CREATED", {});
    }
    await crash("after-pr-persisted");

    await deps.store.savePullRequest({
      analysisId: job.analysisId, findingId: job.findingId, fixProposalId: job.fixProposalId, verificationResultId: job.verificationResultId,
      owner: repo.ownerLogin, repo: repo.name, branchName: branch, baseBranch, commitSha: headSha!, pullRequestNumber: number!, pullRequestUrl: url!, title, status: prState,
    });
    if (!(await deps.store.transition(input.repairJobId, "PR_CREATED", "COMPLETED", { errorMessage: null, publishLockedUntil: null }, now()))) {
      throw new Stop({ status: "SKIPPED", reason: "Publication stopped before completion." });
    }
    await fx.audit({ eventType: "PR_CREATED", outcome: "SUCCESS", details: { pullRequestNumber: number, prState } });
    await fx.notify({
      type: "PR_CREATED",
      title: prState === "OPEN" ? "Pull request created" : `Pull request already existed (${prState.toLowerCase()})`,
      message: prState === "OPEN"
        ? `A verified fix is open as pull request #${number}. RepoDoctor never merges; review it on GitHub.`
        : `Pull request #${number} for this fix already exists on GitHub and is ${prState.toLowerCase()}; no new one was created.`,
    });
    return { status: "PUBLISHED", pullRequestUrl: url!, pullRequestNumber: number! };
  } catch (error) {
    if (error instanceof SimulatedCrash) throw error; // the process 'died': leave every row exactly as it is
    if (error instanceof Stop) return error.outcome;
    return failTransient(deps, input, ctx0, error, now);
  } finally {
    if (workDir) await deps.git.cleanup(workDir).catch(() => undefined);
  }
}

function buildBody(ctx: PublicationContext, patchHash: string, headSha: string): string {
  return [
    `**RepoDoctor verified fix** — ${ctx.proposal!.title}`,
    "",
    ctx.proposal!.summary,
    "",
    `- Risk: ${ctx.proposal!.risk}`,
    `- Verification: tests passed in an isolated sandbox, re-run on a fresh clone before this pull request was opened`,
    `- Approved patch: \`${patchHash.slice(0, 12)}\` · commit \`${headSha.slice(0, 12)}\``,
    "",
    "_Generated by RepoDoctor AI. Passing tests is evidence, not proof of correctness. RepoDoctor never merges: please review before merging._",
  ].join("\n");
}

async function block(deps: PublicationDeps, input: { repairJobId: string; userId: string }, job: PublicationJob, reason: string, permanent: boolean, retryable = false, branchExists = false): Promise<PublishOutcome> {
  const status = retryable ? "PUBLISH_FAILED_RETRYABLE" : "PUBLISH_BLOCKED";
  return settle(deps, input, job, status, reason, retryable ? "RETRYABLE" : "BLOCKED", branchExists);
}

async function reapprove(deps: PublicationDeps, input: { repairJobId: string; userId: string }, job: PublicationJob, reason: string): Promise<PublishOutcome> {
  return settle(deps, input, job, "NEEDS_REAPPROVAL", reason, "NEEDS_REAPPROVAL", false);
}

/** Records a terminal-or-retryable stop from whatever stage we hold, then tells the owner the TRUTH about GitHub. */
async function settle(deps: PublicationDeps, input: { repairJobId: string; userId: string }, job: PublicationJob, status: string, reason: string, kind: "BLOCKED" | "RETRYABLE" | "NEEDS_REAPPROVAL", branchExists: boolean): Promise<PublishOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const current = (await deps.store.currentStatus(job.id)) ?? "";
  const fresh = await deps.store.load(job.id);
  const pushed = Boolean(fresh?.job.headCommitSha) || branchExists;
  const retryAt = new Date(now.getTime() + 60_000);
  await deps.store.transition(job.id, current, status, { errorMessage: reason.slice(0, 900), publishLockedUntil: kind === "RETRYABLE" ? retryAt : null }, now).catch(() => false);
  const fx = deps.effects({ repairJobId: job.id, userId: input.userId, repositoryId: fresh?.repository.id ?? "" });
  await fx.audit({ eventType: "PR_BLOCKED", outcome: "DENIED", details: { reason: reason.slice(0, 300), status, branchPushed: pushed } });
  await fx.notify({
    type: "REPAIR_FAILED", severity: "WARNING",
    title: kind === "NEEDS_REAPPROVAL" ? "Please review and approve this fix again" : "Pull request was not created",
    message: `${reason.slice(0, 500)} ${pushed
      ? `A branch${fresh?.job.branchName ? ` (${fresh.job.branchName})` : ""} already exists on GitHub from this fix; ${kind === "RETRYABLE" ? "a retry will reuse it" : "no pull request was opened"}.`
      : "Nothing was pushed to your repository."}`,
  });
  return kind === "RETRYABLE" ? { status: "RETRYABLE", reason } : kind === "NEEDS_REAPPROVAL" ? { status: "NEEDS_REAPPROVAL", reason } : { status: "BLOCKED", reason };
}

async function failTransient(deps: PublicationDeps, input: { repairJobId: string; userId: string }, ctx0: PublicationContext, error: unknown, now: () => Date): Promise<PublishOutcome> {
  const message = error instanceof Error ? error.message : "Unknown error";
  const permanent = error instanceof GitHubApiError && !error.transient;
  const fresh = await deps.store.load(input.repairJobId);
  const job = fresh?.job ?? ctx0.job;
  const exhausted = job.publishAttempts >= MAX_PUBLISH_ATTEMPTS;
  if (permanent || exhausted) return settle(deps, input, job, "PUBLISH_BLOCKED", `Publishing failed: ${message}`, "BLOCKED", false);
  return settle(deps, input, job, "PUBLISH_FAILED_RETRYABLE", `Publishing failed: ${message}`, "RETRYABLE", false);
}

// ---------------------------------------------------------------------------------------------------------
// Real git / filesystem implementation
// ---------------------------------------------------------------------------------------------------------

const gitEnv = (token: string, baseUrl: string): NodeJS.ProcessEnv => {
  const host = (() => { try { return new URL(baseUrl).origin; } catch { return "https://github.com"; } })();
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `http.${host}/.extraheader`,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
  };
};

export const gitBaseUrl = () => (process.env.GITHUB_GIT_BASE_URL || "https://github.com").replace(/\/+$/, "");
export const remoteUrlFor = (owner: string, repo: string) => `${gitBaseUrl()}/${owner}/${repo}.git`;

export const realGit = (): GitOps => {
  const run = async (cwd: string, args: string[], env?: NodeJS.ProcessEnv) =>
    (await execFileAsync("git", args, { cwd, env: env ?? process.env, timeout: 180_000, maxBuffer: 10 * 1024 * 1024 })).stdout.trim();
  return {
    async clone(cloneUrl, ref, token) {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), `repodoctor-publish-${randomUUID().slice(0, 8)}-`));
      const target = path.join(dir, "repository");
      try {
        await execFileAsync("git", ["clone", "--depth", "1", "--branch", ref, "--", cloneUrl, target], { env: gitEnv(token, cloneUrl), timeout: 180_000, maxBuffer: 10 * 1024 * 1024 });
        await run(target, ["config", "user.name", "RepoDoctor AI"]);
        await run(target, ["config", "user.email", "repodoctor-ai@users.noreply.github.com"]);
        return { dir: target, headSha: await run(target, ["rev-parse", "HEAD"]) };
      } catch (e) {
        await fs.rm(dir, { recursive: true, force: true });
        throw e;
      }
    },
    async createBranch(dir, branch) { await run(dir, ["checkout", "-b", branch]); },
    async commit(dir, files, message) {
      await run(dir, ["add", "--", ...files]);
      const staged = (await run(dir, ["diff", "--cached", "--name-only"])).split("\n").filter(Boolean).sort();
      if (staged.length === 0) throw new Error("The patch produced no changes.");
      const unexpected = staged.filter((f) => !files.includes(f));
      if (unexpected.length > 0) throw new Error("Staged files differ from the approved patch.");
      await run(dir, ["commit", "-m", message]);
      return { sha: await run(dir, ["rev-parse", "HEAD"]), tree: await run(dir, ["rev-parse", "HEAD^{tree}"]) };
    },
    async remoteBranchTip(dir, branch, token) {
      const out = await run(dir, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`], gitEnv(token, gitBaseUrl()));
      return out ? out.split(/\s+/)[0] : null;
    },
    async remoteBranchTree(dir, branch, token) {
      await run(dir, ["fetch", "--depth", "1", "origin", `refs/heads/${branch}`], gitEnv(token, gitBaseUrl()));
      return run(dir, ["rev-parse", "FETCH_HEAD^{tree}"]);
    },
    async push(dir, branch, token) {
      await run(dir, ["push", "origin", `refs/heads/${branch}:refs/heads/${branch}`], gitEnv(token, gitBaseUrl()));
    },
    async cleanup(dir) { await fs.rm(path.dirname(dir), { recursive: true, force: true }); },
  };
};
