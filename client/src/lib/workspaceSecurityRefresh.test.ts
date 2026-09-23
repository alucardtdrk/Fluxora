import { describe, expect, it } from "vitest";
import { shouldRefreshCurrentSecurity } from "./workspaceSecurityRefresh";

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
