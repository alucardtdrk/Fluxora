import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listArchivedExecutions } from "./firestoreLogs.js";
import { getFirestoreDocument, runFirestoreQuery } from "./firestore.js";

vi.mock("./firestore.js", () => ({
  runFirestoreQuery: vi.fn(), getFirestoreDocument: vi.fn(),
  isFirestoreConfigured: vi.fn(), commitFirestoreDocuments: vi.fn(),
  countFirestoreCollection: vi.fn(), setFirestoreDocument: vi.fn(),
}));
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllEnvs(); });

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
