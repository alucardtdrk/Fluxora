import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getN8nOverview, isN8nConfigured, summarizeDurations, summarizeTrendComparison } from "./n8n";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.stubEnv("FIREBASE_PROJECT_ID", "");
  vi.stubEnv("FIREBASE_CLIENT_EMAIL", "");
  vi.stubEnv("FIREBASE_PRIVATE_KEY", "");
});

describe("n8n server integration", () => {
  it("summarizes durations using the median and p95", () => {
    expect(summarizeDurations([1, 2, 3, 4, 100])).toEqual({ average: 22, p50: 3, p95: 100 });
  });

  it("compares the most recent half of a trend with its earlier half", () => {
    expect(summarizeTrendComparison([
      { total: 10, success: 9, errors: 1 },
      { total: 10, success: 8, errors: 2 },
      { total: 20, success: 17, errors: 3 },
      { total: 20, success: 16, errors: 4 },
    ])).toMatchObject({ executionsDelta: 100, errorsDelta: 133.3, successRateDelta: -2.5 });
  });

  it("returns a not_configured status when server credentials are absent", async () => {
    vi.stubEnv("N8N_BASE_URL", "");
    vi.stubEnv("N8N_API_KEY", "");
    expect(isN8nConfigured()).toBe(false);
    await expect(getN8nOverview()).resolves.toMatchObject({ status: "not_configured", connected: false, metrics: null });
  });

  it("keeps the API key server-side when calling the n8n API", async () => {
    vi.stubEnv("N8N_BASE_URL", "https://n8n.example.test");
    vi.stubEnv("N8N_API_KEY", "server-only-test-key");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(getN8nOverview()).resolves.toMatchObject({ status: "ok", connected: true });
    expect(fetchMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect((init?.headers as Record<string, string>)["X-N8N-API-KEY"]).toBe("server-only-test-key");
  });

  it("returns an unauthorized status instead of treating an auth failure as empty telemetry", async () => {
    vi.stubEnv("N8N_BASE_URL", "https://n8n.example.test");
    vi.stubEnv("N8N_API_KEY", "invalid-test-key");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    await expect(getN8nOverview()).resolves.toMatchObject({ status: "unauthorized", connected: false, metrics: null });
  });

  it("activates a workflow through the server-side n8n API", async () => {
    vi.stubEnv("N8N_BASE_URL", "https://n8n.example.test");
    vi.stubEnv("N8N_API_KEY", "server-only-test-key");
    vi.stubEnv("CONTROL_ACTIONS_ENABLED", "true");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const { setN8nWorkflowActive } = await import("./n8n");
    await expect(setN8nWorkflowActive("workflow-123", true)).resolves.toMatchObject({ status: "ok", active: true });
    expect(fetchMock).toHaveBeenCalledWith("https://n8n.example.test/api/v1/workflows/workflow-123/activate", expect.objectContaining({ method: "POST" }));
  });
});
