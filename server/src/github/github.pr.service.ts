import { createPullRequest } from "./github.client.js";
import type {
  GitHubPullRequest,
} from "./github.types.js";

export interface CreateRepairPullRequestInput {
  branchName: string;
  baseBranch: string;
  title: string;
  body: string;
}

export const createRepairPullRequest = async (
  input: CreateRepairPullRequestInput,
): Promise<GitHubPullRequest> => {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;

  if (!owner) {
    throw new Error(
      "GITHUB_OWNER is not configured.",
    );
  }

  if (!repo) {
    throw new Error(
      "GITHUB_REPO is not configured.",
    );
  }

  if (!input.branchName) {
    throw new Error(
      "Repair branch name is required.",
    );
  }

  if (!input.baseBranch) {
    throw new Error(
      "Base branch is required.",
    );
  }

  if (
    input.branchName === input.baseBranch
  ) {
    throw new Error(
      "Refusing to create a PR from the base branch.",
    );
  }

  return createPullRequest({
    owner,
    repo,
    head: input.branchName,
    base: input.baseBranch,
    title: input.title,
    body: input.body,
    draft: false,
  });
};