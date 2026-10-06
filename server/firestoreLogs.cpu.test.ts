import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listArchivedExecutions, saveArchivedExecutions, getArchiveDetailBatch } from "./firestoreLogs.js";
import { commitFirestoreDocuments, countFirestoreCollection, getFirestoreDocument, runFirestoreQuery } from "./firestore.js";

vi.mock("./firestore.js", () => ({
  runFirestoreQuery: vi.fn(), getFirestoreDocument: vi.fn(),
  isFirestoreConfigured: vi.fn(), commitFirestoreDocuments: vi.fn(),
  countFirestoreCollection: vi.fn(), setFirestoreDocument: vi.fn(),
}));
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllEnvs(); });

it("does not rewrite identical summaries or clear preserved details", async () => {
  vi.mocked(runFirestoreQuery).mockResolvedValue([]);
  vi.mocked(commitFirestoreDocuments).mockResolvedValue({ writes: 1 });
  await saveArchivedExecutions([{ executionId: "1", status: "success", archivedAt: "first" }]);
  const stored = vi.mocked(commitFirestoreDocuments).mock.calls.at(-1)![1][0].data;
  vi.mocked(runFirestoreQuery).mockResolvedValue([{ ...stored, detailsAvailable: true }]);
  vi.mocked(commitFirestoreDocuments).mockClear();
  expect(await saveArchivedExecutions([{ executionId: "1", status: "success", archivedAt: "later" }])).toEqual({ writes: 0 });
  expect(commitFirestoreDocuments).not.toHaveBeenCalled();
  await saveArchivedExecutions([{ executionId: "1", status: "error", archivedAt: "later" }]);
  const update = vi.mocked(commitFirestoreDocuments).mock.calls.at(-1)![1][0].data;
  expect(update.detailsPending).toBe(false);
  expect(update.detailsAvailable).toBeUndefined();
  expect(update.status).toBe("error");
});

it("selects only a bounded pending detail batch after queue preparation", async () => {
  vi.mocked(getFirestoreDocument).mockResolvedValue({ detailsQueueVersion: 1 });
  vi.mocked(countFirestoreCollection).mockResolvedValue(10);
  vi.mocked(runFirestoreQuery).mockResolvedValue([{ executionId: "pending", archiveRunId: "run" }]);
  const batch = await getArchiveDetailBatch(20);
  expect(batch.candidates).toMatchObject([{ id: "pending" }]);
  expect(runFirestoreQuery).toHaveBeenCalledTimes(1);
  expect(runFirestoreQuery).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, where: { fieldFilter: { field: { fieldPath: "detailsPending" }, op: "EQUAL", value: { booleanValue: true } } } }));
});

it("prepares legacy detail markers in resumable pages without fetching node payloads", async () => {
  vi.mocked(getFirestoreDocument).mockResolvedValue({ detailsQueueOffset: 1000 });
  const rows = Array.from({ length: 1000 }, (_, i) => ({ executionId: String(i + 1000), detailsAvailable: i === 0 }));
  vi.mocked(runFirestoreQuery).mockResolvedValueOnce(rows).mockResolvedValueOnce([]);
  vi.mocked(commitFirestoreDocuments).mockResolvedValue({ writes: 1000 });
  vi.mocked(countFirestoreCollection).mockResolvedValue(0);
  const result = await getArchiveDetailBatch(20);
  expect(runFirestoreQuery).toHaveBeenCalledWith(expect.objectContaining({ limit: 1000, offset: 1000 }));
  expect(result.queueState).toEqual({ detailsQueueVersion: undefined, detailsQueueOffset: 2000 });
  expect(commitFirestoreDocuments).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([{ id: "1000", data: { executionId: "1000", detailsPending: false } }]));
});

it("reads all history pages while keeping notification reads bounded", async () => {
  vi.stubEnv("FIRESTORE_READ_LIMIT", "1000");
  const rows = Array.from({ length: 1000 }, (_, i) => ({ executionId: String(i) }));
  vi.mocked(runFirestoreQuery).mockResolvedValueOnce(rows).mockResolvedValueOnce([{ executionId: "last" }]);
  const history = await listArchivedExecutions("all", true);
  expect(history.items).toHaveLength(1001);
  expect(history.truncated).toBe(false);
  expect(runFirestoreQuery).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1000 }));
  vi.mocked(runFirestoreQuery).mockClear().mockResolvedValue(rows.slice(0, 100));
  expect((await listArchivedExecutions("all", true, { limit: 100 })).hasMore).toBe(true);
  expect(runFirestoreQuery).toHaveBeenCalledTimes(1);
});

it("bounds recent archive reads and retains the existing history limit", async () => {
  vi.mocked(runFirestoreQuery).mockResolvedValue(Array.from({ length: 100 }, (_, i) => ({ executionId: String(i) })));
  const page = await listArchivedExecutions("all", true, { limit: 100 });
  expect(runFirestoreQuery).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  expect(getFirestoreDocument).not.toHaveBeenCalled();
  expect(page.hasMore).toBe(true);
  await listArchivedExecutions("all", true, { limit: 1_000_000 });
  expect(runFirestoreQuery).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 25_000 }));
});

it("retains the active archive filter for full history reads", async () => {
  vi.mocked(getFirestoreDocument).mockResolvedValue({ activeArchiveRunId: "active" });
  vi.mocked(runFirestoreQuery).mockResolvedValue([
    { executionId: "1", archiveRunId: "old" },
    { executionId: "2", archiveRunId: "active" },
  ]);
  expect((await listArchivedExecutions("all")).items.map((item) => item.id)).toEqual(["2"]);
});
