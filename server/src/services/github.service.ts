import axios from "axios";

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID!;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET!;
const GITHUB_CALLBACK_URL = process.env.GITHUB_CALLBACK_URL!;

export const getGitHubAuthUrl = (state: string) => {
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_CALLBACK_URL,
    scope: "repo read:user user:email",
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