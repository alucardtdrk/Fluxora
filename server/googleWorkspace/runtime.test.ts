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
      "empty", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok",
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
    ]);
  });
});
