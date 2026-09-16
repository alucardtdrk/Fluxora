import { describe, expect, it } from "vitest";
import { summarizeReliability } from "./n8n.js";

describe("reliability metrics", () => {
  it("measures recovery after a sequence of failures", () => {
    const result = summarizeReliability([
      { workflowId: "wf-1", status: "error", startedAt: "2026-09-13T10:00:00.000Z" },
      { workflowId: "wf-1", status: "error", startedAt: "2026-09-13T10:05:00.000Z" },
      { workflowId: "wf-1", status: "success", startedAt: "2026-09-13T10:20:00.000Z" },
    ]);
    expect(result.meanRecoveryMinutes).toBe(20);
    expect(result.longestFailureStreak).toBe(2);
    expect(result.openFailures).toBe(0);
  });

  it("keeps unresolved failure sequences open", () => {
    const result = summarizeReliability([
      { workflowId: "wf-1", status: "success", startedAt: "2026-09-13T10:00:00.000Z" },
      { workflowId: "wf-1", status: "error", startedAt: "2026-09-13T10:10:00.000Z" },
    ]);
    expect(result.meanRecoveryMinutes).toBeNull();
    expect(result.openFailures).toBe(1);
  });
});
