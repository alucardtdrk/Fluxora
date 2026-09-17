import { getFirestoreDocument, isFirestoreConfigured, runFirestoreQuery, type FirestoreRecord } from "../firestore.js";
import {
  WORKSPACE_DIRECTORY_POSTURE_COLLECTION,
  WORKSPACE_SECURITY_EVENTS_COLLECTION,
} from "./repository.js";
import type { SecuritySeverity, WorkspaceSecuritySource } from "./types.js";

export interface WorkspaceDashboardEvent {
  readonly id: string;
  readonly externalId?: string;
  readonly source: WorkspaceSecuritySource;
  readonly category: string;
  readonly type: string;
  readonly severity: SecuritySeverity;
  readonly title: string;
  readonly description: string;
  readonly occurredAt: string;
  readonly actor?: string;
  readonly target?: string;
  readonly ipAddress?: string;
  readonly country?: string;
}

export interface WorkspaceSecurityDashboard {
  readonly events: readonly WorkspaceDashboardEvent[];
  readonly summary: { readonly recentEvents: number; readonly highOrCriticalEvents: number };
  readonly posture: { readonly suspendedUsers: number; readonly usersWithoutTwoStepVerification: number } | null;
}

type DashboardDependencies = {
  readonly listEvents: () => Promise<readonly FirestoreRecord[]>;
  readonly getPosture: () => Promise<FirestoreRecord | null>;
};

const EMPTY_DASHBOARD: WorkspaceSecurityDashboard = {
  events: [],
  summary: { recentEvents: 0, highOrCriticalEvents: 0 },
  posture: null,
};

function stringValue(value: unknown): string | undefined {
  const valueAsString = typeof value === "string" ? value.trim() : "";
  return valueAsString || undefined;
}

function dateValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value || ""));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date(0).toISOString();
}

function dashboardEvent(record: FirestoreRecord): WorkspaceDashboardEvent {
  return {
    id: stringValue(record.id) ?? stringValue(record._documentId) ?? "",
    externalId: stringValue(record.externalId),
    source: String(record.source || "alert_center") as WorkspaceSecuritySource,
    category: String(record.category || "workspace_security"),
    type: String(record.type || "unknown"),
    severity: String(record.severity || "informational") as SecuritySeverity,
    title: String(record.title || "Evento do Google Workspace"),
    description: String(record.description || ""),
    occurredAt: dateValue(record.occurredAt),
    actor: stringValue(record.actor),
    target: stringValue(record.target),
    ipAddress: stringValue(record.ipAddress),
    country: stringValue(record.country),
  };
}

function dashboardPosture(record: FirestoreRecord | null): WorkspaceSecurityDashboard["posture"] {
  if (!record) return null;
  const users = record.users as FirestoreRecord | undefined;
  return {
    suspendedUsers: Number(users?.suspended || 0),
    usersWithoutTwoStepVerification: Number(users?.withoutTwoStepVerification || 0),
  };
}

export function createWorkspaceSecurityDashboard(dependencies: DashboardDependencies) {
  return {
    async load(): Promise<WorkspaceSecurityDashboard> {
      const [records, posture] = await Promise.all([dependencies.listEvents(), dependencies.getPosture()]);
      const events = records.map(dashboardEvent).filter((event) => Boolean(event.id));
      return {
        events,
        summary: {
          recentEvents: events.length,
          highOrCriticalEvents: events.filter((event) => event.severity === "high" || event.severity === "critical").length,
        },
        posture: dashboardPosture(posture),
      };
    },
  };
}

async function listWorkspaceEvents(): Promise<readonly FirestoreRecord[]> {
  return runFirestoreQuery({
    select: { fields: ["externalId", "source", "category", "type", "severity", "title", "description", "occurredAt", "actor", "target", "ipAddress", "country"].map((fieldPath) => ({ fieldPath })) },
    from: [{ collectionId: WORKSPACE_SECURITY_EVENTS_COLLECTION }],
    orderBy: [{ field: { fieldPath: "occurredAt" }, direction: "DESCENDING" }],
    limit: 250,
  });
}

export async function getWorkspaceSecurityDashboard(): Promise<WorkspaceSecurityDashboard> {
  if (!isFirestoreConfigured()) return EMPTY_DASHBOARD;
  return createWorkspaceSecurityDashboard({
    listEvents: listWorkspaceEvents,
    getPosture: () => getFirestoreDocument(WORKSPACE_DIRECTORY_POSTURE_COLLECTION, "current"),
  }).load();
}
