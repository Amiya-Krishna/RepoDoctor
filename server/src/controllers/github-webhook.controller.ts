import type { Request, Response } from "express";
import { verifyGitHubWebhookSignature } from "../github/github-webhook.signature.js";
import { isValidDeliveryId } from "../github/webhook-replay.js";
import { createPrismaWebhookStore, type OutboxPlan, type WebhookStore } from "../github/webhook-store.js";
import { dispatchDelivery, type DispatchDeps } from "../github/webhook-dispatcher.js";
import type { RepositoryScanJobData } from "../queue/scan.queue.js";
import { recordAudit } from "../audit/audit.service.js";

interface GitHubWebhookPayload {
  action?: string;
  ref?: string;
  repository?: {
    id?: number | string;
    full_name?: string;
    default_branch?: string;
  };
  head_commit?: { timestamp?: string } | null;
  pull_request?: {
    updated_at?: string;
    head?: {
      ref?: string;
      repo?: { id?: number | string } | null;
    };
  };
}


export interface WebhookDeps {
  store: WebhookStore;
  findAutoScanRepositories: (githubId: string) => Promise<{ id: string; userId: string }[]>;
  enqueue: (data: RepositoryScanJobData, jobId: string) => Promise<unknown>;
  now?: () => Date;
}

// Database and queue are loaded lazily so the handler can be tested with fakes.
const defaultDeps: WebhookDeps = {
  store: createPrismaWebhookStore(),
  async findAutoScanRepositories(githubId) {
    const { prisma } = await import("../config/prisma.js");
    return prisma.repository.findMany({ where: { githubId, autoScan: true }, select: { id: true, userId: true } });
  },
  async enqueue(data, jobId) {
    const { queueRepositoryScan } = await import("../queue/scan.queue.js");
    return queueRepositoryScan(data, jobId);
  },
};

const maxEventAgeMs = () => {
  const h = Number(process.env.WEBHOOK_MAX_EVENT_AGE_HOURS ?? 168);
  return (Number.isFinite(h) && h > 0 ? h : 168) * 3_600_000;
};

/**
 * Durable lifecycle: a delivery is acknowledged only AFTER it (and the scan jobs it implies) were
 * committed to PostgreSQL in one transaction. From then on it is recoverable without GitHub
 * redelivering (GitHub does not retry automatically): the outbox dispatcher and the recovery sweep
 * finish the queueing. The response reports the real state, never "queued" unless it is.
 */
export const createWebhookHandler = (deps: WebhookDeps = defaultDeps) => async (req: Request, res: Response) => {
  const now = deps.now ?? (() => new Date());
  const dispatchDeps: DispatchDeps = { store: deps.store, enqueue: deps.enqueue, now };

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

  // Authenticity first: unauthenticated requests never touch the database or consume a delivery id.
  if (!verifyGitHubWebhookSignature(rawBody, signature, secret)) {
    await recordAudit({ eventType: "WEBHOOK_REJECTED", outcome: "DENIED", details: { reason: "bad-signature", event: eventName.slice(0, 40) } });
    return res.status(401).json({ message: "Invalid webhook signature" });
  }
  if (!isValidDeliveryId(deliveryId)) return res.status(400).json({ message: "Invalid delivery id" });

  // Duplicate / resume: the id is already recorded.
  let existing;
  try {
    existing = await deps.store.get(deliveryId);
  } catch {
    return res.status(503).json({ message: "Webhook temporarily unavailable" });
  }
  if (existing) return replyForExisting(existing.status, deliveryId, eventName, dispatchDeps, res);

  let payload: GitHubWebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as GitHubWebhookPayload;
  } catch {
    return res.status(400).json({ message: "Invalid webhook JSON" });
  }

  const ignore = async (note: string, extra: Partial<{ githubRepositoryId: string; ref: string }> = {}) => {
    try {
      await deps.store.record({ deliveryId, event: eventName, status: "IGNORED", note, ...extra });
    } catch {
      return res.status(503).json({ message: "Webhook temporarily unavailable" });
    }
    return res.status(202).json({ accepted: true, ignored: note, state: "IGNORED" });
  };

  if (eventName === "ping") {
    try { await deps.store.record({ deliveryId, event: eventName, status: "IGNORED", note: "ping" }); } catch { return res.status(503).json({ message: "Webhook temporarily unavailable" }); }
    return res.status(200).json({ accepted: true, event: "ping", state: "IGNORED" });
  }

  const githubId = payload.repository?.id;
  if (githubId === undefined || githubId === null) {
    return res.status(400).json({ message: "Webhook payload has no repository ID" });
  }

  // Authentic is not the same as fresh. GitHub signs no timestamp, so where the payload carries an
  // event time, refuse events older than the configured window (replay of an old capture).
  const stamp = eventName === "push" ? payload.head_commit?.timestamp : payload.pull_request?.updated_at;
  if (stamp) {
    const t = Date.parse(stamp);
    if (Number.isFinite(t) && now().getTime() - t > maxEventAgeMs()) {
      await recordAudit({ eventType: "WEBHOOK_REJECTED", outcome: "DENIED", details: { reason: "stale-event", event: eventName.slice(0, 40) } });
      return res.status(400).json({ message: "Webhook event is too old", code: "STALE_EVENT" });
    }
  }

  let ref: string | undefined;
  if (eventName === "push") {
    if (!payload.ref?.startsWith("refs/heads/")) return ignore("Not a branch push");
    ref = payload.ref.slice("refs/heads/".length);
  } else if (eventName === "pull_request") {
    if (!["opened", "reopened", "synchronize", "ready_for_review"].includes(payload.action ?? "")) {
      return ignore("Pull request action not configured for scanning");
    }
    // The first version deliberately scans only same-repository PR branches.
    // Fork branches require an explicit trust/permissions policy.
    const headRepoId = payload.pull_request?.head?.repo?.id;
    if (headRepoId === undefined || String(headRepoId) !== String(githubId)) return ignore("Fork pull requests are not enabled");
    ref = payload.pull_request?.head?.ref;
    if (!ref) return res.status(400).json({ message: "Pull request head branch is missing" });
  } else {
    return ignore(`Unsupported event: ${eventName}`);
  }

  // Only repositories whose owner switched on automatic scanning are scanned (opt-in).
  let repositories: { id: string; userId: string }[];
  try {
    repositories = await deps.findAutoScanRepositories(String(githubId));
  } catch {
    return res.status(503).json({ message: "Webhook temporarily unavailable" });
  }
  if (repositories.length === 0) return ignore("Automatic scanning is not enabled for this repository", { githubRepositoryId: String(githubId) });

  const outbox: OutboxPlan[] = repositories.map((r) => ({ repositoryId: r.id, userId: r.userId, ref, jobId: `github-${deliveryId}-${r.id}` }));
  let recorded;
  try {
    recorded = await deps.store.record({ deliveryId, event: eventName, status: "PENDING", githubRepositoryId: String(githubId), ref, outbox });
  } catch {
    // Nothing was durably recorded, so nothing is acknowledged: the operator/GitHub redelivery can retry.
    return res.status(503).json({ message: "Webhook temporarily unavailable" });
  }
  if (!recorded.created) return replyForExisting(recorded.delivery.status, deliveryId, eventName, dispatchDeps, res); // lost a concurrent race

  const result = await dispatchDelivery(dispatchDeps, deliveryId).catch(() => null);
  const state = result?.state ?? "PENDING";
  await recordAudit({ eventType: "WEBHOOK_ACCEPTED", outcome: "SUCCESS", details: { event: eventName.slice(0, 40), repositories: repositories.length, state } });
  return res.status(202).json({
    accepted: true,
    state,
    queued: state === "QUEUED",
    ...(state === "QUEUED" ? { jobIds: outbox.map((o) => o.jobId) } : { note: "Recorded durably; queueing will be completed automatically." }),
  });
};

async function replyForExisting(status: string, deliveryId: string, eventName: string, dispatchDeps: DispatchDeps, res: Response) {
  if (["PENDING", "FAILED_RETRYABLE", "PROCESSING"].includes(status)) {
    // Resume: idempotent (compare-and-set claim, deterministic job ids). A live lease elsewhere is reported as PROCESSING.
    const r = await dispatchDelivery(dispatchDeps, deliveryId).catch(() => null);
    const state = r?.state ?? status;
    return res.status(202).json({ accepted: true, resumed: Boolean(r?.claimed), state, queued: state === "QUEUED" });
  }
  await recordAudit({ eventType: "WEBHOOK_REPLAY", outcome: "DENIED", details: { event: eventName.slice(0, 40), state: status } });
  return res.status(200).json({ accepted: false, duplicate: true, ignored: "Duplicate delivery", state: status });
}

export const handleGitHubWebhook = createWebhookHandler();
