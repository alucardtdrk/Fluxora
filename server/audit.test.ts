import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listAuditEvents } from "./audit";
import { isFirestoreConfigured, runFirestoreQuery } from "./firestore";

vi.mock("./firestore", () => ({ isFirestoreConfigured: vi.fn(() => true), runFirestoreQuery: vi.fn(), setFirestoreDocument: vi.fn() }));
let records: any[];
const queryFilters: any[] = [];

beforeEach(() => {
  records = Array.from({ length: 1250 }, (_, index) => ({ id: String(2000 - index).padStart(4, "0"), _documentName: `projects/test-project/databases/(default)/documents/fluxora/data/audit-events/${String(2000 - index).padStart(4, "0")}`, createdAt: "2026-10-26T10:00:00.000Z", actor: "user@example.com", category: index === 600 ? "access" : "workflow", status: index === 600 ? "failure" : "success", summary: index === 600 ? "Rare event" : "Common event" }));
  vi.mocked(isFirestoreConfigured).mockReturnValue(true);
  vi.mocked(runFirestoreQuery).mockImplementation(async (query: any) => {
    const filters = query.where?.compositeFilter?.filters ?? (query.where ? [query.where] : []);
    queryFilters.push(...filters);
    let rows = records.filter((row) => filters.every(({ fieldFilter: f }: any) => f.op === "EQUAL" ? row[f.field.fieldPath] === f.value.stringValue : row[f.field.fieldPath] >= f.value.stringValue));
    if (query.startAt) {
      const [at, name] = query.startAt.values.map((value: any) => value.stringValue ?? value.referenceValue);
      rows = rows.filter((row) => row.createdAt < at || (row.createdAt === at && row._documentName < name));
    }
    return rows.slice(0, query.limit);
  });
});
afterEach(() => { vi.clearAllMocks(); queryFilters.length = 0; });

it("finds a matching record beyond the first 500 events", async () => {
  const page = await listAuditEvents({ period: "all", search: "RARE", pageSize: 50 });
  expect(page.items.map((row) => row.id)).toEqual(["1400"]);
  expect(page.nextCursor).not.toBeNull();
});

it("uses automatic date indexing and applies category and status in the server", async () => {
  const page = await listAuditEvents({ period: "all", category: "access", status: "failure", pageSize: 50 });
  expect(page.items).toHaveLength(1);
  expect(queryFilters).toEqual([]);
  for (const [query] of vi.mocked(runFirestoreQuery).mock.calls) {
    expect(query.orderBy).toEqual([
      { field: { fieldPath: "createdAt" }, direction: "DESCENDING" },
      { field: { fieldPath: "__name__" }, direction: "DESCENDING" },
    ]);
  }
  records = [];
  await listAuditEvents({ period: "7d" });
  expect(queryFilters.some(({ fieldFilter }) => fieldFilter.field.fieldPath === "createdAt" && fieldFilter.op === "GREATER_THAN_OR_EQUAL")).toBe(true);
});

it("paginates equal timestamps without repeating or losing records", async () => {
  records = records.slice(0, 110);
  records.forEach((row) => { row.id = "shared-business-id"; });
  const first = await listAuditEvents({ period: "all", pageSize: 50 });
  const second = await listAuditEvents({ period: "all", pageSize: 50, cursor: first.nextCursor });
  const last = await listAuditEvents({ period: "all", pageSize: 50, cursor: second.nextCursor });
  expect([...first.items, ...second.items, ...last.items].map((row) => row._documentName)).toEqual(records.map((row) => row._documentName));
  expect(last.nextCursor).toBeNull();
});

it("continues sparse category and status filters without requiring a composite index", async () => {
  records[600].category = "workflow";
  records[1100].category = "access";
  records[1100].status = "failure";
  const first = await listAuditEvents({ period: "all", category: "access", status: "failure" });
  expect(first.items).toEqual([]);
  expect(first.searchIncomplete).toBe(true);
  expect(first.nextCursor).not.toBeNull();
  const next = await listAuditEvents({ period: "all", category: "access", status: "failure", cursor: first.nextCursor });
  expect(next.items.map((row) => row.id)).toEqual(["0900"]);
  expect(next.nextCursor).toBeNull();
});

it("bounds sparse searches and lets the next request continue instead of hiding older matches", async () => {
  records[1100].summary = "Old match";
  const first = await listAuditEvents({ period: "all", search: "Old match" });
  expect(first.items).toEqual([]);
  expect(first.searchIncomplete).toBe(true);
  expect(first.nextCursor).not.toBeNull();
  expect(runFirestoreQuery).toHaveBeenCalledTimes(4);
  const next = await listAuditEvents({ period: "all", search: "Old match", cursor: first.nextCursor });
  expect(next.items.map((row) => row.id)).toEqual(["0900"]);
  expect(next.nextCursor).toBeNull();
  expect(next.searchIncomplete).toBe(false);
});

it("continues from the last displayed match when a search page fills mid-batch", async () => {
  records = records.slice(0, 75);
  const first = await listAuditEvents({ period: "all", search: "Common", pageSize: 50 });
  const next = await listAuditEvents({ period: "all", search: "Common", pageSize: 50, cursor: first.nextCursor });
  expect([...first.items, ...next.items].map((row) => row.id)).toEqual(records.map((row) => row.id));
});

it("returns an empty page when Firestore is not configured", async () => {
  vi.mocked(isFirestoreConfigured).mockReturnValue(false);
  expect(await listAuditEvents({})).toEqual({ items: [], nextCursor: null, searchIncomplete: false });
  expect(runFirestoreQuery).not.toHaveBeenCalled();
});
