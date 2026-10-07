import {
  execFile as execFileCallback,
} from "node:child_process";

import { promisify } from "node:util";

import {
  createRepairPullRequest,
} from "../github/github.pr.service.js";

import type {
  RepairWorkspace,
} from "../repair/repair.types.js";

import type {
  VerificationResult,
} from "../agents/verification.types.js";

import {
  buildRepairPullRequestBody,
} from "../github/github.pr-body.js";

import {
  savePullRequest,
} from "./pull-request-result.service.js";

const execFile = promisify(execFileCallback);

const getGitHubRepositoryUrl = (): string => {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;

  if (!owner || !repo) {
    throw new Error(
      "GITHUB_OWNER and GITHUB_REPO are required.",
    );
  }

  return `https://github.com/${owner}/${repo}.git`;
};

const getBaseBranch = (): string => {
  return (
    process.env.GITHUB_BASE_BRANCH ??
    "main"
  );
};

const getGitHubPushEnvironment = (): NodeJS.ProcessEnv => {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not configured.",
    );
  }

  const encodedCredentials = Buffer.from(
    `x-access-token:${token}`,
    "utf8",
  ).toString("base64");

  return {
    ...process.env,

    /*
     * Git receives the credential through environment
     * configuration rather than putting the token into
     * the repository URL or command arguments.
     */
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraheader",
    GIT_CONFIG_VALUE_0:
      `AUTHORIZATION: basic ${encodedCredentials}`,
  };
};

const runGit = async (
  repositoryPath: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
) => {
  return execFile(
    "git",
    args,
    {
      cwd: repositoryPath,
      env: env ?? process.env,
      maxBuffer: 2_000_000,
    },
  );
};

const validateVerifiedResult = (
  verification: VerificationResult,
): void => {
  if (
    verification.status !== "VERIFIED"
  ) {
    throw new Error(
      `PR creation requires VERIFIED status. Received: ${verification.status}`,
    );
  }

  if (!verification.testPassed) {
    throw new Error(
      "PR creation requires testPassed=true.",
    );
  }

  if (verification.regressionDetected) {
    throw new Error(
      "PR creation refused because a regression was detected.",
    );
  }

  if (
    verification.confidence < 0.7
  ) {
    throw new Error(
      "PR creation refused because verification confidence is below 0.7.",
    );
  }
};

const validateWorkingTree = async (
  workspace: RepairWorkspace,
): Promise<void> => {
  const { stdout } = await runGit(
    workspace.repositoryPath,
    ["status", "--short"],
  );

  if (!stdout.trim()) {
    throw new Error(
      "Repair workspace contains no changes.",
    );
  }
};

const validateBranch = async (
  workspace: RepairWorkspace,
): Promise<void> => {
  const { stdout } = await runGit(
    workspace.repositoryPath,
    ["branch", "--show-current"],
  );

  const currentBranch = stdout.trim();

  if (
    !currentBranch ||
    currentBranch !== workspace.branchName
  ) {
    throw new Error(
      `Unexpected repair branch: ${currentBranch}`,
    );
  }

  const baseBranch = getBaseBranch();

  if (currentBranch === baseBranch) {
    throw new Error(
      "Refusing to operate on the base branch.",
    );
  }
};

const commitRepair = async (
  workspace: RepairWorkspace,
): Promise<string> => {
  await runGit(
    workspace.repositoryPath,
    [
      "add",
      "--",
      ".",
    ],
  );

  const { stdout: status } = await runGit(
    workspace.repositoryPath,
    ["status", "--short"],
  );

  if (!status.trim()) {
    throw new Error(
      "No changes available to commit.",
    );
  }

  await runGit(
    workspace.repositoryPath,
    [
      "commit",
      "-m",
      "fix: apply verified RepoDoctor repair",
    ],
  );

  const { stdout } = await runGit(
    workspace.repositoryPath,
    [
      "rev-parse",
      "HEAD",
    ],
  );

  return stdout.trim();
};

const configureOrigin = async (
  workspace: RepairWorkspace,
): Promise<void> => {
  const repositoryUrl =
    getGitHubRepositoryUrl();

  await runGit(
    workspace.repositoryPath,
    [
      "remote",
      "set-url",
      "origin",
      repositoryUrl,
    ],
  );
};

const pushRepairBranch = async (
  workspace: RepairWorkspace,
): Promise<void> => {
  const env =
    getGitHubPushEnvironment();

  await runGit(
    workspace.repositoryPath,
    [
      "push",
      "--set-upstream",
      "origin",
      workspace.branchName,
    ],
    env,
  );
};

export const publishVerifiedRepair = async (
  workspace: RepairWorkspace,
  verification: VerificationResult,
  title: string,
  body: string,
) => {
  validateVerifiedResult(
    verification,
  );

  await validateBranch(
    workspace,
  );

  await validateWorkingTree(
    workspace,
  );

  await configureOrigin(
    workspace,
  );

  const commitSha =
    await commitRepair(
      workspace,
    );

  await pushRepairBranch(
    workspace,
  );

  const pullRequest =
    await createRepairPullRequest({
      branchName:
        workspace.branchName,
      baseBranch:
        getBaseBranch(),
      title,
      body,
    });

  return {
    commitSha,
    pullRequest,
  };
};

export const publishVerifiedRepairWithCleanup =
  async (
    workspace: RepairWorkspace,
    verification: VerificationResult,
    findingTitle: string,
    verificationResultId: string,
    analysisId: string,
    findingId: string,
    fixProposalId: string,
  ) => {
    const title =
      `fix: ${findingTitle}`;

    const body =
      buildRepairPullRequestBody(
        verification,
        findingTitle,
      );

    const result =
      await publishVerifiedRepair(
        workspace,
        verification,
        title,
        body,
      );

    const owner =
      process.env.GITHUB_OWNER;

    const repo =
      process.env.GITHUB_REPO;

    if (!owner || !repo) {
      throw new Error(
        "GITHUB_OWNER and GITHUB_REPO are required.",
      );
    }

    const saved =
      await savePullRequest({
        analysisId,
        findingId,
        fixProposalId,
        verificationResultId,

        owner,
        repo,

        branchName:
          workspace.branchName,

        baseBranch:
          getBaseBranch(),

        commitSha:
          result.commitSha,

        pullRequestNumber:
          result.pullRequest.number,

        pullRequestUrl:
          result.pullRequest.htmlUrl,

        title,
      });

    return saved;
  };