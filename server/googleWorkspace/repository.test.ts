import { describe, expect, it } from "vitest";
import { sanitizeWorkspaceSecurityMetadata, type WorkspaceSecurityEvent, type WorkspaceSecurityFinding } from "./types.js";
import {
  createGoogleWorkspaceRepository,
  WORKSPACE_SECURITY_FINDINGS_COLLECTION,
  type WorkspaceFirestoreAdapter,
  type WorkspaceFirestoreWrite,
} from "./repository.js";

class MemoryFirestoreAdapter implements WorkspaceFirestoreAdapter {
  readonly documents = new Map<string, Record<string, unknown>>();
  readonly operations: string[] = [];
  failNextCommit = false;

  async commit(writes: readonly WorkspaceFirestoreWrite[]): Promise<void> {
    this.operations.push("commit");
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw new Error("token secret-value was rejected");
    }

    for (const write of writes) {
      this.documents.set(`${write.collection}/${write.id}`, structuredClone(write.data));
    }
  }

  async merge(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
    this.operations.push("merge");
    const key = `${collection}/${id}`;
    this.documents.set(key, { ...this.documents.get(key), ...structuredClone(data) });
  }
}

function event(overrides: Partial<WorkspaceSecurityEvent> = {}): WorkspaceSecurityEvent {
  return {
    id: "event-1",
    externalId: "google-event-1",
    source: "login",
    category: "authentication",
    type: "login_failure",
    severity: "medium",
    title: "Falha de login",
    description: "O Google bloqueou uma tentativa de login.",
    occurredAt: new Date("2026-09-16T10:00:00.000Z"),
    observedAt: new Date("2026-09-16T10:05:00.000Z"),
    expiresAt: new Date("2027-03-18T10:00:00.000Z"),
    actor: "admin@example.com",
    metadata: sanitizeWorkspaceSecurityMetadata({ method: "password" }).metadata,
    ...overrides,
  };
}

function finding(): WorkspaceSecurityFinding {
  return {
    id: "finding-1", rule: "suspicious_login_then_oauth", severity: "high", title: "Risco", description: "Risco correlacionado",
    subjects: ["admin@example.com"], ipAddresses: ["198.51.100.10"], eventIds: ["event-1"],
    firstOccurredAt: new Date("2026-09-16T10:00:00.000Z"), lastOccurredAt: new Date("2026-09-16T10:10:00.000Z"), evidenceCount: 2,
    expiresAt: new Date("2027-03-18T10:00:00.000Z"),
  };
}

describe("Google Workspace repository", () => {
  it("upserts the same external event without duplication", async () => {
    const adapter = new MemoryFirestoreAdapter();
    const repository = createGoogleWorkspaceRepository(adapter, () => new Date("2026-09-16T10:10:00.000Z"));
    const input = {
      source: "login" as const,
      events: [event()],
      nextCursor: "cursor-1",
      attemptedAt: "2026-09-16T10:09:00.000Z",
    };

    await repository.saveSourceBatch(input);
    await repository.saveSourceBatch(input);

    const storedEvents = [...adapter.documents.keys()].filter((key) =>
      key.startsWith("fluxora/data/workspace-security-events/"),
    );
    expect(storedEvents).toEqual(["fluxora/data/workspace-security-events/event-1"]);
  });

  it("writes an event batch before advancing its source cursor", async () => {
    const adapter = new MemoryFirestoreAdapter();
    const repository = createGoogleWorkspaceRepository(adapter, () => new Date("2026-09-16T10:10:00.000Z"));

    await repository.saveSourceBatch({
      source: "login",
      events: [event()],
      nextCursor: "cursor-2",
      lastSuccessfulEventAt: "2026-09-16T10:00:00.000Z",
      attemptedAt: "2026-09-16T10:09:00.000Z",
    });

    expect(adapter.operations).toEqual(["commit"]);
    expect(adapter.documents.get("fluxora/data/workspace-sync-state/login")).toMatchObject({
      cursor: "cursor-2",
      lastAttemptedAt: new Date("2026-09-16T10:09:00.000Z"),
      lastSucceededAt: new Date("2026-09-16T10:10:00.000Z"),
      lastSuccessfulEventAt: new Date("2026-09-16T10:00:00.000Z"),
      lastError: null,
    });
  });

  it("splits large batches while advancing the checkpoint only in the final write", async () => {
    const adapter = new MemoryFirestoreAdapter();
    const repository = createGoogleWorkspaceRepository(adapter);
    const events = Array.from({ length: 500 }, (_value, index) => event({ id: `event-${index}`, externalId: `google-event-${index}` }));

    await repository.saveSourceBatch({ source: "login", events, attemptedAt: "2026-09-16T10:09:00.000Z" });

    expect(adapter.operations).toEqual(["commit", "commit"]);
    expect(adapter.documents.get("fluxora/data/workspace-sync-state/login")).toMatchObject({ source: "login", lastError: null });
  });

  it("does not advance the cursor when a batch write fails", async () => {
    const adapter = new MemoryFirestoreAdapter();
    adapter.documents.set("fluxora/data/workspace-sync-state/login", { cursor: "safe-cursor" });
    adapter.failNextCommit = true;
    const repository = createGoogleWorkspaceRepository(adapter);

    await expect(repository.saveSourceBatch({
      source: "login",
      events: [event()],
      nextCursor: "unsafe-cursor",
      attemptedAt: "2026-09-16T10:09:00.000Z",
    })).rejects.toThrow("token secret-value was rejected");

    expect(adapter.documents.get("fluxora/data/workspace-sync-state/login")).toMatchObject({
      cursor: "safe-cursor",
      lastError: "persistence",
    });
    expect(adapter.documents.has("fluxora/data/workspace-security-events/event-1")).toBe(false);
  });

  it("stores directory posture separately from audit events", async () => {
    const adapter = new MemoryFirestoreAdapter();
    const repository = createGoogleWorkspaceRepository(adapter);

    await repository.saveDirectoryPosture({
      id: "current",
      capturedAt: new Date("2026-09-16T10:00:00.000Z"),
      users: { total: 25, suspended: 2 },
      groups: { total: 8 },
      roles: { delegatedAdmins: 3 },
    });

    expect(adapter.documents.get("fluxora/data/workspace-directory-posture/current")).toMatchObject({
      users: { total: 25, suspended: 2 },
    });
    expect([...adapter.documents.keys()].some((key) => key.startsWith("fluxora/data/workspace-security-events/"))).toBe(false);
  });

  it("persists only a safe error summary in synchronization state", async () => {
    const adapter = new MemoryFirestoreAdapter();
    adapter.failNextCommit = true;
    const repository = createGoogleWorkspaceRepository(adapter);

    await expect(repository.saveSourceBatch({
      source: "login",
      events: [event()],
      attemptedAt: "2026-09-16T10:09:00.000Z",
    })).rejects.toThrow();

    const state = adapter.documents.get("fluxora/data/workspace-sync-state/login");
    expect(state).toEqual({
      source: "login",
      lastAttemptedAt: new Date("2026-09-16T10:09:00.000Z"),
      lastError: "persistence",
    });
    expect(JSON.stringify(state)).not.toContain("secret-value");
  });

  it("upserts correlated findings separately from source events", async () => {
    const adapter = new MemoryFirestoreAdapter();
    const repository = createGoogleWorkspaceRepository(adapter);

    await repository.saveFindings([finding()]);

    expect(adapter.documents.get(`${WORKSPACE_SECURITY_FINDINGS_COLLECTION}/finding-1`)).toMatchObject({
      rule: "suspicious_login_then_oauth",
      eventIds: ["event-1"],
    });
  });
});
