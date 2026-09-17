import type { GoogleWorkspaceClient } from "../client.js";
import {
  normalizeReportsActivity,
  type GoogleReportsActivity,
  type ReportsApplicationName,
} from "../normalizers/reports.js";
import type { WorkspaceSecurityEvent } from "../types.js";

const REPORTS_BASE_URL = "https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications";
const ALLOWED_APPLICATIONS = new Set<ReportsApplicationName>(["login", "admin", "token", "drive"]);
const OVERLAP_MILLISECONDS = 5 * 60 * 1_000;
const DEFAULT_BOOTSTRAP_LOOKBACK_HOURS = 24;

interface ReportsPage {
  readonly items?: readonly GoogleReportsActivity[];
  readonly nextPageToken?: string;
}

export interface CollectReportsEvidenceInput {
  readonly client: GoogleWorkspaceClient;
  readonly application: ReportsApplicationName;
  readonly customerId: string;
  readonly lastSuccessfulEventAt?: Date;
  readonly now?: () => Date;
}

function startTime(lastSuccessfulEventAt: Date | undefined, now: Date): Date {
  if (lastSuccessfulEventAt) return new Date(lastSuccessfulEventAt.getTime() - OVERLAP_MILLISECONDS);
  return new Date(now.getTime() - DEFAULT_BOOTSTRAP_LOOKBACK_HOURS * 60 * 60 * 1_000);
}

export async function collectReportsEvidence(input: CollectReportsEvidenceInput): Promise<WorkspaceSecurityEvent[]> {
  if (!ALLOWED_APPLICATIONS.has(input.application)) {
    throw new Error(`Unsupported Reports application: ${input.application}`);
  }

  const observedAt = (input.now ?? (() => new Date()))();
  const url = new URL(`${REPORTS_BASE_URL}/${encodeURIComponent(input.application)}`);
  url.searchParams.set("customerId", input.customerId);
  url.searchParams.set("startTime", startTime(input.lastSuccessfulEventAt, observedAt).toISOString());
  url.searchParams.set("endTime", observedAt.toISOString());
  url.searchParams.set("maxResults", "1000");

  const events: WorkspaceSecurityEvent[] = [];
  for await (const page of input.client.paginate<ReportsPage>(url, { pageTokenQueryKey: "pageToken" })) {
    for (const activity of page.items ?? []) {
      events.push(...normalizeReportsActivity(input.application, activity, observedAt));
    }
  }
  return events;
}
