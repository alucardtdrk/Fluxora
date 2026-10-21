import { describe, expect, it, vi, beforeEach } from "vitest";
import { incidentFingerprint, normalizeErrorSignature, updateIncidentState } from "./observability.js";

vi.mock("./firestore.js", () => ({ getFirestoreDocument: vi.fn(), runFirestoreQuery: vi.fn(), setFirestoreDocument: vi.fn() }));
import { getFirestoreDocument, setFirestoreDocument } from "./firestore.js";
beforeEach(() => vi.resetAllMocks());
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

it("requires an owner for investigation and a recorded solution for resolution", async () => {
  await expect(updateIncidentState({ fingerprint: "a", status: "investigating", severity: "high" }, "operator@example.com")).rejects.toThrow("responsável");
  await expect(updateIncidentState({ fingerprint: "a", status: "resolved", severity: "high", owner: "operator@example.com", note: "  " }, "operator@example.com")).rejects.toThrow("resultado");
  expect(setFirestoreDocument).not.toHaveBeenCalled();
});

it("starts attendance directly in investigation and keeps a readable history", async () => {
  vi.mocked(getFirestoreDocument).mockResolvedValue(null);
  const result = await updateIncidentState({ fingerprint: "a", firstOccurredAt: "2026-10-01T12:00:00Z", status: "investigating", severity: "high", owner: " operator@example.com ", note: " Verificando a execução " }, "operator@example.com");
  expect(result).toMatchObject({ status: "investigating", owner: "operator@example.com", note: "Verificando a execução", timeToAcknowledgeMinutes: expect.any(Number) });
  expect(result.history?.[0].action).toBe("Status definido: Em investigação");
});

it("maps legacy acknowledged updates to investigation without losing existing history", async () => {
  vi.mocked(getFirestoreDocument).mockResolvedValue({ fingerprint: "a", status: "acknowledged", history: [{ at: "2026-10-01T12:00:00Z", actor: "operator@example.com", action: "Incidente definido como acknowledged" }], note: "Verificando" });
  const result = await updateIncidentState({ fingerprint: "a", status: "acknowledged", severity: "high", owner: "operator@example.com", note: "Verificando" }, "operator@example.com");
  expect(result.status).toBe("investigating");
  expect(result.history).toHaveLength(2);
  expect(result.history?.[1]).toMatchObject({ action: "Investigação atualizada", note: null });
});