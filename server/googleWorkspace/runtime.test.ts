import { describe, expect, it } from "vitest";
import { createGoogleWorkspaceSecuritySync } from "./runtime.js";

describe("Google Workspace security runtime", () => {
  it("collects the full set in bounded batches of at most three one-page sources", async () => {
    const reports: Array<{ application: string; maxPages?: number }> = [];
    let postureRuns = 0;
    const sync = createGoogleWorkspaceSecuritySync({
      config: { customerId: "customer", domain: "example.com" }, client: {} as never,
      repository: {
        getSourceState: async () => null,
        saveSourceBatch: async (input) => ({ insertedOrUpdated: input.events.length }),
        saveDirectoryPosture: async () => undefined, listRecentEvents: async () => [], saveFindings: async () => ({ insertedOrUpdated: 0 }),
      },
      collectAlertCenterBatch: async () => ({ events: [], alertsRead: 0, truncated: false }),
      collectReportsBatch: async (input) => { reports.push({ application: input.application, maxPages: input.maxPages }); return { events: [], pagesRead: 1, recordsRead: 0, truncated: false }; },
      collectDirectory: async () => { postureRuns++; return { capturedAt: new Date(), domain: "example.com" } as never; },
    });
    const first = await sync.runFullBatch(0);
    const lastSources = await sync.runFullBatch(12);
    const last = await sync.runFullBatch(14);
    expect(first.nextIndex).toBe(3);
    expect(first.sources).toHaveProperty("alert_center");
    expect(reports.slice(0, 2)).toEqual([{ application: "login", maxPages: 1 }, { application: "admin", maxPages: 1 }]);
    expect(lastSources.nextIndex).toBe(14);
    expect(last.nextIndex).toBeNull();
    expect(last.sources).toHaveProperty("directory_posture");
    expect(postureRuns).toBe(1);
  });
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

  it("refreshes current security sources without running posture or historical backfill", async () => {
    const reportApplications: string[] = [];
    let alertCollections = 0;
    let postureCollections = 0;
    let reportCollections = 0;
    const sync = createGoogleWorkspaceSecuritySync({
      config: { customerId: "customer", domain: "example.com" }, client: {} as never,
      repository: {
        getSourceState: async () => ({ lastSuccessfulEventAt: null, backfillTargetStart: null, backfillTargetEnd: null, backfillCoveredThrough: null, backfillPageToken: null }),
        saveSourceBatch: async (input) => ({ insertedOrUpdated: input.events.length }),
        saveDirectoryPosture: async () => undefined, listRecentEvents: async () => [], saveFindings: async () => ({ insertedOrUpdated: 0 }),
      },
      collectAlertCenterBatch: async () => { alertCollections += 1; return { events: [], alertsRead: 0, truncated: false }; },
      collectDirectory: async () => { postureCollections += 1; return { capturedAt: new Date(), domain: "example.com" } as never; },
      collectReportsBatch: async (input) => { reportApplications.push(input.application); reportCollections += 1; return { events: [], pagesRead: 1, recordsRead: 0, truncated: false, rangeEnd: new Date() }; },
      now: () => new Date("2026-09-21T15:00:00.000Z"),
    });

    const result = await sync.runCurrent();

    expect(alertCollections).toBe(1);
    expect(reportApplications).toEqual(["login", "admin", "token", "rules"]);
    expect(postureCollections).toBe(0);
    expect(reportCollections).toBe(4);
    expect(result.sources).toHaveProperty("alert_center");
  });

  it("finishes a current refresh after one page per source and resumes remaining pages", async () => {
    const saved: Array<{ source: string; current?: { start: string; end: string; pageToken?: string }; lastSuccessfulEventAt?: string }> = [];
    const reportRequests: Array<{ application: string; maxPages?: number; startPageToken?: string; rangeStart?: Date; rangeEnd?: Date }> = [];
    const state = new Map<string, { lastSuccessfulEventAt: Date | null; currentStart?: Date | null; currentEnd?: Date | null; currentPageToken?: string | null }>();
    const sync = createGoogleWorkspaceSecuritySync({
      config: { customerId: "customer", domain: "example.com" }, client: {} as never,
      repository: {
        getSourceState: async (source) => state.get(source) ?? null,
        saveSourceBatch: async (input) => {
          saved.push(input);
          state.set(input.source, {
            lastSuccessfulEventAt: input.lastSuccessfulEventAt ? new Date(input.lastSuccessfulEventAt) : null,
            currentStart: input.current?.pageToken ? new Date(input.current.start) : null,
            currentEnd: input.current?.pageToken ? new Date(input.current.end) : null,
            currentPageToken: input.current?.pageToken ?? null,
          });
          return { insertedOrUpdated: input.events.length };
        },
        saveDirectoryPosture: async () => undefined, listRecentEvents: async () => [], saveFindings: async () => ({ insertedOrUpdated: 0 }),
      },
      collectAlertCenterBatch: async () => ({ events: [], alertsRead: 0, truncated: false }),
      collectReportsBatch: async (request) => {
        reportRequests.push(request);
        return { events: [], pagesRead: 1, recordsRead: 0, truncated: !request.startPageToken, nextPageToken: request.startPageToken ? undefined : "second", rangeEnd: request.rangeEnd };
      },
      now: () => new Date("2026-09-23T12:00:00.000Z"),
    });

    const first = await sync.runCurrent();
    const second = await sync.runCurrent();

    expect(first.sources.login).toMatchObject({ status: "incomplete" });
    expect(reportRequests.filter((request) => request.application === "login")).toEqual([
      expect.objectContaining({ maxPages: 1, startPageToken: undefined }),
      expect.objectContaining({ maxPages: 1, startPageToken: "second", rangeStart: reportRequests[0]?.rangeStart, rangeEnd: reportRequests[0]?.rangeEnd }),
    ]);
    expect(second.sources.login).toMatchObject({ status: "empty" });
    expect(saved.filter((item) => item.source === "login").at(-1)?.lastSuccessfulEventAt).toBe("2026-09-23T12:00:00.000Z");
  });
});
