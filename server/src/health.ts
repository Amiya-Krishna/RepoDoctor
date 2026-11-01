import type { Request, Response } from "express";
import { prisma } from "./config/prisma.js";
import { scanQueue } from "./queue/scan.queue.js";

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

/** Readiness: dependencies the API needs to serve real work. /api/health stays a cheap liveness probe. */
export const readinessHandler = async (_req: Request, res: Response) => {
  const checks: Record<string, "ok" | "fail"> = {};
  await Promise.all([
    withTimeout(prisma.$queryRaw`SELECT 1`, 3000).then(() => { checks.database = "ok"; }, () => { checks.database = "fail"; }),
    withTimeout(scanQueue.waitUntilReady(), 3000).then(() => { checks.redis = "ok"; }, () => { checks.redis = "fail"; }),
  ]);
  const ready = Object.values(checks).every((v) => v === "ok");
  res.status(ready ? 200 : 503).json({ ready, checks });
};
