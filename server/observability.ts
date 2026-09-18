import { createHash } from "node:crypto";
import { getFirestoreDocument, runFirestoreQuery, setFirestoreDocument, type FirestoreRecord } from "./firestore.js";
import { getFluxoraCollectionPaths } from "./fluxoraFirestorePaths.js";

export type IncidentStatus = "new" | "acknowledged" | "investigating" | "resolved";
export type IncidentSeverity = "critical" | "high" | "medium" | "low";

export type IncidentState = {
  fingerprint: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  owner?: string | null;
  silencedUntil?: string | null;
  note?: string | null;
  updatedAt?: string;
  updatedBy?: string;
  firstOccurredAt?: string | null;
  acknowledgedAt?: string | null;
  investigatingAt?: string | null;
  resolvedAt?: string | null;
  timeToAcknowledgeMinutes?: number | null;
  timeToResolveMinutes?: number | null;
  history?: Array<{ at: string; actor: string; action: string; note?: string | null }>;
};

export type WorkflowSlo = {
  workflowId: string;
  workflowName?: string;
  enabled: boolean;
  successRateTarget: number;
  p95TargetSeconds: number;
  updatedAt?: string;
  updatedBy?: string;
};

export type WorkflowRunbook = {
  workflowId: string;
  workflowName?: string;
  owner?: string | null;
  url?: string | null;
  instructions?: string | null;
  updatedAt?: string;
  updatedBy?: string;
};

export type WorkflowAlertRule = {
  workflowId: string;
  workflowName?: string;
  enabled: boolean;
  failureRateThreshold: number;
  consecutiveFailures: number;
  inactivityHours: number;
  severity: IncidentSeverity;
  updatedAt?: string;
  updatedBy?: string;
};

const INCIDENT_COLLECTION = getFluxoraCollectionPaths("incidents").destination;
const SLO_COLLECTION = getFluxoraCollectionPaths("slos").destination;
const RUNBOOK_COLLECTION = "fluxora_runbooks";
const ALERT_RULE_COLLECTION = getFluxoraCollectionPaths("alertRules").destination;

function documentId(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 40);
}

export function normalizeErrorSignature(value: unknown) {
  const raw = typeof value === "string"
    ? value
    : value && typeof value === "object"
      ? String((value as any).message || (value as any).description || (value as any).name || "")
      : "";
  return raw
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<uuid>")
    .replace(/\b\d{3,}\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export function incidentFingerprint(input: { workflowId?: string; node?: string | null; error?: unknown }) {
  const signature = `${input.workflowId || "unknown"}|${input.node || "unknown"}|${normalizeErrorSignature(input.error) || "unknown"}`;
  return documentId(signature);
}

export async function listIncidentStates(): Promise<IncidentState[]> {
  const rows = await runFirestoreQuery({ from: [{ collectionId: INCIDENT_COLLECTION }], limit: 500 });
  return rows.map((row) => row as unknown as IncidentState).filter((row) => Boolean(row.fingerprint));
}

export async function updateIncidentState(input: Omit<IncidentState, "history" | "updatedAt" | "updatedBy">, actor: string) {
  const id = documentId(input.fingerprint);
  const current = await getFirestoreDocument(INCIDENT_COLLECTION, id) as unknown as IncidentState | null;
  const now = new Date().toISOString();
  const firstSeenAt = current?.firstOccurredAt || input.firstOccurredAt || current?.history?.[0]?.at || now;
  const elapsedMinutes = Number(((new Date(now).getTime() - new Date(firstSeenAt).getTime()) / 60000).toFixed(1));
  const action = current ? `${current.status} → ${input.status}` : `Incidente definido como ${input.status}`;
  const next: IncidentState = {
    ...current,
    ...input,
    fingerprint: input.fingerprint,
    updatedAt: now,
    updatedBy: actor,
    firstOccurredAt: current?.firstOccurredAt || input.firstOccurredAt || null,
    acknowledgedAt: current?.acknowledgedAt || (input.status === "acknowledged" ? now : null),
    investigatingAt: current?.investigatingAt || (input.status === "investigating" ? now : null),
    resolvedAt: input.status === "resolved" ? (current?.resolvedAt || now) : input.status === current?.status ? current?.resolvedAt : null,
    timeToAcknowledgeMinutes: current?.timeToAcknowledgeMinutes ?? (input.status === "acknowledged" ? elapsedMinutes : null),
    timeToResolveMinutes: input.status === "resolved" ? (current?.timeToResolveMinutes ?? elapsedMinutes) : input.status === current?.status ? current?.timeToResolveMinutes : null,
    history: [...(current?.history || []), { at: now, actor, action, note: input.note }].slice(-50),
  };
  await setFirestoreDocument(INCIDENT_COLLECTION, id, next as unknown as FirestoreRecord);
  return next;
}

export async function listWorkflowSlos(): Promise<WorkflowSlo[]> {
  const rows = await runFirestoreQuery({ from: [{ collectionId: SLO_COLLECTION }], limit: 500 });
  return rows.map((row) => row as unknown as WorkflowSlo).filter((row) => Boolean(row.workflowId));
}

export async function saveWorkflowSlo(input: Omit<WorkflowSlo, "updatedAt" | "updatedBy">, actor: string) {
  const next: WorkflowSlo = { ...input, updatedAt: new Date().toISOString(), updatedBy: actor };
  await setFirestoreDocument(SLO_COLLECTION, documentId(input.workflowId), next as unknown as FirestoreRecord);
  return next;
}

export async function listWorkflowRunbooks(): Promise<WorkflowRunbook[]> {
  const rows = await runFirestoreQuery({ from: [{ collectionId: RUNBOOK_COLLECTION }], limit: 500 });
  return rows.map((row) => row as unknown as WorkflowRunbook).filter((row) => Boolean(row.workflowId));
}

export async function saveWorkflowRunbook(input: Omit<WorkflowRunbook, "updatedAt" | "updatedBy">, actor: string) {
  const next: WorkflowRunbook = { ...input, updatedAt: new Date().toISOString(), updatedBy: actor };
  await setFirestoreDocument(RUNBOOK_COLLECTION, documentId(input.workflowId), next as unknown as FirestoreRecord);
  return next;
}

export async function listWorkflowAlertRules(): Promise<WorkflowAlertRule[]> {
  const rows = await runFirestoreQuery({ from: [{ collectionId: ALERT_RULE_COLLECTION }], limit: 500 });
  return rows.map((row) => row as unknown as WorkflowAlertRule).filter((row) => Boolean(row.workflowId));
}

export async function saveWorkflowAlertRule(input: Omit<WorkflowAlertRule, "updatedAt" | "updatedBy">, actor: string) {
  const next: WorkflowAlertRule = { ...input, updatedAt: new Date().toISOString(), updatedBy: actor };
  await setFirestoreDocument(ALERT_RULE_COLLECTION, documentId(input.workflowId), next as unknown as FirestoreRecord);
  return next;
}
