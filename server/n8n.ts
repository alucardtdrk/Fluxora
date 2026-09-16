import { createHash } from "node:crypto";
import { z } from "zod";
import { archiveConfigured, getArchivedExecution, getArchiveSyncState, listArchivedExecutions, saveArchivedExecution, saveArchivedExecutions, setArchiveSyncState, type ArchivedExecution } from "./firestoreLogs.js";
import { incidentFingerprint, listIncidentStates, listWorkflowAlertRules, listWorkflowRunbooks, listWorkflowSlos, normalizeErrorSignature } from "./observability.js";

const workflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean().optional().default(false),
  updatedAt: z.string().optional(),
  createdAt: z.string().optional(),
  tags: z.array(z.object({ name: z.string() })).optional().default([]),
  nodes: z.array(z.object({ name: z.string().optional(), type: z.string().optional() }).passthrough()).optional().default([]),
});

type N8nWorkflow = z.infer<typeof workflowSchema>;
type Period = "today" | "7d" | "30d" | "90d" | "all";
type N8nExecution = {
  id?: string;
  workflowId?: string;
  status?: string;
  mode?: string;
  startedAt?: string;
  stoppedAt?: string;
  finished?: boolean;
  workflowName?: string;
  sectionName?: string;
  lastNodeExecuted?: string | null;
  retryOf?: string | null;
  retrySuccessId?: string | null;
  data?: any;
  workflowData?: any;
};

type Page<T> = { data?: T[]; nextCursor?: string | null };
export type N8nStatus = "ok" | "not_configured" | "unauthorized" | "api_error";



type CacheEntry<T> = {
  value?: T;
  expiresAt: number;
  staleUntil: number;
  promise?: Promise<T>;
};

const runtimeCache = new Map<string, CacheEntry<unknown>>();
let runtimeConfigSignature: string | null = null;

async function cached<T>(key: string, ttlMs: number, staleMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const current = runtimeCache.get(key) as CacheEntry<T> | undefined;

  if (current?.value !== undefined && now < current.expiresAt) return current.value;

  if (current?.value !== undefined && now < current.staleUntil) {
    if (!current.promise) {
      const refresh = loader()
        .then((value) => {
          runtimeCache.set(key, { value, expiresAt: Date.now() + ttlMs, staleUntil: Date.now() + staleMs });
          return value;
        })
        .catch(() => current.value as T)
        .finally(() => {
          const latest = runtimeCache.get(key) as CacheEntry<T> | undefined;
          if (latest?.promise === refresh) delete latest.promise;
        });
      current.promise = refresh;
      runtimeCache.set(key, current as CacheEntry<unknown>);
    }
    return current.value;
  }

  if (current?.promise) return current.promise;

  const entry: CacheEntry<T> = { expiresAt: 0, staleUntil: 0 };
  const promise = loader()
    .then((value) => {
      runtimeCache.set(key, { value, expiresAt: Date.now() + ttlMs, staleUntil: Date.now() + staleMs });
      return value;
    })
    .finally(() => {
      const latest = runtimeCache.get(key) as CacheEntry<T> | undefined;
      if (latest?.promise === promise && latest.value === undefined) runtimeCache.delete(key);
    });
  entry.promise = promise;
  runtimeCache.set(key, entry as CacheEntry<unknown>);
  return promise;
}

function invalidateCache(prefix: string) {
  for (const key of runtimeCache.keys()) if (key.startsWith(prefix)) runtimeCache.delete(key);
}

export class N8nIntegrationError extends Error {
  constructor(
    public readonly code: Exclude<N8nStatus, "ok" | "not_configured">,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "N8nIntegrationError";
  }
}

function getConfig() {
  const baseUrl = process.env.N8N_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.N8N_API_KEY;
  const config = baseUrl && apiKey ? { baseUrl, apiKey } : null;
  const signature = config ? createHash("sha256").update(`${config.baseUrl}|${config.apiKey}`).digest("hex") : null;
  if (signature !== runtimeConfigSignature) {
    runtimeCache.clear();
    runtimeConfigSignature = signature;
  }
  return config;
}

function maxPages() {
  const parsed = Number(process.env.N8N_MAX_PAGES || "100");
  return Number.isFinite(parsed) ? Math.max(1, Math.min(500, parsed)) : 100;
}

async function n8nRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const config = getConfig();
  if (!config) throw new Error("N8N_NOT_CONFIGURED");

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-N8N-API-KEY": config.apiKey,
        ...init?.headers,
      },
    });
  } catch (error) {
    const cause = error instanceof Error && "cause" in error ? (error as Error & { cause?: { code?: string } }).cause?.code : undefined;
    console.error("n8n request could not reach the service", { path, error: error instanceof Error ? error.name : "unknown", cause: cause ?? "unknown" });
    throw new N8nIntegrationError("api_error", "could not reach n8n");
  }

  if (!response.ok) {
    console.error("n8n request was rejected", { path, status: response.status });
    if (response.status === 401 || response.status === 403) {
      throw new N8nIntegrationError("unauthorized", "n8n rejected the API credentials", response.status);
    }
    throw new N8nIntegrationError("api_error", `n8n returned HTTP ${response.status}`, response.status);
  }

  return response.json() as Promise<T>;
}

async function fetchAllPages<T>(path: string): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let cursor: string | null | undefined;
  let page = 0;
  const limit = maxPages();

  do {
    const separator = path.includes("?") ? "&" : "?";
    const cursorQuery = cursor ? `${separator}cursor=${encodeURIComponent(cursor)}` : "";
    const response = await n8nRequest<Page<T>>(`${path}${cursorQuery}`);
    items.push(...(response.data ?? []));
    cursor = response.nextCursor;
    page += 1;
  } while (cursor && page < limit);

  return { items, truncated: Boolean(cursor) };
}

function durationInSeconds(item: N8nExecution) {
  if (typeof (item as any).duration === "number") return (item as any).duration;
  if (!item.startedAt || !item.stoppedAt) return null;
  const duration = (new Date(item.stoppedAt).getTime() - new Date(item.startedAt).getTime()) / 1000;
  return Number.isFinite(duration) && duration >= 0 ? Number(duration.toFixed(1)) : null;
}

function errorStatus(error: unknown): Exclude<N8nStatus, "ok" | "not_configured"> {
  return error instanceof N8nIntegrationError ? error.code : "api_error";
}

function periodStart(period: Period) {
  if (period === "all") return null;
  const now = new Date();
  if (period === "today") {
    now.setHours(0, 0, 0, 0);
    return now.getTime();
  }
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function withinPeriod(item: N8nExecution, period: Period) {
  const start = periodStart(period);
  if (start === null) return true;
  if (!item.startedAt) return false;
  const ts = new Date(item.startedAt).getTime();
  return Number.isFinite(ts) && ts >= start;
}

function statusKind(status?: string) {
  const value = String(status || "unknown").toLowerCase();
  if (value === "success") return "success";
  if (["error", "failed", "crashed"].includes(value)) return "error";
  if (["running", "new"].includes(value)) return "running";
  if (value === "waiting") return "waiting";
  if (["canceled", "cancelled"].includes(value)) return "canceled";
  return "other";
}

export function summarizeReliability(executions: N8nExecution[]) {
  const byWorkflow = new Map<string, N8nExecution[]>();
  executions.forEach((item) => {
    const key = item.workflowId || "unknown";
    byWorkflow.set(key, [...(byWorkflow.get(key) || []), item]);
  });
  const recoveryMinutes: number[] = [];
  const errorTimes: number[] = [];
  let longestFailureStreak = 0;
  let openFailures = 0;
  byWorkflow.forEach((rows) => {
    const ordered = [...rows].sort((a, b) => new Date(a.startedAt || 0).getTime() - new Date(b.startedAt || 0).getTime());
    let failureStartedAt: number | null = null;
    let streak = 0;
    ordered.forEach((row) => {
      const at = new Date(row.startedAt || 0).getTime();
      const kind = statusKind(row.status);
      if (kind === "error") {
        if (Number.isFinite(at)) errorTimes.push(at);
        if (failureStartedAt === null && Number.isFinite(at)) failureStartedAt = at;
        streak += 1;
        longestFailureStreak = Math.max(longestFailureStreak, streak);
      } else if (kind === "success") {
        if (failureStartedAt !== null && Number.isFinite(at) && at >= failureStartedAt) recoveryMinutes.push((at - failureStartedAt) / 60000);
        failureStartedAt = null;
        streak = 0;
      }
    });
    if (failureStartedAt !== null) openFailures += 1;
  });
  errorTimes.sort((a, b) => a - b);
  const intervals = errorTimes.slice(1).map((time, index) => (time - errorTimes[index]) / 3600000).filter((value) => value >= 0);
  const average = (values: number[]) => values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)) : null;
  return { meanRecoveryMinutes: average(recoveryMinutes), meanTimeBetweenFailuresHours: average(intervals), longestFailureStreak, recoveredEpisodes: recoveryMinutes.length, openFailures };
}

function detectTrendAnomalies(trend: Array<{ date: string; total: number; errors: number }>) {
  if (trend.length < 4) return [];
  const latest = trend[trend.length - 1];
  const baseline = trend.slice(Math.max(0, trend.length - 8), -1);
  const threshold = (field: "total" | "errors") => {
    const values = baseline.map((row) => row[field]);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const deviation = Math.sqrt(values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length);
    return mean + Math.max(2 * deviation, field === "errors" ? 2 : Math.max(10, mean * 0.5));
  };
  const anomalies: Array<{ type: string; severity: "high" | "medium"; title: string; description: string }> = [];
  if (latest.errors > threshold("errors")) anomalies.push({ type: "failure_spike", severity: "high", title: "Pico de falhas detectado", description: `${latest.errors} falhas em ${latest.date}, acima do comportamento recente.` });
  if (latest.total > threshold("total")) anomalies.push({ type: "volume_spike", severity: "medium", title: "Volume fora do padrão", description: `${latest.total} execuções em ${latest.date}, acima do comportamento recente.` });
  return anomalies;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[limite de profundidade]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && value.length > 12000) return `${value.slice(0, 12000)}…`;
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (["password", "senha", "token", "authorization", "apikey", "secret", "cookie", "credential", "clientsecret"].some((word) => normalized.includes(word))) {
      out[key] = "[protegido]";
    } else {
      out[key] = sanitize(raw, depth + 1);
    }
  }
  return out;
}

function workflowMap(workflows: N8nWorkflow[]) {
  return new Map(workflows.map((item) => [item.id, item]));
}

function sectionTitle(node: any) {
  const content = String(node?.parameters?.content || "").trim();
  const firstLine = content.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  const title = (firstLine || node?.name || "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/\*\*/g, "")
    .trim();
  return title ? title.slice(0, 120) : undefined;
}

function inferExecutionSection(item: N8nExecution, workflow?: N8nWorkflow) {
  if (item.sectionName) return item.sectionName;
  const workflowNodes = ((workflow?.nodes?.length ? workflow.nodes : item.workflowData?.nodes) || []) as any[];
  const executedNames = nodeRunsFromExecution(item).map((node) => node.nodeName);
  if (!executedNames.length && item.lastNodeExecuted) executedNames.push(item.lastNodeExecuted);
  if (!executedNames.length || !workflowNodes.length) return executedNames[0];

  const executedNodes = executedNames
    .map((name) => workflowNodes.find((node) => node?.name === name))
    .filter(Boolean);
  const stickyNotes = workflowNodes.filter((node) => String(node?.type || "").toLowerCase().includes("stickynote"));

  const matches = stickyNotes.flatMap((note) => {
    const [left, top] = Array.isArray(note?.position) ? note.position.map(Number) : [Number.NaN, Number.NaN];
    const width = Number(note?.parameters?.width ?? note?.width ?? 300);
    const height = Number(note?.parameters?.height ?? note?.height ?? 150);
    if (![left, top, width, height].every(Number.isFinite)) return [];
    const contained = executedNodes.filter((node) => {
      const [x, y] = Array.isArray(node?.position) ? node.position.map(Number) : [Number.NaN, Number.NaN];
      return Number.isFinite(x) && Number.isFinite(y) && x >= left && x <= left + width && y >= top && y <= top + height;
    });
    if (!contained.length) return [];
    const firstIndex = Math.min(...contained.map((node) => executedNames.indexOf(node.name)));
    return [{ title: sectionTitle(note), count: contained.length, firstIndex, area: width * height }];
  });

  matches.sort((a, b) => a.firstIndex - b.firstIndex || b.count - a.count || a.area - b.area);
  return matches.find((match) => match.title)?.title || executedNames[0];
}

function normalizeExecution(item: N8nExecution, names: Map<string, N8nWorkflow>) {
  const workflow = item.workflowId ? names.get(item.workflowId) : undefined;
  return {
    id: item.id ?? "—",
    workflowId: item.workflowId,
    workflowName: item.workflowName || item.workflowData?.name || workflow?.name || "Workflow sem nome",
    // Recent n8n summaries may not include runData yet. Keep the workflow as
    // a selectable fallback until the archive identifies the visual section.
    sectionName: inferExecutionSection(item, workflow) || item.workflowName || item.workflowData?.name || workflow?.name || "Workflow sem nome",
    status: item.status ?? "unknown",
    mode: item.mode,
    startedAt: item.startedAt,
    stoppedAt: item.stoppedAt,
    duration: durationInSeconds(item),
    retryOf: item.retryOf ?? null,
    retrySuccessId: item.retrySuccessId ?? null,
    source: (item as any).source === "firestore" ? "firestore" : "n8n",
  };
}

async function loadWorkflows() {
  return cached("workflows", 60_000, 5 * 60_000, async () => {
    const raw = await fetchAllPages<unknown>("/api/v1/workflows?limit=250");
    const workflows: N8nWorkflow[] = raw.items.flatMap((item) => {
      const parsed = workflowSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
    return { workflows, truncated: raw.truncated };
  });
}

async function fetchExecutionsForPeriod(period: Period, includeData = false): Promise<{ items: N8nExecution[]; truncated: boolean }> {
  const items: N8nExecution[] = [];
  let cursor: string | null | undefined;
  let page = 0;
  const pageLimit = maxPages();
  const cutoff = periodStart(period);

  do {
    const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const response = await n8nRequest<Page<N8nExecution>>(`/api/v1/executions?limit=250&includeData=${includeData ? "true" : "false"}${cursorQuery}`);
    const rows = response.data ?? [];
    items.push(...rows);
    cursor = response.nextCursor;
    page += 1;

    if (cutoff !== null && rows.length) {
      const timestamps = rows
        .map((row) => row.startedAt ? new Date(row.startedAt).getTime() : Number.NaN)
        .filter((value) => Number.isFinite(value));
      if (timestamps.length && Math.min(...timestamps) < cutoff) cursor = null;
    }
  } while (cursor && page < pageLimit);

  return { items, truncated: Boolean(cursor) };
}


function syncPageSize() {
  const parsed = Number(process.env.N8N_SYNC_PAGE_SIZE || "100");
  return Number.isFinite(parsed) ? Math.max(10, Math.min(100, Math.floor(parsed))) : 100;
}

function syncBackfillPages() {
  const parsed = Number(process.env.FIRESTORE_SYNC_PAGES_PER_RUN || "10");
  return Number.isFinite(parsed) ? Math.max(1, Math.min(10, Math.floor(parsed))) : 10;
}

function detailArchiveBatchSize(requested?: number) {
  const parsed = Number(requested ?? process.env.N8N_DETAIL_ARCHIVE_PER_SYNC ?? "20");
  return Number.isFinite(parsed) ? Math.max(1, Math.min(300, Math.floor(parsed))) : 20;
}

function compactArchiveValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[resumo]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > 2500 ? `${value.slice(0, 2500)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => compactArchiveValue(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 60)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (["password", "senha", "token", "authorization", "apikey", "secret", "cookie", "credential", "clientsecret"].some((word) => normalized.includes(word))) {
        out[key] = "[protegido]";
      } else {
        out[key] = compactArchiveValue(raw, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

function archiveNodes(execution: N8nExecution) {
  return nodeRunsFromExecution(execution).map((node: any) => ({
    nodeName: node.nodeName,
    runIndex: node.runIndex,
    status: node.status,
    startTime: node.startTime,
    executionTimeMs: node.executionTimeMs,
    outputItems: node.outputItems,
    source: compactArchiveValue(node.source),
    input: compactArchiveValue(node.input),
    output: compactArchiveValue(node.output),
    error: compactArchiveValue(node.error),
  }));
}

function toArchivedExecution(item: N8nExecution, names: Map<string, N8nWorkflow>, detailsAvailable = false, archiveRunId?: string): ArchivedExecution | null {
  const id = String(item.id || "").trim();
  if (!id) return null;
  const workflow = item.workflowId ? names.get(item.workflowId) : undefined;
  const nodes = archiveNodes(item);
  let document: ArchivedExecution = {
    executionId: id,
    workflowId: item.workflowId,
    workflowName: item.workflowName || item.workflowData?.name || workflow?.name || "Workflow sem nome",
    sectionName: inferExecutionSection(item, workflow),
    status: item.status || "unknown",
    mode: item.mode,
    startedAt: item.startedAt,
    stoppedAt: item.stoppedAt,
    duration: durationInSeconds(item),
    finished: item.finished ?? Boolean(item.stoppedAt),
    retryOf: item.retryOf ?? null,
    retrySuccessId: item.retrySuccessId ?? null,
    lastNodeExecuted: detailsAvailable ? item?.data?.resultData?.lastNodeExecuted ?? null : undefined,
    error: detailsAvailable ? compactArchiveValue(item?.data?.resultData?.error ?? null) : undefined,
    nodes: detailsAvailable ? nodes : undefined,
    nodeMetrics: detailsAvailable ? nodes.map((node: any) => ({
      nodeName: node.nodeName,
      status: node.status,
      executionTimeMs: node.executionTimeMs,
      outputItems: node.outputItems,
    })) : undefined,
    detailsAvailable: detailsAvailable || undefined,
    archiveRunId,
    archivedAt: new Date().toISOString(),
    archiveVersion: 1,
  };

  // Firestore has a 1 MiB per-document limit. Keep the operational metadata
  // even when a workflow produced very large payloads.
  const bytes = Buffer.byteLength(JSON.stringify(document), "utf8");
  if (bytes > 800_000) {
    document = {
      ...document,
      nodes: nodes.map((node: any) => ({
        nodeName: node.nodeName,
        runIndex: node.runIndex,
        status: node.status,
        startTime: node.startTime,
        executionTimeMs: node.executionTimeMs,
        outputItems: node.outputItems,
        error: node.error,
      })),
    };
  }
  return document;
}

async function fetchArchivePage(cursor?: string | null, includeData = false) {
  const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
  return n8nRequest<Page<N8nExecution>>(`/api/v1/executions?limit=${syncPageSize()}&includeData=${includeData ? "true" : "false"}${cursorQuery}`);
}

async function saveArchivePageDocuments(documents: ArchivedExecution[], detailed: boolean) {
  if (!documents.length) return 0;
  if (!detailed) return (await saveArchivedExecutions(documents)).writes;

  let writes = 0;
  let chunk: ArchivedExecution[] = [];
  let chunkBytes = 0;
  for (const document of documents) {
    const bytes = Buffer.byteLength(JSON.stringify(document), "utf8");
    if (chunk.length && (chunk.length >= 50 || chunkBytes + bytes > 7_000_000)) {
      writes += (await saveArchivedExecutions(chunk)).writes;
      chunk = [];
      chunkBytes = 0;
    }
    chunk.push(document);
    chunkBytes += bytes;
  }
  if (chunk.length) writes += (await saveArchivedExecutions(chunk)).writes;
  return writes;
}

const ARCHIVE_FORMAT_VERSION = 2;

async function countAvailableExecutions() {
  const page = await fetchExecutionsForPeriod("all", false);
  return page.items.length;
}

async function reconcileArchivedExecutionIds(state: import("./firestoreLogs.js").ArchiveSyncState, names: Map<string, N8nWorkflow>) {
  const [source, archived] = await Promise.all([
    fetchExecutionsForPeriod("all", false),
    listArchivedExecutions("all"),
  ]);
  const archivedIds = new Set(archived.items.map((item) => String(item.id)));
  const sourceIds = new Set(source.items.map((item) => String(item.id)).filter(Boolean));
  const missingItems = source.items.filter((item) => item.id && !archivedIds.has(String(item.id)));
  const reconciliationTruncated = source.truncated || archived.truncated;
  let recovered = 0;

  // A complete source scan already contains the summaries that are missing
  // from the active archive. Persist them directly instead of restarting the
  // entire paginated backfill and leaving the same counter on screen.
  if (missingItems.length && !reconciliationTruncated) {
    const documents = missingItems.flatMap((item) => {
      const document = toArchivedExecution(item, names, false, state.activeArchiveRunId);
      return document ? [document] : [];
    });
    recovered = await saveArchivePageDocuments(documents, false);
  }

  const missing = reconciliationTruncated ? missingItems.length : Math.max(0, missingItems.length - recovered);

  return {
    ...state,
    sourceExecutionCount: sourceIds.size,
    sourceCountCheckedAt: new Date().toISOString(),
    missingExecutionCount: missing,
    reconciliationCheckedAt: new Date().toISOString(),
    reconciliationTruncated,
    reconciliationMissingBefore: missingItems.length,
    reconciliationRecovered: recovered,
    lastRunSaved: Number(state.lastRunSaved || 0) + recovered,
  };
}

async function hydrateArchivedNodeDetails(names: Map<string, N8nWorkflow>, requestedBatchSize?: number) {
  const archive = await listArchivedExecutions("all", true);
  const items = archive.items as unknown as Array<ArchivedExecution & { id: string }>;
  const available = items.filter((item) => item.detailsAvailable).length;
  const unavailable = items.filter((item) => item.detailUnavailable).length;
  const pendingBefore = items.filter((item) => !item.detailsAvailable && !item.detailFetchAttemptedAt).length;
  const candidates = items
    // Section classification is metadata enrichment, not detail preservation.
    // Including already hydrated records here allowed them to monopolize every
    // batch and made the real detail queue appear stuck.
    .filter((item) => !item.detailsAvailable && !item.detailFetchAttemptedAt)
    .slice(0, detailArchiveBatchSize(requestedBatchSize));
  let hydrated = 0;
  let newlyUnavailable = 0;

  const hydrateCandidate = async (candidate: typeof candidates[number]) => {
    try {
      const execution = await n8nRequest<N8nExecution>(`/api/v1/executions/${encodeURIComponent(candidate.id)}?includeData=true`);
      const document = toArchivedExecution(execution, names, true, candidate.archiveRunId);
      if (document) {
        await saveArchivedExecution(document);
        return { hydrated: 1, unavailable: 0 };
      }
      return { hydrated: 0, unavailable: 0 };
    } catch {
      const stored = await getArchivedExecution(candidate.id);
      if (stored) {
        await saveArchivedExecution({
          ...stored,
          detailsAvailable: false,
          detailUnavailable: true,
          detailFetchAttemptedAt: new Date().toISOString(),
        });
      }
      return { hydrated: 0, unavailable: 1 };
    }
  };

  // Twelve concurrent reads keep a 300-item maintenance cycle bounded
  // bounded while avoiding an uncontrolled burst against the n8n API.
  for (let index = 0; index < candidates.length; index += 12) {
    const outcomes = await Promise.all(candidates.slice(index, index + 12).map(hydrateCandidate));
    for (const outcome of outcomes) {
      hydrated += outcome.hydrated;
      newlyUnavailable += outcome.unavailable;
    }
  }
  console.info("Fluxora archive detail batch completed", { candidates: candidates.length, hydrated, unavailable: newlyUnavailable });

  return {
    available: available + hydrated,
    // Only remove records that were actually preserved or confirmed missing.
    // A candidate with an inconclusive response remains eligible for retry.
    pending: Math.max(0, pendingBefore - hydrated - newlyUnavailable),
    unavailable: unavailable + newlyUnavailable,
    hydrated,
    attempted: candidates.length,
    newlyUnavailable,
  };
}

export async function syncN8nArchive(options: { recentPages?: number; backfillPages?: number; hydrateDetails?: boolean; detailBatchSize?: number; trigger?: "manual" | "scheduled" | "system" } = {}) {
  if (!getConfig()) return { status: "not_configured" as const, processed: 0, saved: 0, backfillComplete: false };
  if (!archiveConfigured()) return { status: "firestore_not_configured" as const, processed: 0, saved: 0, backfillComplete: false };

  const recentPages = Math.max(1, Math.min(3, options.recentPages ?? 3));
  const backfillPages = Math.max(0, Math.min(10, options.backfillPages ?? syncBackfillPages()));
  let processed = 0;
  let saved = 0;
  const runStartedAt = new Date().toISOString();
  const runStartedMs = Date.now();
  const runTrigger = options.trigger ?? "system";

  try {
    const { workflows } = await loadWorkflows();
    const names = workflowMap(workflows);
    let state = await getArchiveSyncState();
    state = { ...state, lastRunStartedAt: runStartedAt, lastRunStatus: "running", lastRunTrigger: runTrigger, lastError: null };
    await setArchiveSyncState(state);
    // A distinct run id prevents documents left by an older retention window
    // from inflating the dashboard after a new history reconciliation.
    if (state.archiveFormatVersion !== ARCHIVE_FORMAT_VERSION || !state.activeArchiveRunId) {
      state = {
        ...state,
        archiveFormatVersion: ARCHIVE_FORMAT_VERSION,
        activeArchiveRunId: `run-${Date.now()}`,
        backfillStarted: false,
        backfillComplete: false,
        backfillCursor: null,
        backfillScanned: 0,
        sourceExecutionCount: undefined,
        sourceCountCheckedAt: undefined,
      };
    }
    if (!Number.isFinite(state.sourceExecutionCount) || state.backfillComplete) {
      state = {
        ...state,
        sourceExecutionCount: await countAvailableExecutions(),
        sourceCountCheckedAt: new Date().toISOString(),
      };
    }

    // Recover states produced by the previous reconciliation strategy. Those
    // states had a known missing-ID count but restarted pagination from page 1.
    // Reconcile against the complete source snapshot once and persist the
    // missing summaries directly, avoiding dozens of repeated manual cycles.
    const sourceCount = Number(state.sourceExecutionCount || 0);
    const scannedCount = Number(state.backfillScanned || 0);
    const hasLegacyReconciliationLoop = Boolean(
      Number(state.missingExecutionCount || 0) > 0
      && state.reconciliationCheckedAt
      && (state.backfillStarted === false || (sourceCount > 0 && scannedCount >= sourceCount)),
    );
    if (hasLegacyReconciliationLoop) {
      state = await reconcileArchivedExecutionIds(state, names);
      const recovered = Number(state.reconciliationRecovered || 0);
      const recoveredComplete = state.missingExecutionCount === 0 && !state.reconciliationTruncated;
      state = {
        ...state,
        backfillStarted: true,
        backfillComplete: recoveredComplete,
        backfillCursor: null,
        backfillScanned: Number(state.sourceExecutionCount || 0),
        lastRunProcessed: Number(state.sourceExecutionCount || 0),
        lastRunSaved: recovered,
        lastSyncAt: new Date().toISOString(),
        lastError: null,
        lastRunCompletedAt: new Date().toISOString(),
        lastRunDurationMs: Date.now() - runStartedMs,
        lastRunStatus: "success",
        lastRunTrigger: runTrigger,
        lastSuccessfulSyncAt: new Date().toISOString(),
      };
      await setArchiveSyncState(state);
      invalidateCache("archive:");
      invalidateCache("executions:");
      return {
        status: "ok" as const,
        processed: Number(state.sourceExecutionCount || 0),
        saved: recovered,
        backfillComplete: recoveredComplete,
        backfillCursor: null,
        detailsHydrated: state.detailsHydrated ?? 0,
        detailsPending: state.detailsPending ?? 0,
        detailsUnavailable: state.detailsUnavailable ?? 0,
      };
    }
    const archiveRunId = state.activeArchiveRunId as string;
    const isFirstBackfillRun = !state.backfillStarted;
    let backfillScanned = state.backfillStarted ? Number(state.backfillScanned || 0) : 0;
    let recentCursor: string | null | undefined;
    let newestId: string | null = null;
    const preserveRecentDetails = options.hydrateDetails !== false;

    // Always archive the newest executions first. The document id is the n8n
    // execution id, so repeating this step is idempotent and never duplicates logs.
    for (let page = 0; page < recentPages; page += 1) {
      const response = await fetchArchivePage(recentCursor, preserveRecentDetails);
      const rows = response.data ?? [];
      if (!newestId && rows[0]?.id) newestId = String(rows[0].id);
      const documents = rows.flatMap((row) => {
        const document = toArchivedExecution(row, names, preserveRecentDetails, archiveRunId);
        return document ? [document] : [];
      });
      processed += rows.length;
      if (isFirstBackfillRun) backfillScanned += rows.length;
      saved += await saveArchivePageDocuments(documents, preserveRecentDetails);
      recentCursor = response.nextCursor;
      if (!recentCursor) break;
    }

    // First run starts the historical backfill immediately after the recent pages.
    // Later runs continue from the persisted n8n cursor while still protecting new logs above.
    let backfillCursor = state.backfillStarted ? state.backfillCursor : recentCursor;
    let backfillComplete = Boolean(state.backfillComplete);
    if (!state.backfillStarted && !backfillCursor) backfillComplete = true;

    if (!backfillComplete && backfillPages > 0) {
      for (let page = 0; page < backfillPages; page += 1) {
        if (!backfillCursor) {
          backfillComplete = true;
          break;
        }
        const response = await fetchArchivePage(backfillCursor);
        const rows = response.data ?? [];
        const documents = rows.flatMap((row) => {
          const document = toArchivedExecution(row, names, false, archiveRunId);
          return document ? [document] : [];
        });
        processed += rows.length;
        backfillScanned += rows.length;
        if (documents.length) saved += (await saveArchivedExecutions(documents)).writes;
        backfillCursor = response.nextCursor ?? null;
        backfillComplete = !backfillCursor;

        state = {
          ...state,
          backfillStarted: true,
          backfillComplete,
          backfillCursor,
          backfillScanned,
          lastSyncAt: new Date().toISOString(),
          lastRecentExecutionId: newestId || state.lastRecentExecutionId || null,
          lastRunProcessed: processed,
          lastRunSaved: saved,
          lastError: null,
        };
        await setArchiveSyncState(state);
        if (backfillComplete) break;
      }
    }

    state = {
      ...state,
      backfillStarted: true,
      backfillComplete,
      backfillCursor: backfillCursor ?? null,
      backfillScanned,
      lastSyncAt: new Date().toISOString(),
      lastRecentExecutionId: newestId || state.lastRecentExecutionId || null,
      lastRunProcessed: processed,
      lastRunSaved: saved,
      lastError: null,
      lastRunCompletedAt: new Date().toISOString(),
      lastRunDurationMs: Date.now() - runStartedMs,
      lastRunStatus: "success",
      lastRunTrigger: runTrigger,
      lastSuccessfulSyncAt: new Date().toISOString(),
    };
    if (backfillComplete && options.hydrateDetails !== false) {
      const details = await hydrateArchivedNodeDetails(names, options.detailBatchSize);
      state = {
        ...state,
        detailsHydrated: details.available,
        detailsPending: details.pending,
        detailsUnavailable: details.unavailable,
      };
    }
    if (backfillComplete) {
      try {
        state = await reconcileArchivedExecutionIds(state, names);
        backfillComplete = state.missingExecutionCount === 0 && !state.reconciliationTruncated;
        state = { ...state, backfillComplete };
      } catch (error) {
        console.error("Fluxora archive ID reconciliation failed", error);
      }
    }
    await setArchiveSyncState(state);
    invalidateCache("archive:");
    invalidateCache("executions:archive:");

    return {
      status: "ok" as const,
      processed,
      saved,
      backfillComplete,
      backfillCursor: backfillCursor ?? null,
      detailsHydrated: state.detailsHydrated ?? 0,
      detailsPending: state.detailsPending ?? 0,
      detailsUnavailable: state.detailsUnavailable ?? 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const state = await getArchiveSyncState();
      await setArchiveSyncState({ ...state, lastSyncAt: new Date().toISOString(), lastRunProcessed: processed, lastRunSaved: saved, lastError: message, lastRunStartedAt: runStartedAt, lastRunCompletedAt: new Date().toISOString(), lastRunDurationMs: Date.now() - runStartedMs, lastRunStatus: "failure", lastRunTrigger: runTrigger });
    } catch {}
    console.error("Fluxora archive sync failed", error);
    return { status: "api_error" as const, processed, saved, backfillComplete: false, message };
  }
}

export async function preserveN8nExecutionDetails(batchSize?: number) {
  if (!getConfig()) return { status: "not_configured" as const, hydrated: 0, detailsPending: 0, detailsUnavailable: 0 };
  if (!archiveConfigured()) return { status: "firestore_not_configured" as const, hydrated: 0, detailsPending: 0, detailsUnavailable: 0 };

  try {
    const [{ workflows }, state] = await Promise.all([loadWorkflows(), getArchiveSyncState()]);
    const details = await hydrateArchivedNodeDetails(workflowMap(workflows), batchSize);
    await setArchiveSyncState({
      ...state,
      detailsHydrated: details.available,
      detailsPending: details.pending,
      detailsUnavailable: details.unavailable,
      lastDetailAttempted: details.attempted,
      lastDetailHydrated: details.hydrated,
      lastDetailUnavailable: details.newlyUnavailable,
      lastSyncAt: new Date().toISOString(),
      lastError: null,
    });
    invalidateCache("archive:");
    invalidateCache("executions:");
    return { status: "ok" as const, attempted: details.attempted, hydrated: details.hydrated, newlyUnavailable: details.newlyUnavailable, detailsHydrated: details.available, detailsPending: details.pending, detailsUnavailable: details.unavailable };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "api_error" as const, hydrated: 0, detailsPending: 0, detailsUnavailable: 0, message };
  }
}

async function loadArchivedExecutions(period: Period, includeLegacy = false) {
  const scope = includeLegacy ? "all-stored" : "active";
  return cached(`archive:executions:${scope}:${period}`, 20_000, 2 * 60_000, () => listArchivedExecutions(period, includeLegacy));
}

function mergeExecutions(archived: N8nExecution[], live: N8nExecution[]) {
  const byId = new Map<string, N8nExecution>();
  // Archive records provide the long-term history. Live records overwrite the
  // same id so in-progress status and recently completed data stay current.
  for (const item of archived) if (item.id) byId.set(String(item.id), item);
  for (const item of live) {
    if (!item.id) continue;
    const archivedItem = byId.get(String(item.id));
    byId.set(String(item.id), { ...archivedItem, ...item, sectionName: item.sectionName || archivedItem?.sectionName });
  }
  return Array.from(byId.values()).sort((a, b) => {
    const right = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    const left = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    return right - left;
  });
}

async function loadConsolidatedExecutions(backfillComplete: boolean) {
  // During the initial import, older executions may still exist only in n8n.
  // Once reconciliation is complete, the archive owns the long-term history
  // and only today's live data is needed to keep in-progress rows current.
  // Always build one canonical snapshot. Every dashboard period is filtered
  // from this same set so a shorter period can never exceed "all" because of
  // independently refreshed caches.
  const livePeriod: Period = backfillComplete ? "today" : "all";
  const archive = await loadArchivedExecutions("all", true);
  const live = await fetchExecutionsForPeriod(livePeriod, false).catch((error) => {
    console.error("n8n live executions unavailable; using Firestore archive", { error: error instanceof Error ? error.name : "unknown" });
    return { items: [] as N8nExecution[], truncated: false };
  });
  const items = mergeExecutions(archive.items as N8nExecution[], live.items);
  console.info("Fluxora consolidated executions loaded", {
    period: "all",
    livePeriod,
    backfillComplete,
    archiveCount: archive.items.length,
    liveCount: live.items.length,
    consolidatedCount: items.length,
    truncated: archive.truncated || live.truncated,
  });
  return {
    items,
    truncated: archive.truncated || live.truncated,
  };
}

async function loadExecutions(includeData = false, period: Period = "all") {
  const ttl = period === "today" ? 15_000 : period === "all" ? 30_000 : 25_000;

  // Firestore and n8n are always merged by execution ID. This keeps the totals
  // monotonic across periods while the historical import is still running and
  // also includes records that n8n has already removed.
  if (archiveConfigured() && !includeData) {
    try {
      const stateBefore = await getArchiveSyncState();
      const backfillComplete = stateBefore.backfillComplete === true;
      const snapshot = await cached(
        `executions:consolidated:v3:${backfillComplete ? "complete" : "importing"}`,
        ttl,
        2 * 60_000,
        () => loadConsolidatedExecutions(backfillComplete),
      );
      return {
        ...snapshot,
        items: period === "all" ? snapshot.items : snapshot.items.filter((item) => withinPeriod(item, period)),
      };
    } catch (error) {
      console.error("Firestore archive unavailable; falling back to n8n", error);
    }
  }

  return cached(`executions:${includeData ? "data" : "summary"}:${period}`, ttl, 2 * 60_000, () => fetchExecutionsForPeriod(period, includeData));
}

function aggregate(workflows: N8nWorkflow[], executions: N8nExecution[]) {
  const byWorkflow = new Map<string, N8nExecution[]>();
  for (const execution of executions) {
    if (!execution.workflowId) continue;
    const list = byWorkflow.get(execution.workflowId) ?? [];
    list.push(execution);
    byWorkflow.set(execution.workflowId, list);
  }

  return workflows.map((workflow) => {
    const rows = byWorkflow.get(workflow.id) ?? [];
    const success = rows.filter((item) => statusKind(item.status) === "success").length;
    const errors = rows.filter((item) => statusKind(item.status) === "error").length;
    const running = rows.filter((item) => statusKind(item.status) === "running").length;
    const completed = success + errors;
    const durations = rows.map(durationInSeconds).filter((value): value is number => value !== null);
    const durationSummary = summarizeDurations(durations);
    const last = rows[0];
    return {
      id: workflow.id,
      name: workflow.name,
      active: workflow.active,
      executions: rows.length,
      success,
      errors,
      running,
      successRate: completed ? Number(((success / completed) * 100).toFixed(1)) : null,
      averageDuration: durationSummary.average,
      p50Duration: durationSummary.p50,
      p95Duration: durationSummary.p95,
      lastExecutionAt: last?.startedAt,
      lastStatus: last?.status,
    };
  });
}

export function summarizeDurations(durations: number[]) {
  if (!durations.length) return { average: null, p50: null, p95: null };
  const sorted = durations.toSorted((left, right) => left - right);
  const percentile = (value: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * value) - 1))];
  return {
    average: Number((durations.reduce((total, value) => total + value, 0) / durations.length).toFixed(1)),
    p50: Number(percentile(0.5).toFixed(1)),
    p95: Number(percentile(0.95).toFixed(1)),
  };
}

type TrendSummaryPoint = { total: number; success: number; errors: number };

export function summarizeTrendComparison(rows: TrendSummaryPoint[]) {
  if (rows.length < 2) return null;
  const midpoint = Math.ceil(rows.length / 2);
  const summarize = (items: TrendSummaryPoint[]) => {
    const total = items.reduce((sum, item) => sum + item.total, 0);
    const success = items.reduce((sum, item) => sum + item.success, 0);
    const errors = items.reduce((sum, item) => sum + item.errors, 0);
    const completed = success + errors;
    return { total, errors, successRate: completed ? Number(((success / completed) * 100).toFixed(1)) : null };
  };
  const previous = summarize(rows.slice(0, midpoint));
  const recent = summarize(rows.slice(midpoint));
  const delta = (current: number, baseline: number) => baseline ? Number((((current - baseline) / baseline) * 100).toFixed(1)) : null;
  return {
    executionsDelta: delta(recent.total, previous.total),
    errorsDelta: delta(recent.errors, previous.errors),
    successRateDelta: previous.successRate !== null && recent.successRate !== null ? Number((recent.successRate - previous.successRate).toFixed(1)) : null,
    previous,
    recent,
  };
}

export async function getN8nOverview(period: Period = "7d", workflowIds: string[] = [], inactiveHours = 24) {
  if (!getConfig()) return { status: "not_configured" as const, connected: false as const, metrics: null, chart: [], workflowStats: [], truncated: false };

  try {
    const [workflowResult, executionResult] = await Promise.allSettled([loadWorkflows(), loadExecutions(false, period)]);
    if (executionResult.status === "rejected") throw executionResult.reason;
    const workflows = workflowResult.status === "fulfilled" ? workflowResult.value.workflows : [];
    if (workflowResult.status === "rejected") console.error("n8n workflows unavailable; using archived execution metrics", { error: workflowResult.reason instanceof Error ? workflowResult.reason.name : "unknown" });
    const executionPage = executionResult.value;
    const selectedIds = new Set(workflowIds);
    const selectedWorkflows = workflowIds.length ? workflows.filter((item) => selectedIds.has(item.id)) : workflows;
    const executions = executionPage.items.filter((item) => withinPeriod(item, period) && (!workflowIds.length || (item.workflowId && selectedIds.has(item.workflowId))));
    const success = executions.filter((item) => statusKind(item.status) === "success").length;
    const errors = executions.filter((item) => statusKind(item.status) === "error").length;
    const running = executions.filter((item) => statusKind(item.status) === "running").length;
    const waiting = executions.filter((item) => statusKind(item.status) === "waiting").length;
    const canceled = executions.filter((item) => statusKind(item.status) === "canceled").length;
    const completed = success + errors + canceled;
    const successRate = completed ? Math.round((success / completed) * 1000) / 10 : null;
    const durations = executions.map(durationInSeconds).filter((value): value is number => value !== null);
    const durationSummary = summarizeDurations(durations);
    const inactiveHoursLimit = Math.max(1, Math.min(168, Math.floor(inactiveHours)));
    const inactiveBefore = Date.now() - inactiveHoursLimit * 60 * 60 * 1000;
    const latestExecutionByWorkflow = new Map<string, number>();
    for (const execution of executions) {
      if (!execution.workflowId || !execution.startedAt) continue;
      const startedAt = new Date(execution.startedAt).getTime();
      if (!Number.isFinite(startedAt)) continue;
      const latest = latestExecutionByWorkflow.get(execution.workflowId) ?? 0;
      if (startedAt > latest) latestExecutionByWorkflow.set(execution.workflowId, startedAt);
    }
    const inactiveActiveWorkflows = selectedWorkflows.filter((workflow) => workflow.active && (latestExecutionByWorkflow.get(workflow.id) ?? 0) < inactiveBefore).length;

    const chartDays = period === "today" ? 1 : period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 30;
    const chart = Array.from({ length: chartDays }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (chartDays - 1 - index));
      return { dateKey: date.toISOString().slice(0, 10), day: index === chartDays - 1 ? "Hoje" : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), total: 0, sucesso: 0, erro: 0 };
    });
    executions.forEach((item) => {
      if (!item.startedAt) return;
      const point = chart.find((entry) => entry.dateKey === new Date(item.startedAt as string).toISOString().slice(0, 10));
      if (!point) return;
      point.total += 1;
      if (statusKind(item.status) === "success") point.sucesso += 1;
      if (statusKind(item.status) === "error") point.erro += 1;
    });

    return {
      status: "ok" as const,
      connected: workflowResult.status === "fulfilled",
      metrics: {
        workflows: selectedWorkflows.length || new Set(executions.map((item) => item.workflowId).filter(Boolean)).size,
        active: selectedWorkflows.filter((item) => item.active).length,
        executions: executions.length,
        success,
        successRate,
        // Compatibility alias for the legacy dashboard card. New surfaces use successRate directly.
        health: successRate,
        errors,
        running,
        waiting,
        canceled,
        averageDuration: durationSummary.average,
        p50Duration: durationSummary.p50,
        p95Duration: durationSummary.p95,
        inactiveActiveWorkflows,
        inactiveHours: inactiveHoursLimit,
      },
      chart: chart.map(({ dateKey, ...point }) => point),
      workflowStats: aggregate(selectedWorkflows, executions),
      truncated: executionPage.truncated,
    };
  } catch (error) {
    return { status: errorStatus(error), connected: false as const, metrics: null, chart: [], workflowStats: [], truncated: false };
  }
}

export async function listN8nWorkflows() {
  if (!getConfig()) return { status: "not_configured" as const, connected: false as const, items: [] as any[] };
  try {
    const { workflows, truncated } = await loadWorkflows();
    const items = workflows.map((item) => ({
      id: item.id,
      name: item.name,
      active: item.active,
      updatedAt: item.updatedAt,
      createdAt: item.createdAt,
      tags: item.tags.map((tag) => tag.name),
      nodeCount: item.nodes.length,
      nodes: item.nodes.map((node) => ({ name: node.name || "Node", type: node.type || "unknown" })),
    }));
    return { status: "ok" as const, connected: true as const, items, truncated };
  } catch (error) {
    return { status: errorStatus(error), connected: false as const, items: [], truncated: false };
  }
}

export async function listN8nExecutions() {
  if (!getConfig()) return { status: "not_configured" as const, connected: false as const, items: [] as any[], truncated: false };
  try {
    const [{ workflows }, raw] = await Promise.all([loadWorkflows(), loadExecutions(false, "all")]);
    const names = workflowMap(workflows);
    return { status: "ok" as const, connected: true as const, items: raw.items.map((item) => normalizeExecution(item, names)), truncated: raw.truncated };
  } catch (error) {
    return { status: errorStatus(error), connected: false as const, items: [], truncated: false };
  }
}

export async function listN8nExecutionsPage(input: {
  page: number;
  pageSize: number;
  period: Period;
  search?: string;
  status?: string;
  workflowId?: string;
  sectionName?: string;
}) {
  const empty = { items: [] as any[], total: 0, page: input.page, pageSize: input.pageSize, totalPages: 1, sections: [] as string[], truncated: false };
  if (!getConfig()) return { status: "not_configured" as const, connected: false as const, ...empty };
  try {
    const [{ workflows }, raw] = await Promise.all([loadWorkflows(), loadExecutions(false, input.period)]);
    const names = workflowMap(workflows);
    const normalized = raw.items.map((item) => normalizeExecution(item, names));
    const periodItems = normalized.filter((item) => withinPeriod(item, input.period));
    const workflowItems = periodItems.filter((item) => !input.workflowId || input.workflowId === "all" || item.workflowId === input.workflowId);
    // A workflow name is used only as a display fallback when n8n has no Sticky Note
    // or executed node metadata. Do not expose that fallback in the automation filter.
    const sections = Array.from(new Set(workflowItems
      .filter((item) => item.sectionName && item.sectionName !== item.workflowName)
      .map((item) => item.sectionName)
      .filter((name): name is string => Boolean(name))))
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    const needle = String(input.search || "").trim().toLocaleLowerCase("pt-BR");
    const filtered = workflowItems
      .filter((item) => !input.sectionName || input.sectionName === "all" || item.sectionName === input.sectionName)
      .filter((item) => !input.status || input.status === "all" || (input.status === "error" ? ["error", "failed", "crashed"].includes(item.status) : item.status === input.status))
      .filter((item) => !needle || [item.sectionName, item.workflowName, item.id].some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(needle)));
    const totalPages = Math.max(1, Math.ceil(filtered.length / input.pageSize));
    const page = Math.min(Math.max(1, input.page), totalPages);
    const offset = (page - 1) * input.pageSize;
    return { status: "ok" as const, connected: true as const, items: filtered.slice(offset, offset + input.pageSize), total: filtered.length, page, pageSize: input.pageSize, totalPages, sections, truncated: raw.truncated };
  } catch (error) {
    return { status: errorStatus(error), connected: false as const, ...empty };
  }
}

function nodeRunsFromExecution(execution: N8nExecution) {
  const runData = execution?.data?.resultData?.runData ?? {};
  return Object.entries(runData).flatMap(([nodeName, runs]: [string, any]) => {
    if (!Array.isArray(runs)) return [];
    return runs.map((run: any, index: number) => {
      const outputItems = Array.isArray(run?.data?.main)
        ? run.data.main.reduce((total: number, branch: unknown) => total + (Array.isArray(branch) ? branch.length : 0), 0)
        : 0;
      return {
        nodeName,
        runIndex: index,
        status: run?.error ? "error" : "success",
        startTime: run?.startTime ? new Date(run.startTime).toISOString() : undefined,
        executionTimeMs: typeof run?.executionTime === "number" ? run.executionTime : null,
        source: sanitize(run?.source ?? null),
        input: sanitize(run?.inputOverride ?? null),
        output: sanitize(run?.data?.main ?? null),
        outputItems,
        error: sanitize(run?.error ?? null),
      };
    });
  });
}

export async function getN8nExecutionDetail(id: string) {
  let archiveRunId: string | undefined;
  let archivedFallback: ArchivedExecution | null = null;
  if (archiveConfigured()) {
    try {
      const archived = await getArchivedExecution(id);
      archiveRunId = archived?.archiveRunId;
      if (archived && archived.executionId !== "teste_inicial" && archived.detailsAvailable) {
        return {
          status: "ok" as const,
          connected: true as const,
          execution: {
            id: archived.executionId,
            workflowId: archived.workflowId,
            workflowName: archived.workflowName || "Workflow sem nome",
            sectionName: archived.sectionName,
            status: archived.status || "unknown",
            mode: archived.mode,
            startedAt: archived.startedAt,
            stoppedAt: archived.stoppedAt,
            duration: archived.duration ?? null,
            retryOf: archived.retryOf ?? null,
            retrySuccessId: archived.retrySuccessId ?? null,
            finished: archived.finished ?? Boolean(archived.stoppedAt),
            error: archived.error ?? null,
            lastNodeExecuted: archived.lastNodeExecuted ?? null,
            nodes: Array.isArray(archived.nodes) ? archived.nodes : [],
            archived: true,
            detailsAvailable: true,
          },
        };
      }
      if (archived && archived.executionId !== "teste_inicial") archivedFallback = archived;
    } catch (error) {
      console.error("Could not read archived execution; falling back to n8n", error);
    }
  }

  if (!getConfig()) return { status: "not_configured" as const, connected: false as const, execution: null };
  try {
    const execution = await n8nRequest<N8nExecution>(`/api/v1/executions/${encodeURIComponent(id)}?includeData=true`);
    const [{ workflows }] = await Promise.all([loadWorkflows()]);
    const names = workflowMap(workflows);
    const normalized = normalizeExecution(execution, names);
    if (archiveConfigured()) {
      const document = toArchivedExecution(execution, names, true, archiveRunId);
      if (document) await saveArchivedExecution(document).catch((error) => console.error("Could not archive execution detail", error));
    }
    return {
      status: "ok" as const,
      connected: true as const,
      execution: {
        ...normalized,
        finished: execution.finished ?? Boolean(execution.stoppedAt),
        error: sanitize(execution?.data?.resultData?.error ?? null),
        lastNodeExecuted: execution?.data?.resultData?.lastNodeExecuted ?? null,
        nodes: nodeRunsFromExecution(execution),
      },
    };
  } catch (error) {
    if (archivedFallback) {
      return {
        status: "ok" as const,
        connected: true as const,
        execution: {
          id: archivedFallback.executionId,
          workflowId: archivedFallback.workflowId,
          workflowName: archivedFallback.workflowName || "Workflow sem nome",
          sectionName: archivedFallback.sectionName,
          status: archivedFallback.status || "unknown",
          mode: archivedFallback.mode,
          startedAt: archivedFallback.startedAt,
          stoppedAt: archivedFallback.stoppedAt,
          duration: archivedFallback.duration ?? null,
          retryOf: archivedFallback.retryOf ?? null,
          retrySuccessId: archivedFallback.retrySuccessId ?? null,
          finished: archivedFallback.finished ?? Boolean(archivedFallback.stoppedAt),
          error: archivedFallback.error ?? null,
          lastNodeExecuted: archivedFallback.lastNodeExecuted ?? null,
          nodes: Array.isArray(archivedFallback.nodes) ? archivedFallback.nodes : [],
          archived: true,
          detailsAvailable: Array.isArray(archivedFallback.nodes) && archivedFallback.nodes.length > 0,
        },
      };
    }
    return { status: errorStatus(error), connected: false as const, execution: null };
  }
}

export async function getN8nAnalytics(period: Period = "7d") {
  if (!getConfig()) return { status: "not_configured" as const, connected: false as const, summary: null, trend: [], workflowStats: [], recentErrors: [], incidentGroups: [], nodeStats: [], nodeAnalyticsCoverage: 0, sloSummary: null, reliability: null, anomalies: [], alertSummary: null, truncated: false };
  try {
    const [workflowResult, executionResult, incidentStateResult, sloResult, runbookResult, alertRuleResult] = await Promise.allSettled([loadWorkflows(), loadExecutions(false, period), listIncidentStates(), listWorkflowSlos(), listWorkflowRunbooks(), listWorkflowAlertRules()]);
    if (executionResult.status === "rejected") throw executionResult.reason;
    const workflows = workflowResult.status === "fulfilled" ? workflowResult.value.workflows : [];
    if (workflowResult.status === "rejected") console.error("n8n workflows unavailable; analytics is using archived execution metrics", { error: workflowResult.reason instanceof Error ? workflowResult.reason.name : "unknown" });
    const executionPage = executionResult.value;
    const names = workflowMap(workflows);
    const executions = executionPage.items.filter((item) => withinPeriod(item, period));
    const slos = sloResult.status === "fulfilled" ? sloResult.value : [];
    const sloMap = new Map(slos.map((slo) => [slo.workflowId, slo]));
    const alertRules = alertRuleResult.status === "fulfilled" ? alertRuleResult.value : [];
    const alertRuleMap = new Map(alertRules.map((rule) => [rule.workflowId, rule]));
    const executionsByWorkflow = new Map<string, N8nExecution[]>();
    executions.forEach((item) => executionsByWorkflow.set(item.workflowId || "unknown", [...(executionsByWorkflow.get(item.workflowId || "unknown") || []), item]));
    const stats = aggregate(workflows, executions).filter((item) => item.executions > 0 || alertRuleMap.has(item.id)).map((item) => {
      const slo = sloMap.get(item.id);
      const alertRule = alertRuleMap.get(item.id);
      const successOk = !slo?.enabled || item.successRate == null || item.successRate >= slo.successRateTarget;
      const latencyOk = !slo?.enabled || item.p95Duration == null || item.p95Duration <= slo.p95TargetSeconds;
      const completedExecutions = item.success + item.errors;
      const allowedFailures = slo?.enabled ? Math.max(0, Math.floor(completedExecutions * (1 - slo.successRateTarget / 100))) : null;
      const remainingFailures = allowedFailures == null ? null : Math.max(0, allowedFailures - item.errors);
      const errorBudgetConsumed = allowedFailures == null ? null : allowedFailures === 0 ? (item.errors > 0 ? 100 : 0) : Number(Math.min(100, (item.errors / allowedFailures) * 100).toFixed(1));
      const rows = [...(executionsByWorkflow.get(item.id) || [])].sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime());
      const consecutiveFailures = rows.findIndex((row) => statusKind(row.status) !== "error");
      const failureStreak = consecutiveFailures === -1 ? rows.filter((row) => statusKind(row.status) === "error").length : consecutiveFailures;
      const lastExecutionAt = rows[0]?.startedAt || null;
      const inactiveHours = lastExecutionAt ? Math.max(0, (Date.now() - new Date(lastExecutionAt).getTime()) / 3600000) : null;
      const alertReasons: string[] = [];
      if (alertRule?.enabled && item.successRate != null && (100 - item.successRate) >= alertRule.failureRateThreshold) alertReasons.push(`Taxa de falha em ${(100 - item.successRate).toFixed(1)}%`);
      if (alertRule?.enabled && failureStreak >= alertRule.consecutiveFailures) alertReasons.push(`${failureStreak} falhas consecutivas`);
      if (alertRule?.enabled && inactiveHours != null && inactiveHours >= alertRule.inactivityHours) alertReasons.push(`Sem execução há ${Math.floor(inactiveHours)} horas`);
      return { ...item, slo: slo || null, sloStatus: !slo?.enabled ? "not_configured" as const : successOk && latencyOk ? "met" as const : "breached" as const, errorBudget: slo?.enabled ? { allowedFailures, remainingFailures, consumedPercent: errorBudgetConsumed } : null, alertRule: alertRule || null, alertReasons, failureStreak, lastExecutionAt };
    }).sort((a, b) => b.executions - a.executions);
    const errors = executions.filter((item) => statusKind(item.status) === "error");
    const success = executions.filter((item) => statusKind(item.status) === "success").length;
    const durations = executions.map(durationInSeconds).filter((value): value is number => value !== null);
    const durationSummary = summarizeDurations(durations);
    const completed = success + errors.length;
    const trendMap = new Map<string, { date: string; total: number; success: number; errors: number }>();
    executions.forEach((item) => {
      if (!item.startedAt) return;
      const date = new Date(item.startedAt).toLocaleDateString("pt-BR");
      const row = trendMap.get(date) ?? { date, total: 0, success: 0, errors: 0 };
      row.total += 1;
      if (statusKind(item.status) === "success") row.success += 1;
      if (statusKind(item.status) === "error") row.errors += 1;
      trendMap.set(date, row);
    });
    const recentErrors = errors.slice(0, 100).map((item) => ({ ...normalizeExecution(item, names), lastNodeExecuted: (item as any).lastNodeExecuted ?? null, error: (item as any).error ?? null }));
    const incidentStates = new Map((incidentStateResult.status === "fulfilled" ? incidentStateResult.value : []).map((state) => [state.fingerprint, state]));
    const incidentGroups = Array.from(recentErrors.reduce((groups, item) => {
      const fingerprint = incidentFingerprint({ workflowId: item.workflowId, node: item.lastNodeExecuted || item.sectionName, error: item.error });
      const cause = item.lastNodeExecuted || item.sectionName || item.workflowName;
      const errorMessage = normalizeErrorSignature(item.error);
      const current = groups.get(fingerprint) || { fingerprint, workflowId: item.workflowId, automation: item.sectionName || item.workflowName, workflowName: item.workflowName, cause, errorMessage, count: 0, firstAt: item.startedAt, lastAt: item.startedAt, executionId: item.id };
      current.count += 1;
      if (item.startedAt && (!current.firstAt || item.startedAt < current.firstAt)) current.firstAt = item.startedAt;
      if (item.startedAt && (!current.lastAt || item.startedAt > current.lastAt)) { current.lastAt = item.startedAt; current.executionId = item.id; }
      groups.set(fingerprint, current);
      return groups;
    }, new Map<string, { fingerprint: string; workflowId?: string; automation: string; workflowName: string; cause: string; errorMessage: string; count: number; firstAt?: string; lastAt?: string; executionId: string }>()).values());
    const runbookMap = new Map((runbookResult.status === "fulfilled" ? runbookResult.value : []).map((runbook) => [runbook.workflowId, runbook]));
    const hydratedIncidentGroups = incidentGroups.map((group) => ({ ...group, runbook: group.workflowId ? runbookMap.get(group.workflowId) || null : null, lifecycle: incidentStates.get(group.fingerprint) || { fingerprint: group.fingerprint, status: "new", severity: group.count >= 10 ? "critical" : group.count >= 5 ? "high" : group.count >= 2 ? "medium" : "low" } })).sort((a, b) => b.count - a.count || String(b.lastAt || "").localeCompare(String(a.lastAt || "")));
    const nodeMap = new Map<string, { workflowId: string; workflowName: string; nodeName: string; runs: number; errors: number; durations: number[]; outputItems: number }>();
    let nodeAnalyticsCoverage = 0;
    executions.forEach((execution: any) => {
      const metrics: any[] = Array.isArray(execution.nodeMetrics) ? execution.nodeMetrics : [];
      if (metrics.length) nodeAnalyticsCoverage += 1;
      metrics.forEach((node: any) => {
        const key = `${execution.workflowId || "unknown"}:${node.nodeName || "Node sem nome"}`;
        const row: { workflowId: string; workflowName: string; nodeName: string; runs: number; errors: number; durations: number[]; outputItems: number } = nodeMap.get(key) || { workflowId: execution.workflowId || "unknown", workflowName: execution.workflowName || names.get(execution.workflowId)?.name || "Workflow sem nome", nodeName: node.nodeName || "Node sem nome", runs: 0, errors: 0, durations: [], outputItems: 0 };
        row.runs += 1;
        if (node.status === "error") row.errors += 1;
        if (typeof node.executionTimeMs === "number") row.durations.push(node.executionTimeMs);
        row.outputItems += Number(node.outputItems || 0);
        nodeMap.set(key, row);
      });
    });
    const workflowNodeTime = new Map<string, number>();
    nodeMap.forEach((row) => workflowNodeTime.set(row.workflowId, (workflowNodeTime.get(row.workflowId) || 0) + row.durations.reduce((sum, value) => sum + value, 0)));
    const nodeStats = Array.from(nodeMap.values()).map((row) => {
      const duration = summarizeDurations(row.durations);
      const totalMs = row.durations.reduce((sum, value) => sum + value, 0);
      const workflowTotalMs = workflowNodeTime.get(row.workflowId) || 0;
      return { workflowId: row.workflowId, workflowName: row.workflowName, nodeName: row.nodeName, runs: row.runs, errors: row.errors, errorRate: Number(((row.errors / row.runs) * 100).toFixed(1)), averageMs: duration.average, p50Ms: duration.p50, p95Ms: duration.p95, totalMs, workflowTimeShare: workflowTotalMs ? Number(((totalMs / workflowTotalMs) * 100).toFixed(1)) : 0, outputItems: row.outputItems };
    }).sort((a, b) => b.errors - a.errors || Number(b.p95Ms || 0) - Number(a.p95Ms || 0));
    const trend = Array.from(trendMap.values()).reverse();
    const configuredAlerts = stats.filter((item) => item.alertRule?.enabled);
    return {
      status: "ok" as const,
      connected: workflowResult.status === "fulfilled",
      summary: {
        executions: executions.length,
        success,
        errors: errors.length,
        successRate: completed ? Number(((success / completed) * 100).toFixed(1)) : null,
        averageDuration: durationSummary.average,
        p50Duration: durationSummary.p50,
        p95Duration: durationSummary.p95,
      },
      trend,
      comparison: summarizeTrendComparison(trend),
      workflowStats: stats,
      recentErrors,
      incidentGroups: hydratedIncidentGroups,
      nodeStats,
      nodeAnalyticsCoverage,
      sloSummary: { configured: stats.filter((item) => item.sloStatus !== "not_configured").length, met: stats.filter((item) => item.sloStatus === "met").length, breached: stats.filter((item) => item.sloStatus === "breached").length },
      reliability: summarizeReliability(executions),
      anomalies: detectTrendAnomalies(trend),
      alertSummary: { configured: configuredAlerts.length, triggered: configuredAlerts.filter((item) => item.alertReasons.length > 0).length },
      truncated: executionPage.truncated,
    };
  } catch (error) {
    return { status: errorStatus(error), connected: false as const, summary: null, trend: [], workflowStats: [], recentErrors: [], incidentGroups: [], nodeStats: [], nodeAnalyticsCoverage: 0, sloSummary: null, reliability: null, anomalies: [], alertSummary: null, truncated: false };
  }
}

export async function setN8nWorkflowActive(id: string, active: boolean) {
  if (!getConfig()) return { status: "not_configured" as const, connected: false as const };
  if (process.env.CONTROL_ACTIONS_ENABLED !== "true") {
    return { status: "api_error" as const, connected: true as const, message: "Ações de gerenciamento estão desativadas. Defina CONTROL_ACTIONS_ENABLED=true no Vercel." };
  }
  try {
    await n8nRequest(`/api/v1/workflows/${encodeURIComponent(id)}/${active ? "activate" : "deactivate"}`, { method: "POST" });
    invalidateCache("workflows");
    return { status: "ok" as const, connected: true as const, active };
  } catch (error) {
    return { status: errorStatus(error), connected: false as const };
  }
}

export function isN8nConfigured() {
  return Boolean(getConfig());
}
