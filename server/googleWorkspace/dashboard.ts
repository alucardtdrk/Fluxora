import { getFirestoreDocument, isFirestoreConfigured, runFirestoreQuery, type FirestoreRecord } from "../firestore.js";
import {
  WORKSPACE_DIRECTORY_POSTURE_COLLECTION,
  WORKSPACE_SECURITY_FINDINGS_COLLECTION,
  WORKSPACE_SECURITY_EVENTS_COLLECTION,
  WORKSPACE_SYNC_STATE_COLLECTION,
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
  readonly findings: readonly WorkspaceDashboardFinding[];
  readonly summary: { readonly recentEvents: number; readonly highOrCriticalEvents: number; readonly openFindings: number };
  readonly posture: { readonly suspendedUsers: number; readonly usersWithoutTwoStepVerification: number } | null;
  readonly sources: readonly { readonly source: string; readonly status: string; readonly collected: number; readonly persisted: number; readonly completedAt?: string; readonly safeError?: string }[];
}

export interface WorkspaceDashboardFinding {
  readonly id: string;
  readonly rule: string;
  readonly severity: SecuritySeverity;
  readonly title: string;
  readonly description: string;
  readonly subjects: readonly string[];
  readonly ipAddresses: readonly string[];
  readonly eventIds: readonly string[];
  readonly firstOccurredAt: string;
  readonly lastOccurredAt: string;
  readonly evidenceCount: number;
}

type DashboardDependencies = {
  readonly listEvents: () => Promise<readonly FirestoreRecord[]>;
  readonly listFindings: () => Promise<readonly FirestoreRecord[]>;
  readonly getPosture: () => Promise<FirestoreRecord | null>;
  readonly listSources?: () => Promise<readonly FirestoreRecord[]>;
};

const EMPTY_DASHBOARD: WorkspaceSecurityDashboard = {
  events: [],
  findings: [],
  summary: { recentEvents: 0, highOrCriticalEvents: 0, openFindings: 0 },
  posture: null,
  sources: [],
};

function stringValue(value: unknown): string | undefined {
  const valueAsString = typeof value === "string" ? value.trim() : "";
  return valueAsString || undefined;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function dashboardFinding(record: FirestoreRecord): WorkspaceDashboardFinding | null {
  const id = stringValue(record.id) ?? stringValue(record._documentId);
  if (!id) return null;
  return { id, rule: String(record.rule || "unknown"), severity: String(record.severity || "high") as SecuritySeverity, title: String(record.title || "Achado de segurança"), description: String(record.description || ""), subjects: stringList(record.subjects), ipAddresses: stringList(record.ipAddresses), eventIds: stringList(record.eventIds), firstOccurredAt: dateValue(record.firstOccurredAt), lastOccurredAt: dateValue(record.lastOccurredAt), evidenceCount: Number(record.evidenceCount || 0) };
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
      const [records, findingRecords, posture, sourceRecords] = await Promise.all([dependencies.listEvents(), dependencies.listFindings(), dependencies.getPosture(), dependencies.listSources?.() ?? []]);
      const events = records.map(dashboardEvent).filter((event) => Boolean(event.id));
      const findings = findingRecords.map(dashboardFinding).filter((finding): finding is WorkspaceDashboardFinding => Boolean(finding));
      return {
        events,
        findings,
        summary: {
          recentEvents: events.length,
          highOrCriticalEvents: events.filter((event) => event.severity === "high" || event.severity === "critical").length,
          openFindings: findings.length,
        },
        posture: dashboardPosture(posture),
        sources: sourceRecords.map((record) => ({ source: String(record.source || record._documentId || "unknown"), status: String(record.lastStatus || "unknown"), collected: Number(record.lastCollected || 0), persisted: Number(record.lastPersisted || 0), completedAt: record.lastCompletedAt ? dateValue(record.lastCompletedAt) : undefined, safeError: stringValue(record.lastSafeError) })),
      };
    },
  };
}

async function listWorkspaceSourceStates(): Promise<readonly FirestoreRecord[]> {
  return runFirestoreQuery({ from: [{ collectionId: WORKSPACE_SYNC_STATE_COLLECTION }], limit: 20 });
}

async function listWorkspaceFindings(): Promise<readonly FirestoreRecord[]> {
  return runFirestoreQuery({ from: [{ collectionId: WORKSPACE_SECURITY_FINDINGS_COLLECTION }], orderBy: [{ field: { fieldPath: "lastOccurredAt" }, direction: "DESCENDING" }], limit: 100 });
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
    listFindings: listWorkspaceFindings,
    getPosture: () => getFirestoreDocument(WORKSPACE_DIRECTORY_POSTURE_COLLECTION, "current"),
    listSources: listWorkspaceSourceStates,
  }).load();
}
