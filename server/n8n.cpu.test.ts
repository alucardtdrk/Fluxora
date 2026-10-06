import { afterEach, beforeEach, expect, it, vi } from "vitest";

const archive = vi.hoisted(() => ({
  archiveConfigured: vi.fn(() => false),
  getArchiveSyncState: vi.fn(),
  listArchivedExecutions: vi.fn(),
  saveArchivedExecutions: vi.fn(async (items: unknown[]) => ({ writes: items.length })),
  saveArchivedExecution: vi.fn(),
  getArchivedExecution: vi.fn(),
  getArchiveDetailBatch: vi.fn(),
  setArchiveSyncState: vi.fn(),
}));
vi.mock("./firestoreLogs.js", () => archive);
vi.mock("./observability.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./observability.js")>(),
  listIncidentStates: vi.fn(async () => []),
  listWorkflowSlos: vi.fn(async () => []),
  listWorkflowRunbooks: vi.fn(async () => []),
  listWorkflowAlertRules: vi.fn(async () => []),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  archive.archiveConfigured.mockReturnValue(false);
  vi.stubEnv("N8N_BASE_URL", "https://cpu.example.test");
  vi.stubEnv("N8N_API_KEY", "test-key");
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

function mockSource(items: unknown[]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => new Response(JSON.stringify({
    data: String(url).includes("/workflows") ? [{ id: "wf", name: "Workflow" }] : items,
  }), { status: 200 }));
}

it("reuses dashboard calculations, separates filters, expires and invalidates results", async () => {
  vi.useFakeTimers();
  const fetch = mockSource([{ id: "1", workflowId: "wf", status: "error", startedAt: new Date().toISOString() }]);
  const n8n = await import("./n8n.js");
  const overview = await n8n.getN8nOverview("all");
  expect(await n8n.getN8nOverview("all")).toBe(overview);
  expect((await n8n.getN8nOverview("all", ["other"])).metrics?.executions).toBe(0);
  const analytics = await n8n.getN8nAnalytics("all");
  expect(await n8n.getN8nAnalytics("all")).toBe(analytics);
  vi.advanceTimersByTime(30_001);
  expect(await n8n.getN8nOverview("all")).not.toBe(overview);
  n8n.invalidateN8nCache();
  expect(await n8n.getN8nAnalytics("all")).not.toBe(analytics);
  expect(fetch).toHaveBeenCalled();
});

it("reuses normalized history without changing pagination, search or totals", async () => {
  mockSource([
    { id: "1", workflowId: "wf", status: "error" },
    { id: "2", workflowId: "wf", status: "success" },
    { id: "3", workflowId: "wf", status: "crashed" },
  ]);
  const n8n = await import("./n8n.js");
  const all = await n8n.listN8nExecutions();
  expect((await n8n.listN8nExecutions()).items).toBe(all.items);
  const page = await n8n.listN8nExecutionsPage({ period: "all", status: "error", page: 2, pageSize: 1 });
  expect(page).toMatchObject({ total: 2, totalPages: 2, items: [{ id: "3" }] });
  expect((await n8n.listN8nExecutionsPage({ period: "all", search: "2", page: 1, pageSize: 25 })).total).toBe(1);
});

it("bounds notification archive reads and lets live successes replace archived errors", async () => {
  archive.archiveConfigured.mockReturnValue(true);
  archive.getArchiveSyncState.mockResolvedValue({ backfillComplete: true });
  const today = new Date().toISOString();
  archive.listArchivedExecutions.mockResolvedValue({
    items: Array.from({ length: 20 }, (_, index) => ({ id: String(index), workflowId: "wf", status: "error", startedAt: new Date(Date.now() - index * 1000).toISOString() })),
    truncated: false, hasMore: true,
  });
  mockSource([{ id: "0", workflowId: "wf", status: "success", startedAt: today }]);
  const n8n = await import("./n8n.js");
  const result = await n8n.listN8nRecentErrors();
  expect(result.items).toHaveLength(12);
  expect(result.items.some((item) => item.id === "0")).toBe(false);
  expect(archive.listArchivedExecutions).toHaveBeenCalledTimes(1);
  expect(archive.listArchivedExecutions).toHaveBeenCalledWith("all", true, { limit: 100 });
  expect(await n8n.listN8nRecentErrors()).toBe(result);
});

it("continues reading when recent archive pages have too few errors", async () => {
  archive.archiveConfigured.mockReturnValue(true);
  archive.getArchiveSyncState.mockResolvedValue({ backfillComplete: true });
  archive.listArchivedExecutions
    .mockResolvedValueOnce({ items: [{ id: "new", status: "success" }], hasMore: true })
    .mockResolvedValueOnce({ items: [{ id: "old", status: "crashed" }], hasMore: false });
  mockSource([]);
  const n8n = await import("./n8n.js");
  expect((await n8n.listN8nRecentErrors()).items).toMatchObject([{ id: "old" }]);
  expect(archive.listArchivedExecutions).toHaveBeenLastCalledWith("all", true);
});

it.each([false, true])("reconciles completed history only when the last successful scan is due: %s", async (due) => {
  archive.archiveConfigured.mockReturnValue(true);
  archive.getArchiveSyncState.mockResolvedValue({
    archiveFormatVersion: 2, activeArchiveRunId: "run", backfillStarted: true, backfillComplete: true,
    missingExecutionCount: 0, reconciliationTruncated: false,
    reconciliationCheckedAt: new Date(Date.now() - (due ? 25 : 1) * 60 * 60 * 1000).toISOString(),
  });
  archive.listArchivedExecutions.mockResolvedValue({ items: [], truncated: false });
  const fetch = mockSource([]);
  const n8n = await import("./n8n.js");
  expect((await n8n.syncN8nArchive({ recentPages: 1, backfillPages: 0, hydrateDetails: false })).status).toBe("ok");
  expect(archive.listArchivedExecutions).toHaveBeenCalledTimes(due ? 1 : 0);
  expect(fetch.mock.calls.filter(([url]) => String(url).includes("/executions?limit=250"))).toHaveLength(due ? 1 : 0);
});

it("stops at the recent overlap but updates older running executions", async () => {
  archive.archiveConfigured.mockReturnValue(true);
  archive.getArchiveSyncState.mockResolvedValue({
    archiveFormatVersion: 2, activeArchiveRunId: "run", backfillStarted: true, backfillComplete: true,
    missingExecutionCount: 0, reconciliationCheckedAt: new Date().toISOString(),
    lastRecentExecutionId: "recent", activeExecutionIds: ["running"],
  });
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => new Response(JSON.stringify(
    String(url).includes("/workflows") ? { data: [] }
    : String(url).includes("/executions/running") ? { id: "running", status: "success", finished: true }
    : { data: [{ id: "recent", status: "success" }], nextCursor: "older" }
  )));
  const n8n = await import("./n8n.js");
  expect((await n8n.syncN8nArchive({ hydrateDetails: false })).status).toBe("ok");
  expect(fetch.mock.calls.some(([url]) => String(url).includes("cursor=older"))).toBe(false);
  expect(fetch.mock.calls.some(([url]) => String(url).includes("/executions/running"))).toBe(true);
  expect(archive.setArchiveSyncState).toHaveBeenLastCalledWith(expect.objectContaining({ activeExecutionIds: [] }));
  expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"cpuMs":'));
});

it.each([503, 404])("keeps temporary detail failures pending and retires only confirmed missing records: %s", async (status) => {
  archive.archiveConfigured.mockReturnValue(true);
  archive.getArchiveSyncState.mockResolvedValue({});
  archive.getArchiveDetailBatch.mockResolvedValue({ candidates: [{ id: "pending" }], available: 0, pending: 1, unavailable: 0, queueState: { detailsQueueVersion: 1 } });
  archive.getArchivedExecution.mockResolvedValue({ executionId: "pending" });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => String(url).includes("/workflows")
    ? new Response(JSON.stringify({ data: [] })) : new Response("failure", { status }));
  const n8n = await import("./n8n.js");
  const result = await n8n.preserveN8nExecutionDetails(20);
  expect(result).toMatchObject({ status: "ok", detailsPending: status === 404 ? 0 : 1, detailsUnavailable: status === 404 ? 1 : 0 });
  expect(archive.saveArchivedExecution).toHaveBeenCalledTimes(status === 404 ? 1 : 0);
  expect(archive.setArchiveSyncState).toHaveBeenLastCalledWith(expect.objectContaining({ detailsQueueVersion: 1 }));
});
