import { describe, expect, it } from "vitest";
import { summarizeDailyExecutions } from "./n8n.js";
const now = new Date("2026-10-21T04:00:00Z");
describe("daily execution metrics", () => {
  it("counts the last 24 hours across midnight and excludes stale or future records", () => {
    const summary = summarizeDailyExecutions([
      { startedAt: "2026-10-20T04:00:00Z", status: "success", workflowId: "a" },
      { startedAt: "2026-10-21T03:30:00Z", status: "error", workflowId: "b" },
      { startedAt: "2026-10-21T03:40:00Z", status: "running", workflowId: "a" },
      { startedAt: "2026-10-20T03:59:00Z", status: "success", workflowId: "c" },
      { startedAt: "2026-10-21T05:00:00Z", status: "success", workflowId: "d" },
    ], now);
    expect(summary).toEqual({ executions: 3, success: 1, errors: 1, others: 1, successRate: 50, workflows: 2 });
  });
  it("does not claim 100% success when there are no completed executions", () => {
    expect(summarizeDailyExecutions([], now).successRate).toBeNull();
  });
});
