import { sanitizeError, type DeliveryRecord, type DeliveryStatus, type OutboxRow, type WebhookStore } from "./webhook-store.js";
import type { RepositoryScanJobData } from "../queue/scan.queue.js";

export interface DispatchDeps {
  store: WebhookStore;
  /**
   * Adds the scan job. MUST be idempotent per jobId (BullMQ `add` with an existing id returns the
   * existing job), which is what makes re-dispatch after a crash harmless.
   */
  enqueue: (data: RepositoryScanJobData, jobId: string) => Promise<unknown>;
  now?: () => Date;
  leaseMs?: number;
  maxAttempts?: number;
}

export const DEFAULT_LEASE_MS = 60_000;

/** A hung Redis must not hang the webhook response: enqueue gives up after this long and the row stays retryable. */
const enqueueTimeoutMs = (): number => {
  const n = Number(process.env.WEBHOOK_ENQUEUE_TIMEOUT_MS ?? 5000);
  return Number.isFinite(n) && n > 0 ? n : 5000;
};

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`queue did not respond within ${ms}ms`)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
};
export const maxDispatchAttempts = (): number => {
  const n = Number(process.env.WEBHOOK_MAX_DISPATCH_ATTEMPTS ?? 8);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 8;
};

/** Exponential backoff between dispatch attempts: 5s, 10s, 20s ... capped at 15 minutes. */
export const dispatchBackoffMs = (attempts: number): number => Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));

export interface DispatchResult {
  /** True when THIS caller held the claim and processed the delivery. */
  claimed: boolean;
  state: DeliveryStatus;
  delivery: DeliveryRecord | null;
  /** Outbox rows that are now ENQUEUED / still failing (only when claimed). */
  enqueued: number;
  failed: number;
}

/**
 * Moves one delivery PENDING|FAILED_RETRYABLE|(stale PROCESSING) -> PROCESSING -> QUEUED.
 * Each outbox row is enqueued independently, so a partial failure re-adds only the rows that
 * failed. The delivery is QUEUED only when every row is ENQUEUED.
 */
export async function dispatchDelivery(deps: DispatchDeps, deliveryId: string): Promise<DispatchResult> {
  const now = deps.now ?? (() => new Date());
  const claim = await deps.store.claim(deliveryId, now(), deps.leaseMs ?? DEFAULT_LEASE_MS);
  if (!claim) {
    const current = await deps.store.get(deliveryId);
    return { claimed: false, state: current?.status ?? "PENDING", delivery: current, enqueued: 0, failed: 0 };
  }

  let rows: OutboxRow[];
  try {
    rows = await deps.store.listOutbox(deliveryId);
  } catch (error) {
    await deps.store.finish(deliveryId, { status: "FAILED_RETRYABLE", lastError: sanitizeError(error), retryAt: new Date(now().getTime() + dispatchBackoffMs(claim.attempts)), now: now() });
    return { claimed: true, state: "FAILED_RETRYABLE", delivery: await deps.store.get(deliveryId), enqueued: 0, failed: 0 };
  }

  let enqueued = rows.filter((r) => r.status === "ENQUEUED").length;
  let failed = 0;
  let lastError: string | undefined;
  for (const row of rows) {
    if (row.status === "ENQUEUED") continue;
    try {
      await withTimeout(
        deps.enqueue(
          { repositoryId: row.repositoryId, userId: row.userId, trigger: "github-webhook", ...(row.ref ? { ref: row.ref } : {}), deliveryId },
          row.jobId,
        ),
        enqueueTimeoutMs(),
      );
      await deps.store.markOutboxEnqueued(row.id, now());
      enqueued++;
    } catch (error) {
      failed++;
      lastError = sanitizeError(error);
      // Best effort: a failure to record the failure must not mask it; the lease expiry retries anyway.
      await deps.store.markOutboxFailed(row.id, lastError).catch(() => undefined);
    }
  }

  const max = deps.maxAttempts ?? maxDispatchAttempts();
  const result =
    failed === 0
      ? ({ status: "QUEUED", now: now() } as const)
      : claim.attempts >= max
        ? ({ status: "FAILED_PERMANENT", lastError, now: now() } as const)
        : ({ status: "FAILED_RETRYABLE", lastError, retryAt: new Date(now().getTime() + dispatchBackoffMs(claim.attempts)), now: now() } as const);
  await deps.store.finish(deliveryId, result);
  const delivery = await deps.store.get(deliveryId);
  return { claimed: true, state: delivery?.status ?? result.status, delivery, enqueued, failed };
}
