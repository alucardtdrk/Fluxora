import type { GoogleWorkspaceClient } from "../client.js";
import {
  normalizeAlertCenterAlert,
  type GoogleAlertCenterAlert,
} from "../normalizers/alertCenter.js";
import type { WorkspaceSecurityEvent } from "../types.js";

const ALERT_CENTER_URL = "https://alertcenter.googleapis.com/v1beta1/alerts";
const DEFAULT_BOOTSTRAP_LOOKBACK_HOURS = 24;
const OVERLAP_MILLISECONDS = 5 * 60 * 1_000;

interface AlertCenterPage {
  readonly alerts?: readonly GoogleAlertCenterAlert[];
  readonly nextPageToken?: string;
}

export interface CollectAlertCenterEvidenceInput {
  readonly client: GoogleWorkspaceClient;
  readonly customerId: string;
  readonly lastSuccessfulEventAt?: Date;
  readonly bootstrapLookbackHours?: number;
  readonly now?: () => Date;
  readonly rangeStart?: Date;
  readonly rangeEnd?: Date;
  readonly startPageToken?: string;
  readonly maxPages?: number;
  readonly pageSize?: number;
}

export interface CollectedAlertCenterEvidence {
  readonly events: readonly WorkspaceSecurityEvent[];
  readonly alertsRead: number;
  readonly nextPageToken?: string;
  readonly truncated: boolean;
}

function collectionStart(input: CollectAlertCenterEvidenceInput, now: Date): Date {
  if (input.lastSuccessfulEventAt) {
    return new Date(input.lastSuccessfulEventAt.getTime() - OVERLAP_MILLISECONDS);
  }

  const lookbackHours = input.bootstrapLookbackHours ?? DEFAULT_BOOTSTRAP_LOOKBACK_HOURS;
  if (!Number.isFinite(lookbackHours) || lookbackHours <= 0) {
    throw new Error("Alert Center bootstrap lookback must be a positive number of hours");
  }
  return new Date(now.getTime() - lookbackHours * 60 * 60 * 1_000);
}

export async function collectAlertCenterEvidence(
  input: CollectAlertCenterEvidenceInput,
): Promise<WorkspaceSecurityEvent[]> {
  return [...(await collectAlertCenterEvidenceBatch(input)).events];
}

export async function collectAlertCenterEvidenceBatch(
  input: CollectAlertCenterEvidenceInput,
): Promise<CollectedAlertCenterEvidence> {
  const observedAt = (input.now ?? (() => new Date()))();
  const start = input.rangeStart ?? collectionStart(input, observedAt);
  const url = new URL(ALERT_CENTER_URL);
  url.searchParams.set("customerId", input.customerId.replace(/^C/, ""));
  url.searchParams.set("pageSize", String(input.pageSize ?? 1000));
  url.searchParams.set("orderBy", "createTime asc");
  url.searchParams.set("filter", `createTime >= "${start.toISOString()}"${input.rangeEnd ? ` AND createTime <= "${input.rangeEnd.toISOString()}"` : ""}`);

  const events: WorkspaceSecurityEvent[] = [];
  let alertsRead = 0;
  let nextPageToken: string | undefined;
  for await (const page of input.client.paginate<AlertCenterPage>(url, { startPageToken: input.startPageToken, maxPages: input.maxPages, onPage: (pageState) => { nextPageToken = pageState.nextPageToken; } })) {
    for (const alert of page.alerts ?? []) {
      alertsRead += 1;
      const event = normalizeAlertCenterAlert(alert, observedAt);
      if (event) events.push(event);
    }
  }
  return { events, alertsRead, nextPageToken, truncated: Boolean(nextPageToken) };
}
