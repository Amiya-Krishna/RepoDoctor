import { Request, Response } from "express";
import {
  exchangeCodeForToken,
  getGitHubAuthUrl,
  getGitHubRepositories,
  getGitHubUser,
} from "../services/github.service";
import { prisma } from "../config/prisma";
import { saveRepository } from "../services/repository.service";

export const connectGitHub = async (
  req: Request,
  res: Response
) => {
  try {
    const userId = (req as any).user.userId;

    if (!userId) {
      return res.status(401).json({
        message: "User not authenticated",
      });
    }

    const state = Buffer.from(userId).toString("base64url");

    const authUrl = getGitHubAuthUrl(state);

    res.json({
      authUrl,
    });
  } catch (error) {
    console.error("GitHub connect error:", error);

    res.status(500).json({
      message: "Failed to create GitHub authorization URL",
    });
  }
};

export const githubCallback = async (
  req: Request,
  res: Response
) => {
  try {
    const { code, state } = req.query;

    if (
      !code ||
      typeof code !== "string" ||
      !state ||
      typeof state !== "string"
    ) {
      return res.status(400).json({
        message: "Invalid GitHub OAuth request",
      });
    }

    // Decode RepoDoctor user ID
    const userId = Buffer.from(state, "base64url").toString("utf8");

    console.log("RepoDoctor user ID:", userId);

    // Exchange GitHub code for access token
    const accessToken = await exchangeCodeForToken(code);

    if (!accessToken) {
      return res.status(400).json({
        message: "Failed to obtain GitHub access token",
      });
    }

    // Get GitHub account
    const githubUser = await getGitHubUser(accessToken);

    console.log("GitHub user:", githubUser.login);
    console.log("GitHub ID:", githubUser.id);

    // Update RepoDoctor user
    let updatedUser;
    try {
      updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          githubId: String(githubUser.id),
          githubUsername: githubUser.login,
          githubAccessToken: accessToken,
        },
      });
    } catch (updateError: any) {
      if (updateError?.code === "P2025") {
        return res.status(404).json({
          message: "RepoDoctor user not found",
        });
      }

      throw updateError;
    }

    console.log("GitHub connection saved successfully");

    return res.redirect("http://localhost:5173");

  } catch (error) {
    console.error("GitHub callback error:", error);

    return res.status(500).json({
      message: "GitHub authentication failed",
    });
  }
};

export const getRepositories = async (
  req: Request,
  res: Response
) => {
  try {
    const userId = (req as any).user.userId;

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!user.githubAccessToken) {
      return res.status(400).json({
        message: "GitHub account is not connected",
      });
    }

    const githubRepositories =
      await getGitHubRepositories(
        user.githubAccessToken
      );

    console.log(
      "GitHub repositories:",
      githubRepositories.length
    );

    for (const repo of githubRepositories) {
      console.log(
        "Saving repository:",
        repo.full_name
      );

      await saveRepository({
        githubId: String(repo.id),
        name: repo.name,
        fullName: repo.full_name,
        ownerLogin: repo.owner.login,
        defaultBranch: repo.default_branch,
        private: repo.private,
        htmlUrl: repo.html_url,
        cloneUrl: repo.clone_url,
        userId,
      });
    }

    const repositories =
      await prisma.repository.findMany({
        where: {
          userId,
        },
        orderBy: {
          updatedAt: "desc",
        },
      });

    return res.json({
      repositories,
    });
  } catch (error) {
    console.error(
      "Get repositories error:",
      error
    );

    return res.status(500).json({
      message: "Failed to fetch repositories",
    });
  }
};