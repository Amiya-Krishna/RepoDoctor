import type { AIProvider } from "../ai/ai.provider.js";
import { recordAudit } from "../audit/audit.service.js";
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
  save(userId: string, settings: PrivacySettingsView): Promise<PrivacySettingsView>;
  repositoryOwner(repositoryId: string): Promise<string | null>;
}

export interface PrivacyDeps {
  store: PrivacyStore;
  env: () => EgressEnvironment;
  buildProvider: (request: {
    mode: "CLOUD" | "LOCAL";
    onEgress: Parameters<typeof import("../ai/ai.provider.factory.js").createAIProvider>[0]["onEgress"];
  }) => AIProvider;
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
    async save(userId, s) {
      const data = {
        dataMode: s.dataMode,
        consentVersion: s.consentVersion,
        consentedAt: s.consentedAt,
        retentionDays: s.retentionDays,
        notifyOnCritical: s.notifyOnCritical,
      };
      return toView(await prisma.privacySettings.upsert({ where: { userId }, create: { userId, ...data }, update: data }));
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

  const saved = await d.store.save(userId, next);
  const withdrawn = update.dataMode === "NONE" && previous.dataMode !== "NONE";
  await recordAudit(
    {
      eventType: withdrawn ? "CONSENT_WITHDRAWN" : update.dataMode === "NONE" ? "PRIVACY_MODE_CHANGED" : "CONSENT_GRANTED",
      outcome: "SUCCESS",
      actorId: userId,
      details: { from: previous.dataMode, to: saved.dataMode, consentVersion: saved.consentVersion, retentionDays: saved.retentionDays },
    },
    { failClosed: true },
  );
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
  const settings = await d.store.get(userId);
  const decision = evaluateAIEgress(settings, d.env());

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

  return d.buildProvider({
    mode: decision.mode,
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
