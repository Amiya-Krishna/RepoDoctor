import { prisma } from "../config/prisma.js";

export type NotificationType =
  | "SCAN_COMPLETED" | "CRITICAL_FINDING" | "REPAIR_VERIFIED" | "REPAIR_FAILED"
  | "REPAIR_INCONCLUSIVE" | "PR_CREATED" | "PRIVACY_BLOCKED" | "JOB_INTERRUPTED";

export interface NewNotification {
  userId: string;
  type: NotificationType;
  severity?: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  /** Human-readable, with a recovery suggestion where something went wrong. Never contains code or secrets. */
  message: string;
  repositoryId?: string;
}

export async function notifyUser(n: NewNotification): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId: n.userId,
        type: n.type,
        severity: n.severity ?? "INFO",
        title: n.title.slice(0, 200),
        message: n.message.slice(0, 1000),
        repositoryId: n.repositoryId,
      },
    });
  } catch (error) {
    // A notification must never fail the job that produced it.
    console.warn("notification write failed", error instanceof Error ? error.name : "unknown");
  }
}
