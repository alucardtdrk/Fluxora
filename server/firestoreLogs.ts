import { createHash } from "node:crypto";
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
  detailsPending?: boolean;
  summaryHash?: string;
  detailsHash?: string;
  archiveRunId?: string;
  archivedAt?: string;
  archiveVersion?: number;
};

export type ArchiveSyncState = {
  detailsQueueVersion?: number;
  detailsQueueOffset?: number;
  activeExecutionIds?: string[];
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
  const existing = new Map<string, FirestoreRecord>();
  const ids = Array.from(unique.keys());
  for (let offset = 0; offset < ids.length; offset += 10) {
    const records = await runFirestoreQuery({
      from: [{ collectionId: logsCollection() }],
      select: { fields: ["executionId", "summaryHash", "detailsHash", "detailsAvailable", "detailFetchAttemptedAt", "detailUnavailable"].map((fieldPath) => ({ fieldPath })) },
      where: { fieldFilter: { field: { fieldPath: "executionId" }, op: "IN", value: { arrayValue: { values: ids.slice(offset, offset + 10).map((id) => ({ stringValue: id })) } } } },
    });
    for (const record of records) existing.set(String(record.executionId), record);
  }
  const changed: ArchivedExecution[] = [];
  for (const execution of unique.values()) {
    const previous = existing.get(execution.executionId);
    const summary = Object.fromEntries(["executionId", "workflowId", "workflowName", "sectionName", "status", "mode", "startedAt", "stoppedAt", "duration", "finished", "retryOf", "retrySuccessId", "archiveRunId", "archiveVersion"].map((key) => [key, (execution as FirestoreRecord)[key]]));
    const summaryHash = createHash("sha256").update(JSON.stringify(summary)).digest("hex");
    const detailsHash = execution.detailsAvailable ? createHash("sha256").update(JSON.stringify([execution.nodes, execution.nodeMetrics, execution.error, execution.lastNodeExecuted])).digest("hex") : undefined;
    const detailUnavailable = execution.detailsAvailable ? false : execution.detailUnavailable;
    if (previous?.summaryHash === summaryHash && (!execution.detailsAvailable || previous.detailsHash === detailsHash) && (execution.detailFetchAttemptedAt === undefined || execution.detailFetchAttemptedAt === previous.detailFetchAttemptedAt) && (detailUnavailable === undefined || detailUnavailable === previous.detailUnavailable)) continue;
    changed.push({ ...execution, summaryHash, detailsHash, detailUnavailable, detailsPending: !(execution.detailsAvailable || previous?.detailsAvailable || execution.detailFetchAttemptedAt || previous?.detailFetchAttemptedAt) });
  }
  if (!changed.length) return { writes: 0 };
  return commitFirestoreDocuments(
    logsCollection(),
    changed.map((execution) => ({ id: String(execution.executionId), data: execution as FirestoreRecord })),
  );
}

export async function saveArchivedExecution(execution: ArchivedExecution) {
  if (!execution.executionId) return null;
  await saveArchivedExecutions([execution]);
  return execution;
}

export async function getArchiveDetailBatch(limit: number) {
  let state = await getArchiveSyncState();
  if (state.detailsQueueVersion !== 1) {
    // ponytail: one bounded preparation page per cycle; offsets are used only for this legacy setup.
    const history = await listArchivedExecutions("all", true, { limit: 1000, offset: state.detailsQueueOffset ?? 0 });
    await commitFirestoreDocuments(logsCollection(), history.items.map((item) => ({
      id: item.id, data: { executionId: item.id, detailsPending: !item.detailsAvailable && !item.detailFetchAttemptedAt },
    })));
    state = { ...await getArchiveSyncState(), detailsQueueVersion: history.hasMore ? undefined : 1, detailsQueueOffset: (state.detailsQueueOffset ?? 0) + history.rowsRead };
    await setArchiveSyncState(state);
  }
  const filter = (fieldPath: string) => ({ fieldFilter: { field: { fieldPath }, op: "EQUAL", value: { booleanValue: true } } });
  const [records, available, queued, unavailable] = await Promise.all([
    runFirestoreQuery({ from: [{ collectionId: logsCollection() }], select: { fields: ["executionId", "archiveRunId"].map((fieldPath) => ({ fieldPath })) }, where: filter("detailsPending"), limit }),
    countFirestoreCollection(logsCollection(), filter("detailsAvailable")),
    countFirestoreCollection(logsCollection(), filter("detailsPending")),
    countFirestoreCollection(logsCollection(), filter("detailUnavailable")),
  ]);
  const pending = state.detailsQueueVersion === 1 ? queued : Math.max(queued, (await countFirestoreCollection(logsCollection())) - available - unavailable);
  return { candidates: records.map((record) => ({ id: String(record.executionId || record._documentId), archiveRunId: record.archiveRunId ? String(record.archiveRunId) : undefined })), available, pending, unavailable, queueState: { detailsQueueVersion: state.detailsQueueVersion, detailsQueueOffset: state.detailsQueueOffset } };
}

export async function getArchivedExecution(id: string): Promise<ArchivedExecution | null> {
  const document = await getFirestoreDocument(logsCollection(), id);
  if (!document) return null;
  return document as unknown as ArchivedExecution;
}

export async function listArchivedExecutions(period: ArchivePeriod, includeLegacy = false, page?: { limit: number; offset?: number; errorsOnly?: boolean; after?: { startedAt: string; documentName: string } }) {
  const activeArchiveRunId = includeLegacy ? null : (await getArchiveSyncState()).activeArchiveRunId || null;
  const limit = Math.min(page?.limit ?? readLimit(), readLimit());
  const cutoff = periodCutoff(period);
  const structuredQuery: FirestoreRecord = {
    select: { fields: summaryFields.map((fieldPath) => ({ fieldPath })) },
    from: [{ collectionId: logsCollection() }],
    orderBy: [{ field: { fieldPath: "startedAt" }, direction: "DESCENDING" }, { field: { fieldPath: "__name__" }, direction: "DESCENDING" }],
    limit,
    ...(page?.offset ? { offset: page.offset } : {}),
    ...(page?.after ? { startAt: { before: false, values: [{ stringValue: page.after.startedAt }, { referenceValue: page.after.documentName }] } } : {}),
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

  if (page?.errorsOnly) {
    const errors = { fieldFilter: { field: { fieldPath: "status" }, op: "IN", value: { arrayValue: { values: ["error", "failed", "crashed"].map((stringValue) => ({ stringValue })) } } } };
    structuredQuery.where = structuredQuery.where ? { compositeFilter: { op: "AND", filters: [structuredQuery.where, errors] } } : errors;
  }

  const rows = await runFirestoreQuery(structuredQuery);
  if (!page) {
    let pageSize = rows.length;
    while (pageSize === structuredQuery.limit) {
      const last = rows.at(-1)!;
      const page = await runFirestoreQuery({ ...structuredQuery, startAt: { before: false, values: [{ stringValue: last.startedAt }, { referenceValue: last._documentName }] } });
      rows.push(...page);
      pageSize = page.length;
    }
  }
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

  const last = rows.at(-1);
  const nextCursor = typeof last?.startedAt === "string" && typeof last._documentName === "string" ? { startedAt: last.startedAt, documentName: last._documentName } : undefined;
  return { items, rowsRead: rows.length, truncated: Boolean(page) && rows.length >= readLimit(), hasMore: Boolean(page) && rows.length >= limit, nextCursor };
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
  const totalArchived = state.activeArchiveRunId ? await countFirestoreCollection(logsCollection(), {
    fieldFilter: { field: { fieldPath: "archiveRunId" }, op: "EQUAL", value: { stringValue: state.activeArchiveRunId } },
  }) : totalStored;
  return { configured: true, totalArchived, totalStored, state };
}
