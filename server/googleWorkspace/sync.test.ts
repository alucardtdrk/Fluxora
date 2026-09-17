import { describe, expect, it } from "vitest";
import { createWorkspaceSync, type WorkspaceSyncSource } from "./sync.js";

const source = (name: string, result: "ok" | "fail"): WorkspaceSyncSource => ({ name, run: async () => result === "ok" ? { collected: 2, persisted: 2 } : Promise.reject(new Error("secret upstream response")) });

describe("Workspace sync", () => {
  it("persists successful sources when another source fails", async () => {
    const sync = createWorkspaceSync({ sources: [source("login", "ok"), source("drive", "fail")] });
    const summary = await sync.run();
    expect(summary.status).toBe("partial");
    expect(summary.sources.login).toMatchObject({ status: "success", persisted: 2 });
    expect(summary.sources.drive).toEqual({ status: "failure", collected: 0, persisted: 0, safeError: "unknown" });
  });

  it("returns failure when every source fails", async () => {
    const summary = await createWorkspaceSync({ sources: [source("login", "fail")] }).run();
    expect(summary.status).toBe("failure");
  });

  it("does not run two sync cycles concurrently", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const sync = createWorkspaceSync({ sources: [{ name: "login", run: async () => { await pending; return { collected: 0, persisted: 0 }; } }] });
    const first = sync.run();
    await expect(sync.run()).resolves.toMatchObject({ status: "skipped_locked" });
    release();
    await expect(first).resolves.toMatchObject({ status: "success" });
  });
});
