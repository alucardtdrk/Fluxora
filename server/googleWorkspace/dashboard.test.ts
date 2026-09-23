import { describe, expect, it } from "vitest";
import { createWorkspaceSecurityDashboard, createWorkspaceEventPage } from "./dashboard.js";

describe("Workspace security dashboard", () => {
  it("pages filtered events without losing later matches", async () => {
    const records = Array.from({ length: 60 }, (_, index) => ({ id: `event-${index}`, source: index % 2 ? "login" : "drive", category: "identity", severity: "high", occurredAt: new Date("2026-09-23T10:00:00Z") }));
    const listBatch = async (offset: number, limit: number) => records.slice(offset, offset + limit);
    const first = await createWorkspaceEventPage({ offset: 0, source: "login", pageSize: 10 }, listBatch);
    const second = await createWorkspaceEventPage({ offset: first.nextOffset!, source: "login", pageSize: 10 }, listBatch);
    const third = await createWorkspaceEventPage({ offset: second.nextOffset!, source: "login", pageSize: 10 }, listBatch);
    expect(first.events.map((event) => event.id)).toEqual(Array.from({ length: 10 }, (_, index) => `event-${index * 2 + 1}`));
    expect(second.events[0].id).toBe("event-21");
    expect(first.nextOffset).toBe(20);
    expect(third.nextOffset).toBeNull();
  });
  it("maps safe event fields and derives dashboard totals", async () => {
    const dashboard = await createWorkspaceSecurityDashboard({
      listEvents: async () => [
        {
          id: "event-high", externalId: "google-alert-123", source: "login", category: "authentication", type: "login_failure", severity: "high", title: "Falha de login", description: "Tentativa bloqueada", occurredAt: new Date("2026-09-17T10:00:00.000Z"), actor: "ana@example.com", target: "admin@example.com", ipAddress: "198.51.100.10", country: "BR", metadata: { token: "hidden", failure_type: "senha incorreta", login_type: "password" }, safeDetails: { affectedUsers: ["ana@example.com"] },
        },
        {
          id: "event-low", source: "drive", category: "data", type: "download", severity: "low", title: "Download", description: "Arquivo acessado", occurredAt: new Date("2026-09-17T09:00:00.000Z"), metadata: { path: "/confidential" },
        },
      ],
      listFindings: async () => [{
        id: "finding-1", rule: "suspicious_login_then_oauth", severity: "high", title: "Login suspeito seguido de OAuth", description: "Risco correlacionado", subjects: ["ana@example.com"], ipAddresses: ["198.51.100.10"], eventIds: ["event-high"], firstOccurredAt: new Date("2026-09-17T10:00:00.000Z"), lastOccurredAt: new Date("2026-09-17T10:05:00.000Z"), evidenceCount: 2,
      }],
      getPosture: async () => ({ users: { suspended: 2, withoutTwoStepVerification: 5 }, withoutTwoStepVerificationUsers: [{ id: "u1", email: "ana@example.com", displayName: "Ana", orgUnitPath: "/Financeiro" }], suspendedUsers: [{ id: "u2", email: "suspenso@example.com" }] }),
      listSources: async () => [{ source: "login", lastStatus: "ok", lastReceived: 3, lastCollected: 2, lastPersisted: 2, lastHttpStatus: 200, backfillPagesProcessed: 3, backfillTargetStart: new Date("2026-06-20T00:00:00Z"), backfillTargetEnd: new Date("2026-09-18T00:00:00Z"), backfillCoveredThrough: new Date("2026-08-04T00:00:00Z") }],
    }).load();

    expect(dashboard.summary).toEqual({ recentEvents: 2, highOrCriticalEvents: 1, openFindings: 1, coveragePercent: 50, backfillPagesProcessed: 3 });
    expect(dashboard.findings[0]).toMatchObject({ rule: "suspicious_login_then_oauth", evidenceCount: 2, subjects: ["ana@example.com"] });
    expect(dashboard.posture).toEqual({ suspendedUsers: 2, usersWithoutTwoStepVerification: 5, suspendedUserDetails: [{ id: "u2", email: "suspenso@example.com" }], usersWithoutTwoStepVerificationDetails: [{ id: "u1", email: "ana@example.com", displayName: "Ana", orgUnitPath: "/Financeiro" }] });
    expect(dashboard.events[0]).toMatchObject({ id: "event-high", externalId: "google-alert-123", source: "login", severity: "high", actor: "ana@example.com", target: "admin@example.com", ipAddress: "198.51.100.10", country: "BR" });
    expect(dashboard.events[0]).not.toHaveProperty("metadata");
    expect(dashboard.events[0]).toMatchObject({ details: [{ label: "Motivo da falha", value: "senha incorreta" }, { label: "Método de login", value: "password" }], safeDetails: { affectedUsers: ["ana@example.com"] } });
    expect(dashboard.summary.coveragePercent).toBe(50);
    expect(dashboard.sources[0]).toMatchObject({ source: "login", received: 3, collected: 2, persisted: 2, httpStatus: 200, coveragePercent: 50, rangeStart: "2026-06-20T00:00:00.000Z", rangeEnd: "2026-09-18T00:00:00.000Z" });
  });

  it("returns an empty posture when none has been synchronized", async () => {
    const dashboard = await createWorkspaceSecurityDashboard({ listEvents: async () => [], listFindings: async () => [], getPosture: async () => null }).load();

    expect(dashboard).toEqual({ events: [], findings: [], summary: { recentEvents: 0, highOrCriticalEvents: 0, openFindings: 0, coveragePercent: 0, backfillPagesProcessed: 0 }, posture: null, sources: [] });
  });

  it("does not count previously stored routine Drive reads as high severity", async () => {
    const record = { id: "drive-read", source: "drive", type: "access_item_content", severity: "high", occurredAt: new Date("2026-09-23T10:00:00Z"), metadata: { visibility: "shared_externally" } };
    const dashboard = await createWorkspaceSecurityDashboard({ listEvents: async () => [record], listFindings: async () => [], getPosture: async () => null }).load();
    const page = await createWorkspaceEventPage({ offset: 0, severity: "high" }, async () => [record]);
    expect(dashboard.summary.highOrCriticalEvents).toBe(0);
    expect(dashboard.events[0]?.severity).toBe("informational");
    expect(page.events).toHaveLength(0);
  });
});
