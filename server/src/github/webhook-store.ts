import { redactSecrets } from "../security/secret-redactor.js";

/**
 * Durable webhook lifecycle:
 *   PENDING -> PROCESSING -> QUEUED
 *   PROCESSING -> FAILED_RETRYABLE -> (claimed again) PROCESSING ...
 *   FAILED_RETRYABLE -> FAILED_PERMANENT after the attempt budget is spent
 * IGNORED        authentic but nothing to do (stored so replays are acknowledged)
 * LEGACY_CLAIMED written by the pre-lifecycle code; terminal, never resumed
 */
export type DeliveryStatus =
  | "PENDING" | "PROCESSING" | "QUEUED" | "FAILED_RETRYABLE" | "FAILED_PERMANENT" | "IGNORED" | "LEGACY_CLAIMED";

export type OutboxStatus = "PENDING" | "ENQUEUED" | "FAILED_RETRYABLE";

export const TERMINAL_STATUSES: DeliveryStatus[] = ["QUEUED", "IGNORED", "FAILED_PERMANENT", "LEGACY_CLAIMED"];

export interface DeliveryRecord {
  deliveryId: string;
  event: string;
  status: DeliveryStatus;
  attempts: number;
  /** PROCESSING: lease expiry. FAILED_RETRYABLE: earliest retry time (backoff). */
  lockedUntil: Date | null;
  lastError: string | null;
  githubRepositoryId: string | null;
  ref: string | null;
  receivedAt: Date;
}

export interface OutboxRow {
  id: string;
  deliveryId: string;
  repositoryId: string;
  userId: string;
  ref: string | null;
  jobId: string;
  status: OutboxStatus;
  attempts: number;
}

export interface OutboxPlan {
  repositoryId: string;
  userId: string;
  ref?: string | null;
  jobId: string;
}

export interface RecordInput {
  deliveryId: string;
  event: string;
  status: "PENDING" | "IGNORED";
  githubRepositoryId?: string | null;
  ref?: string | null;
  /** Why an IGNORED delivery needs no work (kept in lastError for operators). */
  note?: string;
  outbox?: OutboxPlan[];
}

export interface WebhookStore {
  /** Atomically persists the delivery and its outbox rows. created=false if the id already existed (nothing written). */
  record(input: RecordInput): Promise<{ created: boolean; delivery: DeliveryRecord }>;
  get(deliveryId: string): Promise<DeliveryRecord | null>;
  /**
   * Compare-and-set claim. Succeeds for exactly one caller when the delivery is PENDING, FAILED_RETRYABLE past its
   * backoff, or PROCESSING with an expired lease. Sets PROCESSING, lease, attempts+1.
   */
  claim(deliveryId: string, now: Date, leaseMs: number): Promise<DeliveryRecord | null>;
  /** Deliveries a sweep may try to claim right now (oldest first). */
  findRecoverable(now: Date, limit: number): Promise<string[]>;
  listOutbox(deliveryId: string): Promise<OutboxRow[]>;
  markOutboxEnqueued(id: string, now: Date): Promise<void>;
  markOutboxFailed(id: string, error: string): Promise<void>;
  /** Only the current claim holder (status PROCESSING) may finish a delivery. Returns false if it no longer holds it. */
  finish(
    deliveryId: string,
    result: { status: "QUEUED" | "FAILED_RETRYABLE" | "FAILED_PERMANENT"; lastError?: string | null; retryAt?: Date | null; now: Date },
  ): Promise<boolean>;
  /** Deletes TERMINAL deliveries (and, by cascade, their outbox) received before `cutoff`. Never touches in-flight/retryable ones. */
  purgeTerminal(cutoff: Date): Promise<number>;
}

/** Errors are stored for operators: secret-scrubbed and short. */
export const sanitizeError = (error: unknown): string => {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return redactSecrets(raw).slice(0, 300);
};

// ---------------------------------------------------------------------------
// Prisma implementation
// ---------------------------------------------------------------------------

type Row = {
  deliveryId: string; event: string; status: string; attempts: number; lockedUntil: Date | null; lastError: string | null;
  githubRepositoryId: string | null; ref: string | null; receivedAt: Date;
};
const toDelivery = (r: Row): DeliveryRecord => ({ ...r, status: r.status as DeliveryStatus });

export function createPrismaWebhookStore(getPrisma?: () => Promise<any>): WebhookStore {
  const db = getPrisma ?? (async () => (await import("../config/prisma.js")).prisma);

  return {
    async record(input) {
      const prisma = await db();
      return prisma.$transaction(async (tx: any) => {
        // createMany + skipDuplicates is ON CONFLICT DO NOTHING: the unique id is the atomic claim and a
        // conflict does not poison the transaction.
        const inserted = await tx.webhookDelivery.createMany({
          data: [{
            deliveryId: input.deliveryId, event: input.event, status: input.status,
            githubRepositoryId: input.githubRepositoryId ?? null, ref: input.ref ?? null,
            lastError: input.note ?? null,
            ...(input.status === "IGNORED" ? { completedAt: new Date() } : {}),
          }],
          skipDuplicates: true,
        });
        const created = inserted.count === 1;
        if (created && input.outbox?.length) {
          await tx.webhookScanOutbox.createMany({
            data: input.outbox.map((o) => ({
              deliveryId: input.deliveryId, repositoryId: o.repositoryId, userId: o.userId, ref: o.ref ?? null, jobId: o.jobId,
            })),
            skipDuplicates: true,
          });
        }
        const row = await tx.webhookDelivery.findUniqueOrThrow({ where: { deliveryId: input.deliveryId } });
        return { created, delivery: toDelivery(row) };
      });
    },

    async get(deliveryId) {
      const prisma = await db();
      const row = await prisma.webhookDelivery.findUnique({ where: { deliveryId } });
      return row ? toDelivery(row) : null;
    },

    async claim(deliveryId, now, leaseMs) {
      const prisma = await db();
      const res = await prisma.webhookDelivery.updateMany({
        where: {
          deliveryId,
          OR: [
            { status: "PENDING" },
            { status: "FAILED_RETRYABLE", OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
            { status: "PROCESSING", lockedUntil: { lte: now } },
          ],
        },
        data: { status: "PROCESSING", lockedUntil: new Date(now.getTime() + leaseMs), attempts: { increment: 1 }, updatedAt: now },
      });
      if (res.count !== 1) return null;
      const row = await prisma.webhookDelivery.findUnique({ where: { deliveryId } });
      return row ? toDelivery(row) : null;
    },

    async findRecoverable(now, limit) {
      const prisma = await db();
      const rows = await prisma.webhookDelivery.findMany({
        where: {
          OR: [
            { status: "PENDING" },
            { status: "FAILED_RETRYABLE", OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
            { status: "PROCESSING", lockedUntil: { lte: now } },
          ],
        },
        orderBy: { receivedAt: "asc" },
        take: limit,
        select: { deliveryId: true },
      });
      return rows.map((r: { deliveryId: string }) => r.deliveryId);
    },

    async listOutbox(deliveryId) {
      const prisma = await db();
      const rows = await prisma.webhookScanOutbox.findMany({ where: { deliveryId }, orderBy: { createdAt: "asc" } });
      return rows as OutboxRow[];
    },

    async markOutboxEnqueued(id, now) {
      const prisma = await db();
      await prisma.webhookScanOutbox.update({
        where: { id }, data: { status: "ENQUEUED", enqueuedAt: now, attempts: { increment: 1 }, lastError: null },
      });
    },

    async markOutboxFailed(id, error) {
      const prisma = await db();
      await prisma.webhookScanOutbox.update({
        where: { id }, data: { status: "FAILED_RETRYABLE", attempts: { increment: 1 }, lastError: error.slice(0, 300) },
      });
    },

    async finish(deliveryId, result) {
      const prisma = await db();
      const res = await prisma.webhookDelivery.updateMany({
        where: { deliveryId, status: "PROCESSING" },
        data: {
          status: result.status,
          lastError: result.lastError ?? null,
          lockedUntil: result.status === "FAILED_RETRYABLE" ? (result.retryAt ?? null) : null,
          completedAt: result.status === "FAILED_RETRYABLE" ? null : result.now,
          updatedAt: result.now,
        },
      });
      return res.count === 1;
    },

    async purgeTerminal(cutoff) {
      const prisma = await db();
      const res = await prisma.webhookDelivery.deleteMany({
        where: { receivedAt: { lt: cutoff }, status: { in: TERMINAL_STATUSES } },
      });
      return res.count;
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory implementation (unit tests). Single-threaded JS makes each method atomic.
// ---------------------------------------------------------------------------

export function createMemoryWebhookStore() {
  const deliveries = new Map<string, DeliveryRecord>();
  const outbox = new Map<string, OutboxRow>();
  let seq = 0;

  const claimable = (d: DeliveryRecord, now: Date) =>
    d.status === "PENDING"
    || (d.status === "FAILED_RETRYABLE" && (!d.lockedUntil || d.lockedUntil <= now))
    || (d.status === "PROCESSING" && !!d.lockedUntil && d.lockedUntil <= now);

  const store: WebhookStore & { deliveries: Map<string, DeliveryRecord>; outbox: Map<string, OutboxRow> } = {
    deliveries, outbox,
    async record(input) {
      const existing = deliveries.get(input.deliveryId);
      if (existing) return { created: false, delivery: { ...existing } };
      const d: DeliveryRecord = {
        deliveryId: input.deliveryId, event: input.event, status: input.status, attempts: 0, lockedUntil: null,
        lastError: input.note ?? null, githubRepositoryId: input.githubRepositoryId ?? null, ref: input.ref ?? null, receivedAt: new Date(),
      };
      deliveries.set(d.deliveryId, d);
      for (const o of input.outbox ?? []) {
        const id = `ob${++seq}`;
        outbox.set(id, { id, deliveryId: d.deliveryId, repositoryId: o.repositoryId, userId: o.userId, ref: o.ref ?? null, jobId: o.jobId, status: "PENDING", attempts: 0 });
      }
      return { created: true, delivery: { ...d } };
    },
    async get(id) { const d = deliveries.get(id); return d ? { ...d } : null; },
    async claim(id, now, leaseMs) {
      const d = deliveries.get(id);
      if (!d || !claimable(d, now)) return null;
      d.status = "PROCESSING"; d.lockedUntil = new Date(now.getTime() + leaseMs); d.attempts += 1;
      return { ...d };
    },
    async findRecoverable(now, limit) {
      return [...deliveries.values()].filter((d) => claimable(d, now)).sort((a, b) => +a.receivedAt - +b.receivedAt).slice(0, limit).map((d) => d.deliveryId);
    },
    async listOutbox(id) { return [...outbox.values()].filter((o) => o.deliveryId === id).map((o) => ({ ...o })); },
    async markOutboxEnqueued(id) { const o = outbox.get(id)!; o.status = "ENQUEUED"; o.attempts += 1; },
    async markOutboxFailed(id) { const o = outbox.get(id)!; o.status = "FAILED_RETRYABLE"; o.attempts += 1; },
    async finish(id, r) {
      const d = deliveries.get(id);
      if (!d || d.status !== "PROCESSING") return false;
      d.status = r.status; d.lastError = r.lastError ?? null; d.lockedUntil = r.status === "FAILED_RETRYABLE" ? (r.retryAt ?? null) : null;
      return true;
    },
    async purgeTerminal(cutoff) {
      let n = 0;
      for (const d of [...deliveries.values()]) {
        if (d.receivedAt < cutoff && TERMINAL_STATUSES.includes(d.status)) {
          deliveries.delete(d.deliveryId);
          for (const [k, o] of outbox) if (o.deliveryId === d.deliveryId) outbox.delete(k);
          n++;
        }
      }
      return n;
    },
  };
  return store;
}

export const prismaWebhookStore: WebhookStore = createPrismaWebhookStore();

/** Retention for replay protection: ids are kept this long (days) once terminal. */
export const webhookRetentionDays = (): number => {
  const n = Number(process.env.WEBHOOK_RETENTION_DAYS ?? 30);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 30;
};

/** Wire into the daily purge. Removes only terminal deliveries; PENDING/PROCESSING/FAILED_RETRYABLE are never deleted. */
export async function purgeOldWebhookDeliveries(now = new Date(), store: WebhookStore = prismaWebhookStore): Promise<number> {
  return store.purgeTerminal(new Date(now.getTime() - webhookRetentionDays() * 86_400_000));
}
