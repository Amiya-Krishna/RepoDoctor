import { dispatchDelivery, type DispatchDeps } from "./webhook-dispatcher.js";

/**
 * Finishes deliveries that were accepted (durably recorded) but never fully queued: a Redis outage,
 * a worker that crashed after the DB commit, or a lease that expired. Safe to run from several
 * processes at once: the claim is a compare-and-set and the BullMQ job ids are deterministic.
 */
export async function recoverWebhookDeliveries(deps: DispatchDeps & { limit?: number }): Promise<{ examined: number; queued: number; stillPending: number }> {
  const now = deps.now ?? (() => new Date());
  const ids = await deps.store.findRecoverable(now(), deps.limit ?? 50);
  let queued = 0;
  let stillPending = 0;
  for (const id of ids) {
    const r = await dispatchDelivery(deps, id);
    if (r.claimed) (r.state === "QUEUED" ? queued++ : stillPending++);
  }
  return { examined: ids.length, queued, stillPending };
}

/** Starts the periodic sweep. Returns a stop function. Wire this into the scan worker. */
export async function startWebhookRecoveryLoop(intervalMs = 30_000): Promise<() => void> {
  const [{ prismaWebhookStore }, { queueRepositoryScan }] = await Promise.all([import("./webhook-store.js"), import("../queue/scan.queue.js")]);
  const deps: DispatchDeps = { store: prismaWebhookStore, enqueue: (data, jobId) => queueRepositoryScan(data, jobId) };
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await recoverWebhookDeliveries(deps);
      if (r.examined) console.log("webhook recovery", r);
    } catch (error) {
      console.error("webhook recovery failed", error instanceof Error ? error.name : "unknown");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
}
