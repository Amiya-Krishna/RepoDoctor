import axios from "axios";

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID!;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET!;
const GITHUB_CALLBACK_URL = process.env.GITHUB_CALLBACK_URL!;

/**
 * "public": public_repo (read/write public repositories only).
 * "private": repo (needed to analyse and open pull requests in private repositories).
 * read:user and user:email are not requested: the profile used here is public.
 */
export type GitHubAccess = "public" | "private";
export const scopeFor = (access: GitHubAccess): string => (access === "private" ? "repo" : "public_repo");

export const getGitHubAuthUrl = (state: string, access: GitHubAccess = "public") => {
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_CALLBACK_URL,
    scope: scopeFor(access),
    state,
  });

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
};

export const exchangeCodeForToken = async (code: string) => {
  const response = await axios.post(
    "https://github.com/login/oauth/access_token",
    {
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: GITHUB_CALLBACK_URL,
    },
    {
      headers: {
        Accept: "application/json",
      },
    }
  );

  return response.data.access_token;
};

export const getGitHubUser = async (accessToken: string) => {
  const response = await axios.get("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
    },
  });

  return response.data;
};

export const getGitHubRepositories = async (accessToken: string) => {
  const response = await axios.get(
    "https://api.github.com/user/repos",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      },
      params: {
        sort: "updated",
        per_page: 100,
      },
    }
  );

  return response.data;
};