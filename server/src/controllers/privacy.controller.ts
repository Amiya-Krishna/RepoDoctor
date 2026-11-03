import type { Request, Response } from "express";
import { DATA_DISCLOSURE, PrivacyPolicyError } from "../privacy/privacy.policy.js";
import { getPrivacySettings, updatePrivacySettings } from "../privacy/privacy.service.js";
import { isAnyCloudProviderConfigured, isLocalProviderConfigured } from "../ai/ai.config.js";
import { deleteAllUserData } from "../services/lifecycle.service.js";
import { prisma } from "../config/prisma.js";

const uid = (req: Request) => (req as any).user.userId as string;

export const getPrivacy = async (req: Request, res: Response) => {
  try {
    const settings = await getPrivacySettings(uid(req));
    return res.json({
      settings,
      disclosure: DATA_DISCLOSURE,
      availability: { cloud: isAnyCloudProviderConfigured(), local: isLocalProviderConfigured() },
    });
  } catch {
    return res.status(500).json({ message: "Unable to load privacy settings" });
  }
};

export const putPrivacy = async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {};
    const settings = await updatePrivacySettings(uid(req), {
      dataMode: b.dataMode,
      consent: b.consent === true,
      consentVersion: typeof b.consentVersion === "number" ? b.consentVersion : undefined,
      retentionDays: b.retentionDays,
      notifyOnCritical: typeof b.notifyOnCritical === "boolean" ? b.notifyOnCritical : undefined,
    });
    return res.json({ settings });
  } catch (error) {
    if (error instanceof PrivacyPolicyError) {
      return res.status(400).json({ message: error.message, code: error.code, recovery: error.recovery });
    }
    return res.status(500).json({ message: "Unable to save privacy settings" });
  }
};

/** DELETE /api/privacy/data  body: { confirm: "DELETE", deleteAccount?: boolean } */
export const deleteMyData = async (req: Request, res: Response) => {
  if (req.body?.confirm !== "DELETE") {
    return res.status(400).json({ message: 'Send {"confirm":"DELETE"} to confirm this irreversible action.' });
  }
  try {
    await deleteAllUserData(uid(req), { deleteAccount: req.body?.deleteAccount === true });
    return res.status(204).send();
  } catch {
    return res.status(500).json({ message: "Deletion failed. Nothing was reported as deleted; try again." });
  }
};

export const listNotifications = async (req: Request, res: Response) => {
  const rows = await prisma.notification.findMany({ where: { userId: uid(req) }, orderBy: { createdAt: "desc" }, take: 50 });
  return res.json({ notifications: rows, unread: rows.filter((n: { readAt: Date | null }) => !n.readAt).length });
};

export const markNotificationsRead = async (req: Request, res: Response) => {
  await prisma.notification.updateMany({ where: { userId: uid(req), readAt: null }, data: { readAt: new Date() } });
  return res.status(204).send();
};

/** GET /api/privacy/audit?limit=&cursor= — the caller's own audit trail only (newest first). */
export const listAuditEvents = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit ?? "50"), 10) || 50));
    const cursor = typeof req.query.cursor === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(req.query.cursor) ? req.query.cursor : undefined;
    const rows = await prisma.securityAuditEvent.findMany({
      where: { actorId: uid(req) }, // never another user's events; there is no parameter to widen this
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, eventType: true, outcome: true, repositoryId: true, repairJobId: true, details: true, createdAt: true },
    });
    const events = rows.slice(0, limit);
    return res.json({ events, nextCursor: rows.length > limit ? events[events.length - 1].id : null });
  } catch {
    return res.status(500).json({ message: "Unable to load audit history" });
  }
};
