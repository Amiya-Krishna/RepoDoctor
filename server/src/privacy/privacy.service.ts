import type { AIProvider } from "../ai/ai.provider.js";
import { recordAudit, sanitizeDetails, type AuditEvent } from "../audit/audit.service.js";
import {
  CURRENT_CONSENT_VERSION,
  DEFAULT_PRIVACY_SETTINGS,
  PrivacyPolicyError,
  clampRetentionDays,
  evaluateAIEgress,
  type DataMode,
  type EgressEnvironment,
  type PrivacySettingsView,
} from "./privacy.policy.js";

export interface PrivacyStore {
  get(userId: string): Promise<PrivacySettingsView | null>;
  /**
   * Persists the settings AND their mandatory audit event atomically (one PostgreSQL transaction).
   * If the audit event cannot be stored the settings change is rolled back and this throws.
   */
  saveWithAudit(userId: string, settings: PrivacySettingsView, audit: AuditEvent): Promise<PrivacySettingsView>;
  repositoryOwner(repositoryId: string): Promise<string | null>;
}

export interface PrivacyDeps {
  store: PrivacyStore;
  env: () => EgressEnvironment;
  buildProvider: (request: Parameters<typeof import("../ai/ai.provider.factory.js").createAIProvider>[0]) => AIProvider;
  /** Injectable clock (consent expiry). */
  now?: () => Date;
}

async function prismaStore(): Promise<PrivacyStore> {
  const { prisma } = await import("../config/prisma.js");
  const toView = (row: any): PrivacySettingsView => ({
    dataMode: row.dataMode as DataMode,
    consentVersion: row.consentVersion,
    consentedAt: row.consentedAt,
    retentionDays: row.retentionDays,
    notifyOnCritical: row.notifyOnCritical,
  });
  return {
    async get(userId) {
      const row = await prisma.privacySettings.findUnique({ where: { userId } });
      return row ? toView(row) : null;
    },
    async saveWithAudit(userId, s, audit) {
      const data = {
        dataMode: s.dataMode,
        consentVersion: s.consentVersion,
        consentedAt: s.consentedAt,
        retentionDays: s.retentionDays,
        notifyOnCritical: s.notifyOnCritical,
      };
      const clean = sanitizeDetails(audit.details);
      const row = await prisma.$transaction(async (tx) => {
        const saved = await tx.privacySettings.upsert({ where: { userId }, create: { userId, ...data }, update: data });
        await tx.securityAuditEvent.create({
          data: {
            eventType: audit.eventType,
            outcome: audit.outcome,
            actorId: audit.actorId ?? null,
            repositoryId: audit.repositoryId ?? null,
            repairJobId: audit.repairJobId ?? null,
            details: clean ? JSON.parse(JSON.stringify(clean)) : undefined,
          },
        });
        return saved;
      });
      return toView(row);
    },
    async repositoryOwner(repositoryId) {
      const repo = await prisma.repository.findUnique({ where: { id: repositoryId }, select: { userId: true } });
      return repo?.userId ?? null;
    },
  };
}

async function defaultDeps(): Promise<PrivacyDeps> {
  const [{ createAIProvider }, config] = await Promise.all([
    import("../ai/ai.provider.factory.js"),
    import("../ai/ai.config.js"),
  ]);
  return {
    store: await prismaStore(),
    env: () => ({
      localAiBaseUrl: config.isLocalProviderConfigured() ? process.env.LOCAL_AI_BASE_URL : undefined,
      cloudProvidersConfigured: config.isAnyCloudProviderConfigured(),
      consentMaxAgeDays: process.env.CONSENT_MAX_AGE_DAYS ? Number(process.env.CONSENT_MAX_AGE_DAYS) : undefined,
    }),
    buildProvider: createAIProvider,
  };
}

export async function getPrivacySettings(userId: string, deps?: PrivacyDeps): Promise<PrivacySettingsView> {
  const d = deps ?? (await defaultDeps());
  return (await d.store.get(userId)) ?? DEFAULT_PRIVACY_SETTINGS;
}

export interface PrivacyUpdate {
  dataMode: DataMode;
  /** The user ticked "I understand ..." for exactly this consent version. */
  consent?: boolean;
  consentVersion?: number;
  retentionDays?: number;
  notifyOnCritical?: boolean;
}

export async function updatePrivacySettings(
  userId: string,
  update: PrivacyUpdate,
  deps?: PrivacyDeps,
): Promise<PrivacySettingsView> {
  const d = deps ?? (await defaultDeps());
  if (!["NONE", "CLOUD", "LOCAL"].includes(update.dataMode)) {
    throw new PrivacyPolicyError("Unknown data mode", "NO_MODE_SELECTED", "Choose NONE, CLOUD or LOCAL.");
  }
  const previous = (await d.store.get(userId)) ?? DEFAULT_PRIVACY_SETTINGS;
  const next: PrivacySettingsView = {
    ...previous,
    dataMode: update.dataMode,
    retentionDays: update.retentionDays === undefined ? previous.retentionDays : clampRetentionDays(update.retentionDays),
    notifyOnCritical: update.notifyOnCritical ?? previous.notifyOnCritical,
  };

  if (update.dataMode === "NONE") {
    next.consentVersion = null;
    next.consentedAt = null;
  } else {
    // Consent must be explicit, for the current text, and given in this request:
    // switching mode never silently inherits an older consent.
    if (update.consent !== true) {
      throw new PrivacyPolicyError(
        "Consent is required to enable AI processing.",
        "CONSENT_MISSING",
        "Read the data-processing disclosure and confirm your consent.",
      );
    }
    if (update.consentVersion !== CURRENT_CONSENT_VERSION) {
      throw new PrivacyPolicyError(
        "The consent you confirmed is for an outdated version of the terms.",
        "CONSENT_OUTDATED",
        "Reload the Privacy page and confirm again.",
      );
    }
    next.consentVersion = CURRENT_CONSENT_VERSION;
    next.consentedAt = new Date();
  }

  // Exactly one audit event per successful change; a no-op writes nothing.
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (previous.dataMode !== next.dataMode) changes.dataMode = { from: previous.dataMode, to: next.dataMode };
  if (previous.retentionDays !== next.retentionDays) changes.retentionDays = { from: previous.retentionDays, to: next.retentionDays };
  if (previous.notifyOnCritical !== next.notifyOnCritical) changes.notifyOnCritical = { from: previous.notifyOnCritical, to: next.notifyOnCritical };
  const consentGranted = update.dataMode !== "NONE"; // consent is re-confirmed on every enabling request
  if (Object.keys(changes).length === 0 && !consentGranted) return previous;

  const withdrawn = update.dataMode === "NONE" && previous.dataMode !== "NONE";
  const eventType: AuditEvent["eventType"] = withdrawn
    ? "CONSENT_WITHDRAWN"
    : consentGranted
      ? "CONSENT_GRANTED"
      : changes.dataMode
        ? "PRIVACY_MODE_CHANGED"
        : changes.retentionDays
          ? "RETENTION_CHANGED"
          : "PRIVACY_PREFS_CHANGED";

  const saved = await d.store.saveWithAudit(userId, next, {
    eventType,
    outcome: "SUCCESS",
    actorId: userId,
    details: { changes, consentVersion: next.consentVersion },
  });
  // Consent withdrawn: nothing in flight may continue (checked per request and by the in-flight watchdog).
  return saved;
}

/**
 * The only way application code obtains an AI provider. Fails closed with a
 * PrivacyPolicyError (carrying a recovery hint) unless the repository owner has
 * chosen a data mode and consented to the current terms.
 */
export async function createAIProviderForRepository(
  repositoryId: string,
  deps?: PrivacyDeps,
): Promise<AIProvider> {
  const d = deps ?? (await defaultDeps());
  const userId = await d.store.repositoryOwner(repositoryId);
  if (!userId) {
    throw new PrivacyPolicyError("Repository not found", "NO_MODE_SELECTED", "Reconnect the repository.");
  }
  return createAIProviderForUser(userId, repositoryId, d);
}

export async function createAIProviderForUser(
  userId: string,
  repositoryId: string | undefined,
  deps?: PrivacyDeps,
): Promise<AIProvider> {
  const d = deps ?? (await defaultDeps());
  const now = () => (d.now ? d.now() : new Date());

  /**
   * Reads the user's CURRENT settings (never cached) and throws unless a model request in
   * `expectedMode` is allowed right now. Runs before every model call, during it, and before its
   * result is used. A mode that differs from the one the provider was built for is refused, so a
   * LOCAL user is never served by a CLOUD provider (or the reverse) after a mid-run switch.
   */
  const authorize = async (expectedMode: "CLOUD" | "LOCAL"): Promise<void> => {
    const settings = await d.store.get(userId); // a read failure propagates: the guard fails closed
    const decision = evaluateAIEgress(settings, d.env(), now());
    if (!decision.allowed) {
      await recordAudit({
        eventType: "AI_EGRESS_BLOCKED",
        outcome: "DENIED",
        actorId: userId,
        repositoryId,
        details: { reason: decision.error.code },
      });
      throw decision.error;
    }
    if (decision.mode !== expectedMode) {
      await recordAudit({
        eventType: "AI_EGRESS_BLOCKED",
        outcome: "DENIED",
        actorId: userId,
        repositoryId,
        details: { reason: "MODE_CHANGED", from: expectedMode, to: decision.mode },
      });
      throw new PrivacyPolicyError(
        "Your data-processing mode changed while this job was running, so the request was not sent.",
        "MODE_CHANGED",
        "Start the analysis again under your current privacy settings.",
      );
    }
  };

  // Construction-time check: fail early with a precise error (still re-checked on every request).
  const initial = evaluateAIEgress(await d.store.get(userId), d.env(), now());
  if (!initial.allowed) {
    await recordAudit({
      eventType: "AI_EGRESS_BLOCKED",
      outcome: "DENIED",
      actorId: userId,
      repositoryId,
      details: { reason: initial.error.code },
    });
    throw initial.error;
  }

  return d.buildProvider({
    mode: initial.mode,
    authorize,
    onEgress: (record) =>
      recordAudit(
        {
          eventType: "AI_EGRESS",
          outcome: "SUCCESS",
          actorId: userId,
          repositoryId,
          details: { mode: record.mode, promptSha256: record.promptSha256, promptChars: record.promptChars, redactions: record.redactions },
        },
        { failClosed: true },
      ),
  });
}
