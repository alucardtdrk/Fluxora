import { describe, expect, it } from "vitest";
import { shouldRefreshCurrentSecurity, summarizeSecurityCollection } from "./workspaceSecurityRefresh";

describe("Workspace security refresh policy", () => {
  it("refreshes when Alert Center has never completed", () => {
    expect(shouldRefreshCurrentSecurity([], new Date("2026-09-21T15:00:00.000Z"))).toBe(true);
  });

  it("refreshes only after Alert Center is five minutes stale", () => {
    const sources = [{ source: "alert_center", completedAt: "2026-09-21T14:54:59.000Z" }];
    expect(shouldRefreshCurrentSecurity(sources, new Date("2026-09-21T15:00:00.000Z"))).toBe(true);
    expect(shouldRefreshCurrentSecurity([{ ...sources[0], completedAt: "2026-09-21T14:56:00.000Z" }], new Date("2026-09-21T15:00:00.000Z"))).toBe(false);
  });

  it("continues an unfinished Alert Center page even when it just ran", () => {
    expect(shouldRefreshCurrentSecurity([{ source: "alert_center", status: "incomplete", completedAt: "2026-09-21T14:59:00.000Z" }], new Date("2026-09-21T15:00:00.000Z"))).toBe(true);
  });
});

describe("Workspace security collection summary", () => {
  it("does not report an empty collection as complete", () => {
    expect(summarizeSecurityCollection([])).toEqual({ latestCompletedAt: null, failed: 0, incomplete: 0, awaiting: 0 });
  });

  it("keeps partial and failed sources visible alongside the latest timestamp", () => {
    expect(summarizeSecurityCollection([
      { status: "ok", completedAt: "2026-10-21T13:00:00Z" },
      { status: "failure", completedAt: "2026-10-21T14:00:00Z" },
      { status: "incomplete", completedAt: "invalid" },
      { status: "unknown" },
    ])).toEqual({ latestCompletedAt: "2026-10-21T14:00:00.000Z", failed: 1, incomplete: 1, awaiting: 1 });
  });

  it("treats an empty successful batch as completed", () => {
    expect(summarizeSecurityCollection([{ status: "empty", completedAt: "2026-10-21T13:00:00Z" }])).toEqual({ latestCompletedAt: "2026-10-21T13:00:00.000Z", failed: 0, incomplete: 0, awaiting: 0 });
  });
});