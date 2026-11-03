import { redactSecrets } from "../security/secret-redactor.js";

export type AuditEventType =
  | "AUTH_REGISTER" | "AUTH_LOGIN_FAILED"
  | "GITHUB_CONNECTED" | "GITHUB_DISCONNECTED"
  | "PRIVACY_MODE_CHANGED" | "CONSENT_GRANTED" | "CONSENT_WITHDRAWN"
  | "RETENTION_CHANGED" | "PRIVACY_PREFS_CHANGED" | "DATA_DELETION_REQUESTED"
  | "AI_EGRESS" | "AI_EGRESS_BLOCKED"
  | "WEBHOOK_REJECTED" | "WEBHOOK_REPLAY" | "WEBHOOK_ACCEPTED"
  | "REPAIR_QUEUED" | "REPAIR_REJECTED" | "REPAIR_VERIFIED" | "REPAIR_NOT_VERIFIED"
  | "PATCH_REJECTED"
  | "PR_APPROVED" | "PR_CREATED" | "PR_BLOCKED"
  | "DATA_DELETED" | "RETENTION_PURGE"
  | "AUTHZ_DENIED";

export interface AuditEvent {
  eventType: AuditEventType;
  outcome: "SUCCESS" | "DENIED" | "FAILURE";
  actorId?: string | null;
  repositoryId?: string | null;
  repairJobId?: string | null;
  /** Metadata only. Never put source code, prompts or tokens here. */
  details?: Record<string, unknown>;
}

export interface AuditSink {
  write(event: AuditEvent): Promise<void>;
}

let sink: AuditSink | undefined;

/** Tests and workers inject a sink; production uses the Prisma sink lazily. */
export function setAuditSink(next: AuditSink | undefined) {
  sink = next;
}

async function defaultSink(): Promise<AuditSink> {
  const { prisma } = await import("../config/prisma.js");
  return {
    async write(event) {
      await prisma.securityAuditEvent.create({
        data: {
          eventType: event.eventType,
          outcome: event.outcome,
          actorId: event.actorId ?? null,
          repositoryId: event.repositoryId ?? null,
          repairJobId: event.repairJobId ?? null,
          details: event.details ? JSON.parse(JSON.stringify(event.details)) : undefined,
        },
      });
    },
  };
}

/** Keys that may carry source code, prompts or credentials: never stored in audit details. */
const FORBIDDEN_KEYS = /^(source|sourcecode|code|prompt|content|patch|diff|token|accesstoken|password|secret|authorization|apikey|cookie|body)$/i;

function stripForbidden(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.map((v) => stripForbidden(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !FORBIDDEN_KEYS.test(k))
        .map(([k, v]) => [k, stripForbidden(v, depth + 1)]),
    );
  }
  return value;
}

/** Defence in depth: drop forbidden keys, scrub anything secret-like and cap size before storage. */
export function sanitizeDetails(details: Record<string, unknown> | undefined) {
  if (!details) return undefined;
  const text = redactSecrets(JSON.stringify(stripForbidden(details))).slice(0, 8000);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { truncated: true };
  }
}

/**
 * Records a security-relevant event.
 *
 * `failClosed: true` rethrows when the event cannot be stored, so the caller
 * can refuse the action (used for approvals, consent and egress). Otherwise a
 * storage failure is logged without payload and the request continues.
 */
export async function recordAudit(
  event: AuditEvent,
  options: { failClosed?: boolean } = {},
): Promise<void> {
  const clean: AuditEvent = { ...event, details: sanitizeDetails(event.details) };
  try {
    const target = sink ?? (await defaultSink());
    await target.write(clean);
  } catch (error) {
    console.error("audit write failed", { eventType: event.eventType, reason: error instanceof Error ? error.name : "unknown" });
    if (options.failClosed) throw error;
  }
}
