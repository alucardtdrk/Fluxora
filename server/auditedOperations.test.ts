import { afterEach, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { setN8nWorkflowActive } from "./n8n";
import { updateIncidentState } from "./observability";
import { recordAuditEventSafe } from "./audit";
import { continueGoogleWorkspaceSecurityBackfill } from "./googleWorkspace/runtime";
import type { TrpcContext } from "./_core/context";

vi.mock("./n8n", async (original) => ({ ...await original<typeof import("./n8n")>(), setN8nWorkflowActive: vi.fn(), invalidateN8nCache: vi.fn() }));
vi.mock("./observability", async (original) => ({ ...await original<typeof import("./observability")>(), updateIncidentState: vi.fn() }));
vi.mock("./audit", async (original) => ({ ...await original<typeof import("./audit")>(), recordAuditEventSafe: vi.fn() }));
vi.mock("./googleWorkspace/runtime", async (original) => ({ ...await original<typeof import("./googleWorkspace/runtime")>(), continueGoogleWorkspaceSecurityBackfill: vi.fn() }));
afterEach(() => vi.clearAllMocks());

const caller = appRouter.createCaller({ user: { id: 1, email: "admin@example.com", name: "Admin", role: "admin" }, req: {}, res: {} } as TrpcContext);

it.each(["api_error", "not_configured", "firestore_not_configured", "unauthorized", "error", "partial", "unexpected"])("audits %s as failure with its reason", async (status) => {
  vi.mocked(setN8nWorkflowActive).mockResolvedValue({ status, message: "Operation refused" } as never);
  await caller.n8n.toggleWorkflow({ id: "workflow", active: true });
  expect(recordAuditEventSafe).toHaveBeenCalledWith(expect.objectContaining({ status: "failure", reason: "Operation refused", metadata: { resultStatus: status } }));
});

it("records a useful reason when an operation returns no message", async () => {
  vi.mocked(setN8nWorkflowActive).mockResolvedValue({ status: "not_configured" } as never);
  await caller.n8n.toggleWorkflow({ id: "workflow", active: true });
  expect(recordAuditEventSafe).toHaveBeenCalledWith(expect.objectContaining({ status: "failure", reason: expect.stringContaining("not_configured") }));
});

it("keeps completed operations successful", async () => {
  vi.mocked(setN8nWorkflowActive).mockResolvedValue({ status: "ok", connected: true, active: true });
  await caller.n8n.toggleWorkflow({ id: "workflow", active: true });
  expect(recordAuditEventSafe).toHaveBeenCalledWith(expect.objectContaining({ status: "success" }));
});

it.each(["new", "investigating", "resolved"] as const)("does not confuse incident state %s with an operation failure", async (status) => {
  vi.mocked(updateIncidentState).mockResolvedValue({ status } as never);
  await caller.n8n.updateIncident({ fingerprint: "incident", status, severity: "medium", owner: "admin@example.com", note: "Investigated" });
  expect(recordAuditEventSafe).toHaveBeenCalledWith(expect.objectContaining({ status: "success" }));
});

it("audits thrown errors as failure and preserves the error", async () => {
  vi.mocked(setN8nWorkflowActive).mockRejectedValue(new Error("Unavailable"));
  await expect(caller.n8n.toggleWorkflow({ id: "workflow", active: true })).rejects.toThrow("Unavailable");
  expect(recordAuditEventSafe).toHaveBeenCalledWith(expect.objectContaining({ status: "failure", reason: "Unavailable" }));
});

it.each([{ failedSources: [] }, { failedSources: ["drive"] }])("does not hide backfill source failures: $failedSources", async ({ failedSources }) => {
  vi.mocked(continueGoogleWorkspaceSecurityBackfill).mockResolvedValue({ failedSources } as never);
  await caller.workspaceSecurity.continueBackfill();
  expect(recordAuditEventSafe).toHaveBeenCalledWith(expect.objectContaining({ status: failedSources.length ? "failure" : "success" }));
});
