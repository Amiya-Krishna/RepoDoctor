import type {
  CreatePullRequestInput,
  GitHubPullRequest,
} from "./github.types.js";

/** Resolved per call so tests and GitHub Enterprise Server can point elsewhere (GITHUB_API_URL). */
const githubApiUrl = (): string => (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
const GITHUB_API_VERSION = "2026-03-10";

/** Carries the HTTP status so callers can tell "already exists" (422) or "no access" (403/404) from a transient failure. */
export class GitHubApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(`GitHub API error ${status}: ${message}`);
    this.name = "GitHubApiError";
  }
  /** 5xx, 429 and network-level failures are worth retrying; 4xx are decisions. */
  get transient(): boolean {
    return this.status >= 500 || this.status === 429;
  }
}

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
    `${githubApiUrl()}${path}`,
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

    throw new GitHubApiError(response.status, message);
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

export interface RepositoryAccess {
  /** The token's user can push to this repository. */
  canPush: boolean;
  defaultBranch: string;
}

/** Re-checks repository authorization right before publishing (access may have been revoked since approval). */
export const getRepositoryAccess = async (owner: string, repo: string, token: string): Promise<RepositoryAccess> => {
  const r = await githubRequest<{ permissions?: { push?: boolean }; default_branch: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    {},
    token,
  );
  return { canPush: r.permissions?.push === true, defaultBranch: r.default_branch };
};

export interface ExistingPullRequest {
  number: number;
  htmlUrl: string;
  state: "open" | "closed";
  merged: boolean;
}

/** Finds a pull request whose head is owner:branch (any state), so a retry reuses it instead of creating a duplicate. */
export const findPullRequestByHead = async (
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<ExistingPullRequest | null> => {
  const list = await githubRequest<{ number: number; html_url: string; state: "open" | "closed"; merged_at?: string | null }[]>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=all&per_page=5&head=${encodeURIComponent(`${owner}:${branch}`)}`,
    {},
    token,
  );
  const hit = Array.isArray(list) ? list[0] : undefined;
  return hit ? { number: hit.number, htmlUrl: hit.html_url, state: hit.state, merged: Boolean(hit.merged_at) } : null;
};
