import {
  commitFirestoreDocuments,
  countFirestoreCollection,
  getFirestoreDocument,
  isFirestoreConfigured,
  runFirestoreQuery,
  setFirestoreDocument,
  type FirestoreRecord,
} from "./firestore.js";
import { getFluxoraCollectionPaths } from "./fluxoraFirestorePaths.js";

export type ArchivePeriod = "today" | "7d" | "30d" | "90d" | "all";

export type ArchivedExecutionNode = {
  nodeName?: string;
  runIndex?: number;
  status?: string;
  startTime?: string;
  executionTimeMs?: number | null;
  source?: unknown;
  input?: unknown;
  output?: unknown;
  outputItems?: number;
  error?: unknown;
};

export type ArchivedExecution = {
  executionId: string;
  workflowId?: string;
  workflowName?: string;
  sectionName?: string;
  status?: string;
  mode?: string;
  startedAt?: string;
  stoppedAt?: string;
  duration?: number | null;
  finished?: boolean;
  retryOf?: string | null;
  retrySuccessId?: string | null;
  lastNodeExecuted?: string | null;
  error?: unknown;
  nodes?: ArchivedExecutionNode[];
  nodeMetrics?: Array<{ nodeName: string; status: string; executionTimeMs: number | null; outputItems: number }>;
  detailsAvailable?: boolean;
  detailFetchAttemptedAt?: string;
  detailUnavailable?: boolean;
  archiveRunId?: string;
  archivedAt?: string;
  archiveVersion?: number;
};

export type ArchiveSyncState = {
  backfillStarted?: boolean;
  backfillComplete?: boolean;
  backfillCursor?: string | null;
  lastSyncAt?: string;
  lastRecentExecutionId?: string | null;
  lastRunProcessed?: number;
  lastRunSaved?: number;
  lastError?: string | null;
  archiveFormatVersion?: number;
  activeArchiveRunId?: string;
  sourceExecutionCount?: number;
  sourceCountCheckedAt?: string;
  missingExecutionCount?: number;
  reconciliationCheckedAt?: string;
  reconciliationTruncated?: boolean;
  reconciliationMissingBefore?: number;
  reconciliationRecovered?: number;
  backfillScanned?: number;
  detailsHydrated?: number;
  detailsPending?: number;
  detailsUnavailable?: number;
  lastDetailAttempted?: number;
  lastDetailHydrated?: number;
  lastDetailUnavailable?: number;
  lastRunStartedAt?: string;
  lastRunCompletedAt?: string;
  lastRunDurationMs?: number;
  lastRunStatus?: "running" | "success" | "failure";
  lastRunTrigger?: "manual" | "scheduled" | "system";
  lastSuccessfulSyncAt?: string;
};

function logsCollection() {
  return String(process.env.FIRESTORE_N8N_LOGS_COLLECTION || "logs_n8n_automacoes").trim() || "logs_n8n_automacoes";
}

const SYSTEM_COLLECTION = getFluxoraCollectionPaths("system").destination;
const SYNC_DOCUMENT = "n8n_sync";

function readLimit() {
  const parsed = Number(process.env.FIRESTORE_READ_LIMIT || "25000");
  return Number.isFinite(parsed) ? Math.max(1000, Math.min(100000, Math.floor(parsed))) : 25000;
}

function periodCutoff(period: ArchivePeriod) {
  if (period === "all") return null;
  const now = new Date();
  if (period === "today") {
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  }
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const summaryFields = [
  "executionId",
  "workflowId",
  "workflowName",
  "sectionName",
  "status",
  "mode",
  "startedAt",
  "stoppedAt",
  "duration",
  "finished",
  "retryOf",
  "retrySuccessId",
  "lastNodeExecuted",
  "archiveRunId",
  "detailsAvailable",
  "detailFetchAttemptedAt",
  "detailUnavailable",
  "nodeMetrics",
];

export function archiveConfigured() {
  return isFirestoreConfigured();
}

export async function saveArchivedExecutions(executions: ArchivedExecution[]) {
  const unique = new Map<string, ArchivedExecution>();
  for (const execution of executions) {
    if (!execution.executionId) continue;
    unique.set(String(execution.executionId), execution);
  }
  return commitFirestoreDocuments(
    logsCollection(),
    Array.from(unique.values()).map((execution) => ({ id: String(execution.executionId), data: execution as FirestoreRecord })),
  );
}

export async function saveArchivedExecution(execution: ArchivedExecution) {
  if (!execution.executionId) return null;
  return setFirestoreDocument(logsCollection(), String(execution.executionId), execution as FirestoreRecord);
}

export async function getArchivedExecution(id: string): Promise<ArchivedExecution | null> {
  const document = await getFirestoreDocument(logsCollection(), id);
  if (!document) return null;
  return document as unknown as ArchivedExecution;
}

export async function listArchivedExecutions(period: ArchivePeriod, includeLegacy = false) {
  const syncState = await getArchiveSyncState();
  const activeArchiveRunId = includeLegacy ? null : syncState.activeArchiveRunId || null;
  const cutoff = periodCutoff(period);
  const structuredQuery: FirestoreRecord = {
    select: { fields: summaryFields.map((fieldPath) => ({ fieldPath })) },
    from: [{ collectionId: logsCollection() }],
    orderBy: [{ field: { fieldPath: "startedAt" }, direction: "DESCENDING" }],
    limit: readLimit(),
  };
  if (cutoff) {
    structuredQuery.where = {
      fieldFilter: {
        field: { fieldPath: "startedAt" },
        op: "GREATER_THAN_OR_EQUAL",
        value: { stringValue: cutoff },
      },
    };
  }

  const rows = await runFirestoreQuery(structuredQuery);
  const items = rows
    .map((row) => ({
      id: String(row.executionId || row._documentId || ""),
      workflowId: row.workflowId ? String(row.workflowId) : undefined,
      workflowName: row.workflowName ? String(row.workflowName) : undefined,
      status: row.status ? String(row.status) : undefined,
      mode: row.mode ? String(row.mode) : undefined,
      startedAt: row.startedAt ? String(row.startedAt) : undefined,
      stoppedAt: row.stoppedAt ? String(row.stoppedAt) : undefined,
      duration: typeof row.duration === "number" ? row.duration : null,
      finished: typeof row.finished === "boolean" ? row.finished : undefined,
      retryOf: row.retryOf == null ? null : String(row.retryOf),
      retrySuccessId: row.retrySuccessId == null ? null : String(row.retrySuccessId),
      lastNodeExecuted: row.lastNodeExecuted == null ? null : String(row.lastNodeExecuted),
      archiveRunId: row.archiveRunId ? String(row.archiveRunId) : undefined,
      detailsAvailable: row.detailsAvailable === true,
      detailFetchAttemptedAt: row.detailFetchAttemptedAt ? String(row.detailFetchAttemptedAt) : undefined,
      detailUnavailable: row.detailUnavailable === true,
      nodeMetrics: Array.isArray(row.nodeMetrics) ? row.nodeMetrics : undefined,
      source: "firestore" as const,
    }))
    .filter((row) => row.id && row.id !== "teste_inicial" && (!activeArchiveRunId || row.archiveRunId === activeArchiveRunId));

  return { items, truncated: rows.length >= readLimit() };
}

export async function getArchiveSyncState(): Promise<ArchiveSyncState> {
  const document = await getFirestoreDocument(SYSTEM_COLLECTION, SYNC_DOCUMENT);
  return document ? document as unknown as ArchiveSyncState : {};
}

export async function setArchiveSyncState(state: ArchiveSyncState) {
  return setFirestoreDocument(SYSTEM_COLLECTION, SYNC_DOCUMENT, state as FirestoreRecord);
}


export async function getArchiveDiagnostics() {
  const configured = archiveConfigured();
  if (!configured) return { configured: false, totalArchived: 0, state: null };
  const [state, totalStored] = await Promise.all([getArchiveSyncState(), countFirestoreCollection(logsCollection())]);
  const active = state.activeArchiveRunId ? await listArchivedExecutions("all") : null;
  return { configured: true, totalArchived: active?.items.length ?? totalStored, totalStored, state };
}
