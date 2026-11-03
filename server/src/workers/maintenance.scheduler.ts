import { prisma } from "../config/prisma.js";
import { recordAudit } from "../audit/audit.service.js";
import { evaluateAIEgress, DEFAULT_PRIVACY_SETTINGS, type PrivacySettingsView } from "../privacy/privacy.policy.js";
import { isAnyCloudProviderConfigured, isLocalProviderConfigured } from "../ai/ai.config.js";
import { queueRepositoryScan } from "../queue/scan.queue.js";
import { isScanDue, scheduledScanJobId, DAY_MS } from "../services/maintenance.js";
import { purgeExpiredData } from "../services/lifecycle.service.js";

const SCAN_INTERVAL_MS = Math.max(1, Number(process.env.AUTO_SCAN_INTERVAL_HOURS ?? 24)) * 60 * 60 * 1000;

/** Enqueues scheduled scans for repositories whose owner opted in AND whose privacy settings permit AI. */
export async function runScheduledScans(now = new Date()): Promise<number> {
  const repositories = await prisma.repository.findMany({
    where: { autoScan: true },
    select: { id: true, userId: true, autoScan: true, lastScheduledScanAt: true, defaultBranch: true, user: { select: { githubAccessToken: true, privacySettings: true } } },
  });

  let queued = 0;
  for (const repo of repositories) {
    if (!isScanDue(repo, now, SCAN_INTERVAL_MS) || !repo.user.githubAccessToken) continue;

    const row = repo.user.privacySettings;
    const settings: PrivacySettingsView = row
      ? {
          dataMode: row.dataMode === "CLOUD" || row.dataMode === "LOCAL" ? row.dataMode : "NONE",
          consentVersion: row.consentVersion,
          consentedAt: row.consentedAt,
          retentionDays: row.retentionDays,
          notifyOnCritical: row.notifyOnCritical,
        }
      : DEFAULT_PRIVACY_SETTINGS;
    const decision = evaluateAIEgress(settings, {
      localAiBaseUrl: isLocalProviderConfigured() ? process.env.LOCAL_AI_BASE_URL : undefined,
      cloudProvidersConfigured: isAnyCloudProviderConfigured(),
      consentMaxAgeDays: process.env.CONSENT_MAX_AGE_DAYS ? Number(process.env.CONSENT_MAX_AGE_DAYS) : undefined,
    });
    if (!decision.allowed) {
      await recordAudit({ eventType: "AI_EGRESS_BLOCKED", outcome: "DENIED", actorId: repo.userId, repositoryId: repo.id, details: { reason: decision.error.code, trigger: "scheduled" } });
      continue;
    }

    await queueRepositoryScan(
      { repositoryId: repo.id, userId: repo.userId, trigger: "scheduled", ref: repo.defaultBranch },
      scheduledScanJobId(repo.id, now, SCAN_INTERVAL_MS),
    );
    await prisma.repository.update({ where: { id: repo.id }, data: { lastScheduledScanAt: now } });
    queued++;
  }
  return queued;
}

/** Starts the hourly scheduler. Returns a stop function for graceful shutdown. */
export function startMaintenanceScheduler(): () => void {
  const tick = async () => {
    try { await runScheduledScans(); } catch (e) { console.error("scheduled scan tick failed", e instanceof Error ? e.name : "unknown"); }
  };
  const purge = async () => {
    try { await purgeExpiredData(); } catch (e) { console.error("retention purge failed", e instanceof Error ? e.name : "unknown"); }
  };
  const a = setInterval(tick, 60 * 60 * 1000);
  const b = setInterval(purge, DAY_MS);
  void tick();
  void purge();
  return () => { clearInterval(a); clearInterval(b); };
}
