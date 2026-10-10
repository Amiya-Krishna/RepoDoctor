import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { queueRepositoryScan } from "../queue/scan.queue.js";
import { verifyGitHubWebhookSignature } from "../github/github-webhook.signature.js";

interface GitHubWebhookPayload {
  action?: string;
  ref?: string;
  repository?: {
    id?: number | string;
    full_name?: string;
    default_branch?: string;
  };
  pull_request?: {
    head?: {
      ref?: string;
      repo?: { id?: number | string } | null;
    };
  };
}


export const handleGitHubWebhook = async (req: Request, res: Response) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(503).json({ message: "GitHub webhook is not configured" });
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const signature = req.header("x-hub-signature-256");
  const eventName = req.header("x-github-event");
  const deliveryId = req.header("x-github-delivery");

  if (!rawBody || !signature || !eventName || !deliveryId) {
    return res.status(400).json({ message: "Missing required GitHub webhook headers or body" });
  }

  if (!verifyGitHubWebhookSignature(rawBody, signature, secret)) {
    return res.status(401).json({ message: "Invalid webhook signature" });
  }

  if (eventName === "ping") {
    return res.status(200).json({ accepted: true, event: "ping" });
  }

  let payload: GitHubWebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as GitHubWebhookPayload;
  } catch {
    return res.status(400).json({ message: "Invalid webhook JSON" });
  }

  const githubId = payload.repository?.id;
  if (githubId === undefined || githubId === null) {
    return res.status(400).json({ message: "Webhook payload has no repository ID" });
  }

  let ref: string | undefined;
  if (eventName === "push") {
    if (!payload.ref?.startsWith("refs/heads/")) {
      return res.status(202).json({ accepted: true, ignored: "Not a branch push" });
    }
    ref = payload.ref.slice("refs/heads/".length);
  } else if (eventName === "pull_request") {
    if (!["opened", "reopened", "synchronize", "ready_for_review"].includes(payload.action ?? "")) {
      return res.status(202).json({ accepted: true, ignored: "Pull request action not configured for scanning" });
    }

    // The first version deliberately scans only same-repository PR branches.
    // Fork branches require an explicit trust/permissions policy.
    const headRepoId = payload.pull_request?.head?.repo?.id;
    if (headRepoId === undefined || String(headRepoId) !== String(githubId)) {
      return res.status(202).json({ accepted: true, ignored: "Fork pull requests are not enabled" });
    }

    ref = payload.pull_request?.head?.ref;
    if (!ref) {
      return res.status(400).json({ message: "Pull request head branch is missing" });
    }
  } else {
    return res.status(202).json({ accepted: true, ignored: `Unsupported event: ${eventName}` });
  }

  const repository = await prisma.repository.findFirst({
    where: { githubId: String(githubId) },
    select: { id: true, userId: true },
  });

  if (!repository) {
    return res.status(202).json({ accepted: true, ignored: "Repository is not connected to RepoDoctor" });
  }

  const queued = await queueRepositoryScan(
    {
      repositoryId: repository.id,
      userId: repository.userId,
      trigger: "github-webhook",
      ref,
      deliveryId,
    },
    `github-${deliveryId}`,
  );

  return res.status(202).json({
    accepted: true,
    queued: true,
    jobId: queued.jobId,
  });
};
