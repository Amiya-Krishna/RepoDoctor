import type {
  CreatePullRequestInput,
  GitHubPullRequest,
} from "./github.types.js";

const GITHUB_API_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";

const getGitHubToken = (tokenOverride?: string): string => {
  const token = tokenOverride ?? process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not configured.",
    );
  }

  return token;
};

const githubRequest = async <T>(
  path: string,
  options: RequestInit = {},
  tokenOverride?: string,
): Promise<T> => {
  const token = getGitHubToken(tokenOverride);

  const response = await fetch(
    `${GITHUB_API_URL}${path}`,
    {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    },
  );

  const text = await response.text();

  let data: unknown;

  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    throw new Error(
      `GitHub API returned invalid JSON. HTTP ${response.status}`,
    );
  }

  if (!response.ok) {
    const message =
      typeof data === "object" &&
      data !== null &&
      "message" in data &&
      typeof data.message === "string"
        ? data.message
        : "Unknown GitHub API error.";

    throw new Error(
      `GitHub API error ${response.status}: ${message}`,
    );
  }

  return data as T;
};

export const createPullRequest = async (
  input: CreatePullRequestInput,
): Promise<GitHubPullRequest> => {
  const result = await githubRequest<{
    number: number;
    html_url: string;
    title: string;
    state: string;
    head: {
      ref: string;
    };
    base: {
      ref: string;
    };
  }>(
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
        draft: input.draft ?? false,
        maintainer_can_modify: false,
      }),
    },
    input.token,
  );

  return {
    number: result.number,
    htmlUrl: result.html_url,
    title: result.title,
    headBranch: result.head.ref,
    baseBranch: result.base.ref,
    state: result.state,
  };
};