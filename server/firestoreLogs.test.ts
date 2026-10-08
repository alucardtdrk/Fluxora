import { afterEach, expect, it, vi } from "vitest";
import { listArchivedExecutions } from "./firestoreLogs.js";

const firestore = vi.hoisted(() => ({
  get: vi.fn(),
  query: vi.fn(),
}));

vi.mock("./firestore.js", () => ({
  getFirestoreDocument: firestore.get,
  runFirestoreQuery: firestore.query,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it("includes active executions beyond the first Firestore page without treating the archive as truncated", async () => {
  vi.stubEnv("FIRESTORE_READ_LIMIT", "1000");
  firestore.get.mockResolvedValue({ activeArchiveRunId: "current" });
  const rows = [
    ...Array.from({ length: 1000 }, (_, index) => ({ executionId: `execution-${index}`, archiveRunId: "current" })),
    { executionId: "legacy", archiveRunId: "old" },
    { executionId: "last-current", archiveRunId: "current" },
  ].map((row) => ({ ...row, startedAt: "2026-10-01T00:00:00Z", _documentName: `projects/test/databases/(default)/documents/logs/${row.executionId}` }));
  firestore.query.mockImplementation(async (query: { startAt?: { values: Array<{ referenceValue?: string }> }; limit: number }) => {
    const after = query.startAt?.values[1].referenceValue;
    const start = after ? rows.findIndex((row) => row._documentName === after) + 1 : 0;
    return rows.slice(start, start + query.limit);
  });

  const archive = await listArchivedExecutions("all");

  expect(archive.items).toHaveLength(1001);
  expect(archive.items.at(-1)?.id).toBe("last-current");
  expect(archive.truncated).toBe(false);
  expect((await listArchivedExecutions("all", true)).items).toHaveLength(1002);
});
