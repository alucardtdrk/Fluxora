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
  ];
  firestore.query.mockImplementation(async (query: { offset?: number; limit: number }) =>
    rows.slice(query.offset ?? 0, (query.offset ?? 0) + query.limit));

  const archive = await listArchivedExecutions("all");

  expect(archive.items).toHaveLength(1001);
  expect(archive.items.at(-1)?.id).toBe("last-current");
  expect(archive.truncated).toBe(false);
  expect((await listArchivedExecutions("all", true)).items).toHaveLength(1002);
});
