import { beforeEach, expect, it, vi } from "vitest";
import { listArchivedExecutions } from "./firestoreLogs.js";
import { getFirestoreDocument, runFirestoreQuery } from "./firestore.js";

vi.mock("./firestore.js", () => ({
  runFirestoreQuery: vi.fn(), getFirestoreDocument: vi.fn(),
  isFirestoreConfigured: vi.fn(), commitFirestoreDocuments: vi.fn(),
  countFirestoreCollection: vi.fn(), setFirestoreDocument: vi.fn(),
}));
beforeEach(() => { vi.clearAllMocks(); });

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
