import { createGoogleWorkspaceTokenProvider } from "./auth.js";
import { createGoogleWorkspaceClient, type GoogleWorkspaceClient } from "./client.js";
import { collectAlertCenterEvidence } from "./collectors/alertCenter.js";
import { collectDirectoryPosture } from "./collectors/directory.js";
import { collectReportsEvidence, collectReportsEvidenceBatch } from "./collectors/reports.js";
import { loadGoogleWorkspaceConfig, type GoogleWorkspaceConfig } from "./config.js";
import { googleWorkspaceRepository } from "./repository.js";
import { createWorkspaceSync } from "./sync.js";
import { CORRELATION_WINDOW_MS, correlateWorkspaceSecurityEvents } from "./correlation.js";
import type { WorkspaceSecurityEvent, WorkspaceSecuritySource } from "./types.js";
import { planWorkspaceBackfillWindow, WORKSPACE_BACKFILL_DAYS } from "./backfill.js";

type ReportApplication = "login" | "admin" | "token" | "drive" | "groups" | "mobile" | "rules" | "gmail" | "user_accounts" | "saml" | "calendar" | "chat" | "meet";
type Repository = Pick<typeof googleWorkspaceRepository, "getSourceState" | "saveSourceBatch" | "saveDirectoryPosture" | "listRecentEvents" | "saveFindings"> & Partial<Pick<typeof googleWorkspaceRepository, "saveSourceDiagnostics">>;

function latestEventAt(events: readonly WorkspaceSecurityEvent[]): string | undefined {
  const latest = events.reduce<Date | null>((current, event) =>
    !current || event.occurredAt > current ? event.occurredAt : current, null);
  return latest?.toISOString();
}

export function createGoogleWorkspaceSecuritySync(input: {
  readonly config: Pick<GoogleWorkspaceConfig, "customerId" | "domain">;
  readonly client: GoogleWorkspaceClient;
  readonly repository: Repository;
  readonly collectAlertCenter?: typeof collectAlertCenterEvidence;
  readonly collectReports?: typeof collectReportsEvidence;
  readonly collectReportsBatch?: typeof collectReportsEvidenceBatch;
  readonly collectDirectory?: typeof collectDirectoryPosture;
  readonly correlate?: typeof correlateWorkspaceSecurityEvents;
  readonly now?: () => Date;
  readonly enableBackfill?: boolean;
  readonly maxBackfillWindows?: number;
}) {
  const now = input.now ?? (() => new Date());
  const collectAlerts = input.collectAlertCenter ?? collectAlertCenterEvidence;
  const collectReports = input.collectReports ?? collectReportsEvidence;
  const collectReportsBatch = input.collectReportsBatch ?? collectReportsEvidenceBatch;
  const collectDirectory = input.collectDirectory ?? collectDirectoryPosture;
  const correlate = input.correlate ?? correlateWorkspaceSecurityEvents;

  const eventSource = (source: WorkspaceSecuritySource, application?: ReportApplication) => ({
    name: source,
    run: async () => {
      const attemptedAt = now();
      const state = await input.repository.getSourceState(source) ?? { lastSuccessfulEventAt: null };
      const events = application
        ? await collectReports({ client: input.client, application, customerId: input.config.customerId, lastSuccessfulEventAt: state.lastSuccessfulEventAt ?? undefined, now })
        : await collectAlerts({ client: input.client, customerId: input.config.customerId, lastSuccessfulEventAt: state.lastSuccessfulEventAt ?? undefined, now });
      const saved = await input.repository.saveSourceBatch({
        source,
        events,
        lastSuccessfulEventAt: latestEventAt(events) ?? state.lastSuccessfulEventAt?.toISOString(),
        attemptedAt: attemptedAt.toISOString(),
      });
      return { collected: events.length, persisted: saved.insertedOrUpdated };
    },
  });

  const sourceSync = createWorkspaceSync({
    now,
    sources: [
      eventSource("alert_center"),
      eventSource("login", "login"),
      eventSource("admin", "admin"),
      eventSource("oauth_token", "token"),
      eventSource("drive", "drive"),
      eventSource("groups", "groups"),
      eventSource("mobile", "mobile"),
      eventSource("rules", "rules"),
      eventSource("gmail", "gmail"),
      eventSource("user_accounts", "user_accounts"),
      eventSource("saml", "saml"),
      eventSource("calendar", "calendar"),
      eventSource("chat", "chat"),
      eventSource("meet", "meet"),
      {
        name: "directory_posture",
        run: async () => {
          const posture = await collectDirectory({ client: input.client, customerId: input.config.customerId, domain: input.config.domain, capturedAt: now() });
          await input.repository.saveDirectoryPosture({ ...posture, id: "current" });
          return { collected: 1, persisted: 1 };
        },
      },
    ],
  });

  const continueBackfill = async () => {
    const backfill = { windowsProcessed: 0, failedSources: [] as WorkspaceSecuritySource[], targetDays: WORKSPACE_BACKFILL_DAYS };
    const deadline = Date.now() + 240_000;
    const reportSources: ReadonlyArray<{ source: WorkspaceSecuritySource; application: ReportApplication }> = [
      { source: "login", application: "login" }, { source: "admin", application: "admin" }, { source: "oauth_token", application: "token" }, { source: "drive", application: "drive" }, { source: "groups", application: "groups" }, { source: "mobile", application: "mobile" }, { source: "rules", application: "rules" }, { source: "gmail", application: "gmail" }, { source: "user_accounts", application: "user_accounts" }, { source: "saml", application: "saml" }, { source: "calendar", application: "calendar" }, { source: "chat", application: "chat" }, { source: "meet", application: "meet" },
    ];
    for (const item of reportSources) {
      if (backfill.windowsProcessed >= (input.maxBackfillWindows ?? 4) || Date.now() >= deadline) break;
      const state = await input.repository.getSourceState(item.source);
      const targetEnd = state?.backfillTargetEnd ?? now();
      const targetStart = state?.backfillTargetStart ?? new Date(targetEnd.getTime() - WORKSPACE_BACKFILL_DAYS * 24 * 60 * 60 * 1_000);
      const window = planWorkspaceBackfillWindow({ targetStart, targetEnd, coveredThrough: state?.backfillCoveredThrough ?? undefined });
      if (window.start >= targetEnd) continue;
      try {
        const collected = await collectReportsBatch({ client: input.client, application: item.application, customerId: input.config.customerId, rangeStart: window.start, rangeEnd: window.end, startPageToken: state?.backfillPageToken ?? undefined, maxPages: 2, now });
        const saved = await input.repository.saveSourceBatch({ source: item.source, events: collected.events, attemptedAt: now().toISOString(), lastSuccessfulEventAt: state?.lastSuccessfulEventAt?.toISOString(), backfill: { targetStart: targetStart.toISOString(), targetEnd: targetEnd.toISOString(), coveredThrough: (collected.truncated ? window.start : window.end).toISOString(), pageToken: collected.nextPageToken } });
        await input.repository.saveSourceDiagnostics?.(item.source, { status: collected.events.length ? "ok" : "empty", collected: collected.events.length, persisted: saved.insertedOrUpdated, completedAt: now().toISOString() });
        backfill.windowsProcessed += 1;
      } catch {
        backfill.failedSources.push(item.source);
        await input.repository.saveSourceDiagnostics?.(item.source, { status: "failure", collected: 0, persisted: 0, safeError: "unknown", completedAt: now().toISOString() });
      }
    }
    return backfill;
  };

  return {
    continueBackfill,
    async run() {
      const summary = await sourceSync.run();
      await Promise.all(Object.entries(summary.sources).filter(([source]) => source !== "directory_posture").map(([source, status]) => input.repository.saveSourceDiagnostics?.(source as WorkspaceSecuritySource, { status: status.status, collected: status.collected, persisted: status.persisted, safeError: status.safeError, completedAt: summary.finishedAt })));
      const backfill = input.enableBackfill ? await continueBackfill() : { windowsProcessed: 0, failedSources: [], targetDays: WORKSPACE_BACKFILL_DAYS };
      try {
        const events = await input.repository.listRecentEvents(new Date(now().getTime() - CORRELATION_WINDOW_MS));
        const findings = correlate(events, now());
        const saved = await input.repository.saveFindings(findings);
        return { ...summary, backfill, findings: { generated: findings.length, persisted: saved.insertedOrUpdated } };
      } catch {
        return { ...summary, backfill, findings: { generated: 0, persisted: 0, safeError: "correlation" as const } };
      }
    },
  };
}

export async function syncGoogleWorkspaceSecurity() {
  const config = loadGoogleWorkspaceConfig();
  const tokenProvider = createGoogleWorkspaceTokenProvider(config);
  const client = createGoogleWorkspaceClient(tokenProvider);
  return createGoogleWorkspaceSecuritySync({ config, client, repository: googleWorkspaceRepository, enableBackfill: true }).run();
}

export async function continueGoogleWorkspaceSecurityBackfill() {
  const config = loadGoogleWorkspaceConfig();
  const tokenProvider = createGoogleWorkspaceTokenProvider(config);
  const client = createGoogleWorkspaceClient(tokenProvider);
  return createGoogleWorkspaceSecuritySync({ config, client, repository: googleWorkspaceRepository }).continueBackfill();
}
