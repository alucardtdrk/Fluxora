import { describe, expect, it } from "vitest";
import { createGoogleWorkspaceSecuritySync } from "./runtime.js";

describe("Google Workspace security runtime", () => {
  it("collects each audit source and persists its checkpoint only after the batch", async () => {
    const saved: Array<{ source: string; count: number }> = [];
    const sync = createGoogleWorkspaceSecuritySync({
      config: { customerId: "customer", domain: "example.com" },
      client: {} as never,
      repository: {
        getSourceState: async () => null,
        saveSourceBatch: async (input) => {
          saved.push({ source: input.source, count: input.events.length });
          return { insertedOrUpdated: input.events.length };
        },
        saveDirectoryPosture: async () => undefined,
        listRecentEvents: async () => [],
        saveFindings: async (findings) => ({ insertedOrUpdated: findings.length }),
      },
      collectAlertCenter: async () => [],
      collectReports: async (input) => [{ id: input.application, occurredAt: new Date("2026-09-17T10:00:00.000Z") }] as never,
      collectDirectory: async () => ({ capturedAt: new Date(), domain: "example.com" }) as never,
      now: () => new Date("2026-09-17T10:05:00.000Z"),
    });

    const summary = await sync.run();

    expect(summary.sources).toEqual(expect.objectContaining({
      directory_posture: { status: "ok", collected: 1, persisted: 1 },
    }));
    expect(Object.values(summary.sources).map((source) => source.status)).toEqual([
      "empty", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok",
    ]);
    expect(summary.status).toBe("success");
    expect(saved).toEqual([
      { source: "alert_center", count: 0 },
      { source: "login", count: 1 },
      { source: "admin", count: 1 },
      { source: "oauth_token", count: 1 },
      { source: "drive", count: 1 },
      { source: "groups", count: 1 },
      { source: "mobile", count: 1 },
      { source: "rules", count: 1 },
      { source: "gmail", count: 1 },
      { source: "user_accounts", count: 1 },
      { source: "saml", count: 1 },
      { source: "calendar", count: 1 },
      { source: "chat", count: 1 },
      { source: "meet", count: 1 },
    ]);
  });

  it("advances one resumable historical window without rescanning 90 days", async () => {
    const backfills: Array<{ start?: Date; end?: Date; application: string }> = [];
    const saved: unknown[] = [];
    const sync = createGoogleWorkspaceSecuritySync({
      config: { customerId: "customer", domain: "example.com" }, client: {} as never,
      repository: {
        getSourceState: async () => ({ lastSuccessfulEventAt: null, backfillTargetStart: null, backfillTargetEnd: null, backfillCoveredThrough: null, backfillPageToken: null }),
        saveSourceBatch: async (input) => { saved.push(input); return { insertedOrUpdated: input.events.length }; },
        saveDirectoryPosture: async () => undefined, listRecentEvents: async () => [], saveFindings: async () => ({ insertedOrUpdated: 0 }),
      },
      collectAlertCenter: async () => [], collectReports: async () => [], collectDirectory: async () => ({ capturedAt: new Date(), domain: "example.com" }) as never,
      collectReportsBatch: async (input) => { backfills.push({ start: input.rangeStart, end: input.rangeEnd, application: input.application }); return { events: [], pagesRead: 1, truncated: false }; },
      enableBackfill: true, maxBackfillWindows: 1, now: () => new Date("2026-09-18T12:00:00.000Z"),
    });

    const result = await sync.run();

    expect(backfills).toEqual([{ application: "login", start: new Date("2026-06-20T12:00:00.000Z"), end: new Date("2026-09-18T12:00:00.000Z") }]);
    expect(result.backfill).toMatchObject({ windowsProcessed: 1, targetDays: 90 });
    expect(saved.at(-1)).toMatchObject({ source: "login", backfill: { coveredThrough: "2026-09-18T12:00:00.000Z" } });
  });

  it("continues historical coverage without running the full incremental sync first", async () => {
    let incrementalCollections = 0;
    const saved: unknown[] = [];
    const sync = createGoogleWorkspaceSecuritySync({
      config: { customerId: "customer", domain: "example.com" }, client: {} as never,
      repository: {
        getSourceState: async () => ({ lastSuccessfulEventAt: null, backfillTargetStart: null, backfillTargetEnd: null, backfillCoveredThrough: null, backfillPageToken: null }),
        saveSourceBatch: async (input) => { saved.push(input); return { insertedOrUpdated: input.events.length }; },
        saveDirectoryPosture: async () => undefined, listRecentEvents: async () => [], saveFindings: async () => ({ insertedOrUpdated: 0 }),
      },
      collectAlertCenter: async () => { incrementalCollections += 1; return []; },
      collectReports: async () => { incrementalCollections += 1; return []; },
      collectDirectory: async () => { incrementalCollections += 1; return { capturedAt: new Date(), domain: "example.com" } as never; },
      collectReportsBatch: async () => ({ events: [], pagesRead: 1, truncated: false }),
      maxBackfillWindows: 1,
      now: () => new Date("2026-09-18T12:00:00.000Z"),
    });

    const result = await sync.continueBackfill();

    expect(incrementalCollections).toBe(0);
    expect(result).toMatchObject({ windowsProcessed: 1, failedSources: [], targetDays: 90 });
    expect(saved).toHaveLength(1);
  });

  it("caps a manual cycle at 300 events while checkpointing each page", async () => {
    const requestedPageSizes: number[] = [];
    const sync = createGoogleWorkspaceSecuritySync({
      config: { customerId: "customer", domain: "example.com" }, client: {} as never,
      repository: {
        getSourceState: async () => ({ lastSuccessfulEventAt: null, backfillTargetStart: null, backfillTargetEnd: null, backfillCoveredThrough: null, backfillPageToken: null }),
        saveSourceBatch: async (input) => ({ insertedOrUpdated: input.events.length }),
        saveDirectoryPosture: async () => undefined, listRecentEvents: async () => [], saveFindings: async () => ({ insertedOrUpdated: 0 }),
      },
      collectReportsBatch: async (input) => {
        const count = input.pageSize ?? 250;
        requestedPageSizes.push(count);
        return { events: Array.from({ length: count }, (_, index) => ({ id: `${input.application}-${index}` })) as never, pagesRead: 1, nextPageToken: "next", truncated: true };
      },
      now: () => new Date("2026-09-18T12:00:00.000Z"),
    });

    const result = await sync.continueBackfill();

    expect(requestedPageSizes).toEqual([250, 50]);
    expect(result).toMatchObject({ eventsCollected: 300, requestsProcessed: 2 });
  });
});
