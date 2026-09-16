import { describe, expect, it } from "vitest";
import { incidentFingerprint, normalizeErrorSignature } from "./observability.js";

describe("observability helpers", () => {
  it("groups equivalent errors even when volatile ids change", () => {
    const first = incidentFingerprint({ workflowId: "wf-1", node: "HTTP Request", error: "Request 12345 failed at https://one.test/path" });
    const second = incidentFingerprint({ workflowId: "wf-1", node: "HTTP Request", error: "Request 98765 failed at https://two.test/other" });
    expect(first).toBe(second);
  });

  it("keeps different nodes in different incident groups", () => {
    const first = incidentFingerprint({ workflowId: "wf-1", node: "Node A", error: "Timeout 12345" });
    const second = incidentFingerprint({ workflowId: "wf-1", node: "Node B", error: "Timeout 12345" });
    expect(first).not.toBe(second);
  });

  it("normalizes dynamic values from messages", () => {
    expect(normalizeErrorSignature("Job 123456 failed at https://example.com/run/123456")).toBe("job <n> failed at <url>");
  });
});
