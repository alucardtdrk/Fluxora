import { describe, expect, it } from "vitest";
import { WORKSPACE_SECURITY_SOURCES } from "../../../shared/workspaceSecurity";
import { runSecurityRefresh, shouldRefreshCurrentSecurity, summarizeSecurityCollection } from "./workspaceSecurityRefresh";

const now = new Date("2026-10-28T15:00:00Z");
const completeSources = () => WORKSPACE_SECURITY_SOURCES.map(source => ({ source, status: "ok", completedAt: "2026-10-28T14:59:00Z" }));

describe("Workspace security refresh", () => {
  it("checks freshness and pending pages across every expected source", () => {
    expect(shouldRefreshCurrentSecurity(completeSources(), now)).toBe(false);
    expect(shouldRefreshCurrentSecurity(completeSources().slice(0, 6), now)).toBe(true);
    expect(shouldRefreshCurrentSecurity(completeSources().map(s => s.source === "gmail" ? { ...s, status: "incomplete" } : s), now)).toBe(true);
    expect(shouldRefreshCurrentSecurity(completeSources().map(s => s.source === "meet" ? { ...s, completedAt: "2026-10-28T14:50:00Z" } : s), now)).toBe(true);
    expect(shouldRefreshCurrentSecurity(completeSources().map(s => s.source === "chat" ? { ...s, status: "failure" } : s), now)).toBe(true);
  });

  it("only reports a complete timestamp when every source succeeds, using the oldest timestamp", () => {
    expect(summarizeSecurityCollection([]).completedAt).toBeNull();
    expect(summarizeSecurityCollection(completeSources().slice(0, 6)).completedAt).toBeNull();
    expect(summarizeSecurityCollection(completeSources().map(s => s.source === "drive" ? { ...s, status: "incomplete" } : s)).completedAt).toBeNull();
    expect(summarizeSecurityCollection(completeSources().map(s => s.source === "drive" ? { ...s, status: "empty", completedAt: "2026-10-28T14:58:00Z" } : s)).completedAt).toBe("2026-10-28T14:58:00.000Z");
  });

  it("visits all sources in small batches, continues pending pages, and leaves failures for retry", async () => {
    const batches: string[][] = [];
    let gmailPages = 0;
    const result = await runSecurityRefresh(async sources => {
      batches.push([...sources]);
      return { sources: Object.fromEntries(sources.map(source => [source, { status: source === "drive" ? "failure" : source === "gmail" && gmailPages++ === 0 ? "incomplete" : "empty" }])) };
    });
    expect(batches.every(batch => batch.length <= 3)).toBe(true);
    expect(new Set(batches.flat()).size).toBe(14);
    expect(batches.flat().filter(s => s === "gmail")).toHaveLength(2);
    expect(batches.flat().filter(s => s === "drive")).toHaveLength(1);
    expect(result.drive.status).toBe("failure");
    expect(result.gmail.status).toBe("empty");
  });

  it("stops starting requests after leaving the page", async () => {
    let active = true;
    let calls = 0;
    await runSecurityRefresh(async sources => {
      calls++;
      active = false;
      return { sources: Object.fromEntries(sources.map(source => [source, { status: "incomplete" }])) };
    }, { isActive: () => active });
    expect(calls).toBe(1);
  });

  it("retries only selected sources and propagates request errors", async () => {
    const visited: string[] = [];
    await runSecurityRefresh(async sources => {
      visited.push(...sources);
      return { sources: { gmail: { status: "ok" } } };
    }, { sources: ["gmail"] });
    expect(visited).toEqual(["gmail"]);
    await expect(runSecurityRefresh(async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  });

  it("pauses at the time limit without discarding pending page status", async () => {
    let time = 0;
    let calls = 0;
    const result = await runSecurityRefresh(async sources => {
      calls++;
      time = 300_000;
      return { sources: Object.fromEntries(sources.map(source => [source, { status: "incomplete" }])), finishedAt: now.toISOString() };
    }, { now: () => time });
    expect(calls).toBe(1);
    expect(result.login).toEqual({ status: "incomplete", completedAt: now.toISOString() });
  });

  it("does not treat a missing source result as successful", async () => {
    await expect(runSecurityRefresh(async () => ({ sources: {} }))).rejects.toThrow("não retornou o resultado");
  });
});
