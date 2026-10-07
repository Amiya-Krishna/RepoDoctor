export interface GitHubRepository {
  owner: string;
  repo: string;
  baseBranch: string;
}

export interface CreatePullRequestInput {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
  draft?: boolean;
}

export interface GitHubPullRequest {
  number: number;
  htmlUrl: string;
  title: string;
  headBranch: string;
  baseBranch: string;
  state: string;
}

export interface GitHubApiError {
  message: string;
  status: number;
}