import type { Request, Response } from "express";
import { verifyGitHubWebhookSignature } from "../github/github-webhook.signature.js";
import { claimDelivery, prismaDeliveryStore, type DeliveryStore } from "../github/webhook-replay.js";
import { recordAudit } from "../audit/audit.service.js";

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


export interface WebhookDeps {
  deliveries: DeliveryStore;
  findAutoScanRepositories: (githubId: string) => Promise<{ id: string; userId: string }[]>;
  queueScan: (data: { repositoryId: string; userId: string; trigger: "github-webhook"; ref?: string; deliveryId: string }, jobId: string) => Promise<{ jobId: string }>;
}

// Database and queue are loaded lazily so the handler can be tested with fakes.
const defaultDeps: WebhookDeps = {
  deliveries: prismaDeliveryStore,
  async findAutoScanRepositories(githubId) {
    const { prisma } = await import("../config/prisma.js");
    return prisma.repository.findMany({ where: { githubId, autoScan: true }, select: { id: true, userId: true } });
  },
  async queueScan(data, jobId) {
    const { queueRepositoryScan } = await import("../queue/scan.queue.js");
    return queueRepositoryScan(data, jobId);
  },
};

export const createWebhookHandler = (deps: WebhookDeps = defaultDeps) => async (req: Request, res: Response) => {
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
    await recordAudit({ eventType: "WEBHOOK_REJECTED", outcome: "DENIED", details: { reason: "bad-signature", event: eventName.slice(0, 40) } });
    return res.status(401).json({ message: "Invalid webhook signature" });
  }

  // Authentic is not the same as fresh: accept each delivery id once. If the
  // store is unavailable we cannot rule out a replay, so refuse (fail closed);
  // GitHub redelivers on a non-2xx response.
  let claim: Awaited<ReturnType<typeof claimDelivery>>;
  try {
    claim = await claimDelivery(deps.deliveries, deliveryId, eventName);
  } catch {
    return res.status(503).json({ message: "Webhook temporarily unavailable" });
  }
  if (claim === "invalid") return res.status(400).json({ message: "Invalid delivery id" });
  if (claim === "replay") {
    await recordAudit({ eventType: "WEBHOOK_REPLAY", outcome: "DENIED", details: { event: eventName.slice(0, 40) } });
    return res.status(200).json({ accepted: false, ignored: "Duplicate delivery" });
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

  // Only repositories whose owner switched on automatic scanning are scanned
  // from webhooks (opt-in). Several users may have connected the same repository.
  const repositories = await deps.findAutoScanRepositories(String(githubId));

  if (repositories.length === 0) {
    return res.status(202).json({ accepted: true, ignored: "Automatic scanning is not enabled for this repository" });
  }

  const jobIds: string[] = [];
  for (const repository of repositories) {
    const queued = await deps.queueScan(
      { repositoryId: repository.id, userId: repository.userId, trigger: "github-webhook", ref, deliveryId },
      `github-${deliveryId}-${repository.id}`,
    );
    jobIds.push(queued.jobId);
  }
  await recordAudit({ eventType: "WEBHOOK_ACCEPTED", outcome: "SUCCESS", details: { event: eventName.slice(0, 40), repositories: repositories.length } });

  return res.status(202).json({ accepted: true, queued: true, jobIds });
};

export const handleGitHubWebhook = createWebhookHandler();
