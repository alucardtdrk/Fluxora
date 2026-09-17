import { createGoogleWorkspaceTokenProvider } from "./auth.js";
import { createGoogleWorkspaceClient, type GoogleWorkspaceClient } from "./client.js";
import { collectAlertCenterEvidence } from "./collectors/alertCenter.js";
import { collectDirectoryPosture } from "./collectors/directory.js";
import { collectReportsEvidence } from "./collectors/reports.js";
import { loadGoogleWorkspaceConfig, type GoogleWorkspaceConfig } from "./config.js";
import { googleWorkspaceRepository } from "./repository.js";
import { createWorkspaceSync } from "./sync.js";
import type { WorkspaceSecurityEvent, WorkspaceSecuritySource } from "./types.js";

type ReportApplication = "login" | "admin" | "token" | "drive";
type Repository = Pick<typeof googleWorkspaceRepository, "getSourceState" | "saveSourceBatch" | "saveDirectoryPosture">;

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
  readonly collectDirectory?: typeof collectDirectoryPosture;
  readonly now?: () => Date;
}) {
  const now = input.now ?? (() => new Date());
  const collectAlerts = input.collectAlertCenter ?? collectAlertCenterEvidence;
  const collectReports = input.collectReports ?? collectReportsEvidence;
  const collectDirectory = input.collectDirectory ?? collectDirectoryPosture;

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

  return createWorkspaceSync({
    now,
    sources: [
      eventSource("alert_center"),
      eventSource("login", "login"),
      eventSource("admin", "admin"),
      eventSource("oauth_token", "token"),
      eventSource("drive", "drive"),
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
}

export async function syncGoogleWorkspaceSecurity() {
  const config = loadGoogleWorkspaceConfig();
  const tokenProvider = createGoogleWorkspaceTokenProvider(config);
  const client = createGoogleWorkspaceClient(tokenProvider);
  return createGoogleWorkspaceSecuritySync({ config, client, repository: googleWorkspaceRepository }).run();
}
