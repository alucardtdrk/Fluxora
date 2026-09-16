import crypto from "node:crypto";
import { getFirestoreDocument, isFirestoreConfigured, runFirestoreQuery, setFirestoreDocument, type FirestoreRecord } from "./firestore.js";

export type WorkflowSnapshot = {
  id: string;
  workflowId: string;
  workflowName: string;
  actor: string;
  actorRole: string;
  reason: string;
  createdAt: string;
  workflow: Record<string, unknown>;
};

export type WorkflowChange = {
  id: string;
  workflowId: string;
  workflowName: string;
  actor: string;
  actorRole: string;
  type: "update" | "restore";
  createdAt: string;
  summary: string;
  nodeNames: string[];
  snapshotId: string;
  restoredFromSnapshotId?: string | null;
};

const SNAPSHOT_COLLECTION = "fluxora_workflow_snapshots";
const CHANGE_COLLECTION = "fluxora_workflow_changes";

function randomId() {
  return crypto.randomUUID();
}

function encodeDocumentId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function changeQueryLimit() {
  const parsed = Number(process.env.FLUXORA_WORKFLOW_HISTORY_LIMIT || "100");
  return Number.isFinite(parsed) ? Math.max(10, Math.min(300, Math.floor(parsed))) : 100;
}

export function workflowHistoryConfigured() {
  return isFirestoreConfigured();
}

export async function saveWorkflowSnapshot(input: Omit<WorkflowSnapshot, "id" | "createdAt">) {
  if (!workflowHistoryConfigured()) throw new Error("FIREBASE_NOT_CONFIGURED");
  const createdAt = new Date().toISOString();
  const id = encodeDocumentId(`${input.workflowId}_${Date.now()}_${randomId()}`);
  const snapshot: WorkflowSnapshot = { ...input, id, createdAt };
  await setFirestoreDocument(SNAPSHOT_COLLECTION, id, snapshot as unknown as FirestoreRecord);
  return snapshot;
}

export async function getWorkflowSnapshot(id: string) {
  if (!workflowHistoryConfigured()) return null;
  const document = await getFirestoreDocument(SNAPSHOT_COLLECTION, id);
  return document ? (document as unknown as WorkflowSnapshot) : null;
}

export async function saveWorkflowChange(input: Omit<WorkflowChange, "id" | "createdAt">) {
  if (!workflowHistoryConfigured()) throw new Error("FIREBASE_NOT_CONFIGURED");
  const createdAt = new Date().toISOString();
  const id = encodeDocumentId(`${input.workflowId}_${Date.now()}_${randomId()}`);
  const change: WorkflowChange = { ...input, id, createdAt };
  await setFirestoreDocument(CHANGE_COLLECTION, id, change as unknown as FirestoreRecord);
  return change;
}

export async function listWorkflowChanges(workflowId: string) {
  if (!workflowHistoryConfigured()) return [] as WorkflowChange[];
  const rows = await runFirestoreQuery({
    from: [{ collectionId: CHANGE_COLLECTION }],
    where: {
      fieldFilter: {
        field: { fieldPath: "workflowId" },
        op: "EQUAL",
        value: { stringValue: workflowId },
      },
    },
    orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
    limit: changeQueryLimit(),
  });

  return rows.map((row) => ({
    id: String(row.id || row._documentId || ""),
    workflowId: String(row.workflowId || workflowId),
    workflowName: String(row.workflowName || "Workflow"),
    actor: String(row.actor || "desconhecido"),
    actorRole: String(row.actorRole || "viewer"),
    type: row.type === "restore" ? "restore" : "update",
    createdAt: String(row.createdAt || ""),
    summary: String(row.summary || ""),
    nodeNames: Array.isArray(row.nodeNames) ? row.nodeNames.map((value) => String(value)) : [],
    snapshotId: String(row.snapshotId || ""),
    restoredFromSnapshotId: row.restoredFromSnapshotId == null ? null : String(row.restoredFromSnapshotId),
  })).filter((row) => row.id);
}
