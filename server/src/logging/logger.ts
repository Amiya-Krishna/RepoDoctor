import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { redactSecrets } from "../security/secret-redactor.js";

type Level = "debug" | "info" | "warn" | "error";

/** One JSON object per line. Messages are scrubbed; callers pass metadata, never source code or prompts. */
export function log(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message: redactSecrets(message).slice(0, 500),
    ...JSON.parse(redactSecrets(JSON.stringify(fields)).slice(0, 4000) || "{}"),
  });
  (level === "error" ? process.stderr : process.stdout).write(line + "\n");
}

/** Request id + access log (method, path WITHOUT query string, status, duration). Bodies are never logged. */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const id = (typeof req.headers["x-request-id"] === "string" && /^[\w-]{8,64}$/.test(req.headers["x-request-id"]))
    ? req.headers["x-request-id"] : randomUUID();
  res.setHeader("x-request-id", id);
  const started = Date.now();
  res.on("finish", () => {
    if (req.path === "/health" || req.path === "/api/health") return;
    log(res.statusCode >= 500 ? "error" : "info", "http_request", {
      requestId: id, method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - started,
    });
  });
  next();
}

/** Baseline response headers for an API that serves JSON only. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.removeHeader("X-Powered-By");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  next();
}
