import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma } from "../config/prisma.js";
import {
  exchangeCodeForToken,
  getGitHubAuthUrl,
  getGitHubRepositories,
  getGitHubUser,
} from "../services/github.service.js";
import { saveRepository } from "../services/repository.service.js";

export const connectGitHub = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId as string;
    const secret = process.env.JWT_SECRET;

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }
    if (!secret) {
      return res.status(503).json({ message: "OAuth is not configured" });
    }

    // Signed, expiring state bound to an HttpOnly cookie prevents a forged
    // callback from attaching an attacker's GitHub account to another user.
    const state = jwt.sign(
      { userId, purpose: "github_oauth", nonce: randomUUID() },
      secret,
      { expiresIn: "10m" },
    );

    res.cookie("github_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/github/callback",
      maxAge: 10 * 60 * 1000,
    });

    return res.json({ authUrl: getGitHubAuthUrl(state) });
  } catch (error) {
    console.error("GitHub connect error:", error);
    return res.status(500).json({ message: "Failed to create GitHub authorization URL" });
  }
};

export const githubCallback = async (req: Request, res: Response) => {
  const clearStateCookie = () => res.clearCookie("github_oauth_state", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/github/callback",
  });

  try {
    const { code, state } = req.query;
    const cookieHeader = req.headers.cookie ?? "";
    const stateCookie = cookieHeader
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("github_oauth_state="))
      ?.slice("github_oauth_state=".length);
    const secret = process.env.JWT_SECRET;

    if (
      !code || typeof code !== "string" ||
      !state || typeof state !== "string" ||
      !stateCookie || decodeURIComponent(stateCookie) !== state ||
      !secret
    ) {
      clearStateCookie();
      return res.status(400).json({ message: "Invalid GitHub OAuth state" });
    }

    let userId: string;
    try {
      const payload = jwt.verify(state, secret) as {
        userId?: string;
        purpose?: string;
      };
      if (!payload.userId || payload.purpose !== "github_oauth") {
        throw new Error("Invalid OAuth state payload");
      }
      userId = payload.userId;
    } catch {
      clearStateCookie();
      return res.status(400).json({ message: "GitHub OAuth state expired or invalid" });
    }

    const accessToken = await exchangeCodeForToken(code);
    if (!accessToken) {
      clearStateCookie();
      return res.status(400).json({ message: "Failed to obtain GitHub access token" });
    }

    const githubUser = await getGitHubUser(accessToken);
    await prisma.user.update({
      where: { id: userId },
      data: {
        githubId: String(githubUser.id),
        githubUsername: githubUser.login,
        githubAccessToken: accessToken,
      },
    });

    clearStateCookie();
    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
    return res.redirect(frontendUrl);
  } catch (error: any) {
    clearStateCookie();
    if (error?.code === "P2025") {
      return res.status(404).json({ message: "RepoDoctor user not found" });
    }
    console.error("GitHub callback failed:", error instanceof Error ? error.message : "Unknown error");
    return res.status(500).json({ message: "GitHub authentication failed" });
  }
};

export const getRepositories = async (req: Request, res: Response) => {
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

    const githubRepositories = await getGitHubRepositories(
      user.githubAccessToken,
    );

    for (const repo of githubRepositories) {
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

    const repositories = await prisma.repository.findMany({
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
    console.error("Get repositories error:", error);

    return res.status(500).json({
      message: "Failed to fetch repositories",
    });
  }
};
