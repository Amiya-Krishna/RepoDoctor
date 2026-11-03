import { prisma } from "../config/prisma.js";
import { recordAudit } from "../audit/audit.service.js";
import { revealToken } from "../security/token-encryption.js";
import { notifyUser } from "./notification.service.js";
import { applyFixResult } from "../repair/repair.patch.js";
import { installDependencies, removeDependencyVolumes, assertDockerAvailable, resolveWorkingDirectory } from "../execution/docker.dependencies.js";
import { runDockerTest } from "../execution/docker.runner.js";
import { createPullRequest, findPullRequestByHead, getRepositoryAccess } from "../github/github.client.js";
import {
  MAX_PUBLISH_ATTEMPTS,
  realGit,
  remoteUrlFor,
  runPublication,
  type PublicationContext,
  type PublicationDeps,
  type PublicationJob,
  type PublicationStore,
  type PublishOutcome,
} from "../repair/publication.js";
import type { FixChange } from "../agents/fix.types.js";
import type { VerificationResult } from "../agents/verification.types.js";
import type { PreImageHashes } from "../repair/patch-hash.js";

export type { PublishOutcome };

const RECOVERABLE = ["REVALIDATING", "TESTING", "BRANCH_PUSHED", "PR_CREATED", "PUBLISH_FAILED_RETRYABLE"];

const toJob = (j: any): PublicationJob => ({
  id: j.id, status: j.status, analysisId: j.analysisId, findingId: j.findingId,
  fixProposalId: j.fixProposalId, verificationResultId: j.verificationResultId,
  testCommand: j.testCommand, workingDirectory: j.workingDirectory,
  baseCommitSha: j.baseCommitSha, preImageHashes: (j.preImageHashes as PreImageHashes | null) ?? null,
  approvedPatchHash: j.approvedPatchHash, approvedBaseCommitSha: j.approvedBaseCommitSha,
  branchName: j.branchName, headCommitSha: j.headCommitSha,
  pullRequestNumber: j.pullRequestNumber, pullRequestUrl: j.pullRequestUrl, publishAttempts: j.publishAttempts,
});

export const prismaPublicationStore: PublicationStore = {
  async load(repairJobId) {
    const job = await prisma.repairJob.findUnique({ where: { id: repairJobId }, include: { analysis: { include: { repository: true } } } });
    if (!job) return null;
    const repository = job.analysis.repository;
    const [proposal, stored, user] = await Promise.all([
      job.fixProposalId ? prisma.fixProposal.findFirst({ where: { id: job.fixProposalId, analysisId: job.analysisId } }) : null,
      job.verificationResultId ? prisma.verificationResult.findFirst({ where: { id: job.verificationResultId, analysisId: job.analysisId } }) : null,
      prisma.user.findUnique({ where: { id: repository.userId }, select: { githubAccessToken: true } }),
    ]);
    const ctx: PublicationContext = {
      job: toJob(job),
      repository: { id: repository.id, ownerLogin: repository.ownerLogin, name: repository.name, defaultBranch: repository.defaultBranch, cloneUrl: remoteCloneUrl(repository), userId: repository.userId },
      sourceRef: job.analysis.sourceRef,
      proposal: proposal && {
        title: proposal.title, summary: proposal.summary, risk: proposal.risk, confidence: proposal.confidence, reasoning: proposal.reasoning,
        changes: proposal.changes as unknown as FixChange[],
      },
      verification: stored && ({
        status: stored.status, title: stored.title, summary: stored.summary, confidence: stored.confidence,
        evidence: Array.isArray(stored.evidence) ? (stored.evidence as string[]) : [], reasoning: stored.reasoning,
        testPassed: stored.testPassed, regressionDetected: stored.regressionDetected,
      } as VerificationResult),
      token: user?.githubAccessToken ? revealToken(user.githubAccessToken) : null,
    };
    return ctx;
  },

  async claim(repairJobId, now, leaseMs) {
    const job = await prisma.repairJob.findUnique({ where: { id: repairJobId } });
    if (!job) return null;
    const leaseFree = !job.publishLockedUntil || job.publishLockedUntil <= now;
    const firstRun = job.status === "APPROVED";
    if (!firstRun && !(RECOVERABLE.includes(job.status) && leaseFree)) return null;
    if (job.publishAttempts >= MAX_PUBLISH_ATTEMPTS && !firstRun) return null;
    const res = await prisma.repairJob.updateMany({
      where: { id: repairJobId, status: job.status, updatedAt: job.updatedAt }, // nobody changed it since we read it
      data: { status: firstRun || job.status === "PUBLISH_FAILED_RETRYABLE" ? "REVALIDATING" : job.status, publishLockedUntil: new Date(now.getTime() + leaseMs), publishAttempts: { increment: 1 } },
    });
    if (res.count !== 1) return null;
    const fresh = await prisma.repairJob.findUniqueOrThrow({ where: { id: repairJobId } });
    return { job: toJob(fresh), resumed: !firstRun };
  },

  async transition(repairJobId, from, to, data = {}, now = new Date()) {
    const res = await prisma.repairJob.updateMany({
      where: { id: repairJobId, status: from },
      data: {
        status: to,
        ...(data.branchName !== undefined ? { branchName: data.branchName } : {}),
        ...(data.headCommitSha !== undefined ? { headCommitSha: data.headCommitSha } : {}),
        ...(data.pullRequestNumber !== undefined ? { pullRequestNumber: data.pullRequestNumber } : {}),
        ...(data.pullRequestUrl !== undefined ? { pullRequestUrl: data.pullRequestUrl } : {}),
        ...(data.errorMessage !== undefined ? { errorMessage: data.errorMessage } : {}),
        publishLockedUntil: data.publishLockedUntil !== undefined ? data.publishLockedUntil : new Date(now.getTime() + 10 * 60_000),
      },
    });
    return res.count === 1;
  },

  async currentStatus(repairJobId) {
    return (await prisma.repairJob.findUnique({ where: { id: repairJobId }, select: { status: true } }))?.status ?? null;
  },

  async savePullRequest(i) {
    try {
      await prisma.pullRequest.create({
        data: {
          analysisId: i.analysisId, findingId: i.findingId, fixProposalId: i.fixProposalId, verificationResultId: i.verificationResultId,
          repositoryOwner: i.owner, repositoryName: i.repo, branchName: i.branchName, baseBranch: i.baseBranch, commitSha: i.commitSha,
          pullRequestNumber: i.pullRequestNumber, pullRequestUrl: i.pullRequestUrl, title: i.title, status: i.status,
        },
      });
    } catch (error: any) {
      if (error?.code === "P2002") return; // unique (analysisId, findingId): a previous attempt already saved it
      throw error;
    }
  },
};

/** Stored clone URLs are github.com URLs; GITHUB_GIT_BASE_URL (tests, GHES) rewrites the origin only. */
function remoteCloneUrl(r: { ownerLogin: string; name: string; cloneUrl: string }): string {
  return process.env.GITHUB_GIT_BASE_URL ? remoteUrlFor(r.ownerLogin, r.name) : r.cloneUrl;
}

export const defaultPublicationDeps = (): PublicationDeps => ({
  store: prismaPublicationStore,
  git: realGit(),
  github: {
    async access(owner, repo, token) { const a = await getRepositoryAccess(owner, repo, token); return { canPush: a.canPush }; },
    findPullRequest: (owner, repo, branch, token) => findPullRequestByHead(owner, repo, branch, token),
    async createPullRequest(i) {
      const pr = await createPullRequest({ owner: i.owner, repo: i.repo, head: i.head, base: i.base, title: i.title, body: i.body, draft: false, token: i.token });
      return { number: pr.number, htmlUrl: pr.htmlUrl };
    },
  },
  sandbox: {
    async runTests(dir, workingDirectory, testCommand) {
      let volumes: Awaited<ReturnType<typeof installDependencies>> = [];
      try {
        await assertDockerAvailable();
        const wd = await resolveWorkingDirectory(dir, workingDirectory ?? undefined);
        volumes = await installDependencies(dir);
        const r = await runDockerTest({ repositoryPath: dir, nodeModulesVolumes: volumes, workingDirectory: wd, testCommand, environment: { REPO_DOCTOR_ATTEMPT: "publish" } });
        return { success: r.success, exitCode: r.exitCode, timedOut: r.timedOut, errorMessage: r.errorMessage };
      } catch (error) {
        // Docker/install trouble is an infrastructure failure, not a verdict on the patch: retryable.
        return { success: false, exitCode: null, timedOut: false, errorMessage: error instanceof Error ? error.message : "sandbox failure" };
      } finally {
        await removeDependencyVolumes(volumes);
      }
    },
  },
  patch: { apply: async (dir, fix) => { await applyFixResult(dir, fix); } },
  effects: ({ repairJobId, userId, repositoryId }) => ({
    audit: (e) => recordAudit({ eventType: e.eventType, outcome: e.outcome, actorId: userId, repositoryId: repositoryId || undefined, repairJobId, details: e.details }),
    notify: (n) => notifyUser({ userId, type: n.type, severity: n.severity, title: n.title, message: n.message, repositoryId: repositoryId || undefined }),
  }),
});

/** Publishes a repair the owner approved. Runs inside the repair worker only. See repair/publication.ts for the state machine. */
export async function publishApprovedRepair(input: { repairJobId: string; userId: string }, deps: PublicationDeps = defaultPublicationDeps()): Promise<PublishOutcome> {
  return runPublication(input, deps);
}
