import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./firestore.js", () => ({ getFirestoreDocument: vi.fn(), setFirestoreDocument: vi.fn(), runFirestoreQuery: vi.fn() }));
vi.mock("./n8n.js", () => ({ getN8nAnalytics: vi.fn() }));
import { getFirestoreDocument, setFirestoreDocument, runFirestoreQuery } from "./firestore.js";
import { getN8nAnalytics } from "./n8n.js";
import { sendDailyChatSummary } from "./googleChatDailySummary.js";

const request = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", request);
  vi.stubEnv("GOOGLE_CHAT_DAILY_SUMMARY_WEBHOOK_URL", "https://chat.googleapis.com/v1/spaces/test/messages?key=test&token=test");
  vi.stubEnv("APP_BASE_URL", "https://fluxora.example.com");
  vi.mocked(getFirestoreDocument).mockResolvedValue(null);
  vi.mocked(setFirestoreDocument).mockResolvedValue(undefined);
  vi.mocked(runFirestoreQuery).mockResolvedValue([]);
  vi.mocked(getN8nAnalytics).mockResolvedValue({ status: "ok", truncated: false, executionSummary24h: { executions: 120, success: 115, errors: 3, others: 2, workflows: 4, successRate: 97.5 }, incidentGroups: [
    { lifecycle: { status: "new", severity: "high", owner: null } },
    { lifecycle: { status: "acknowledged", severity: "low" } },
  ] } as never);
  request.mockResolvedValue({ ok: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const collection = { status: "success", sources: { login: { status: "ok" } } };
describe("daily Google Chat summary", () => {
  it("stays disabled without a destination", async () => {
    vi.stubEnv("GOOGLE_CHAT_DAILY_SUMMARY_WEBHOOK_URL", "");
    expect(await sendDailyChatSummary(collection)).toEqual({ status: "disabled" });
    expect(getN8nAnalytics).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
  it("sends counts and links without exposing incident details", async () => {
    expect(await sendDailyChatSummary(collection)).toEqual({ status: "sent" });
    const [url, options] = request.mock.calls[0];
    expect(url.searchParams.get("requestId")).toBeTruthy();
    expect(options.redirect).toBe("error");
    const { text } = JSON.parse(options.body);
    expect(text).toContain("1 pendentes · 1 em investigação");
    expect(text).toContain("120 execuções · 4 workflows");
    expect(text).toContain("115 com sucesso · 3 com erro");
    expect(text).toContain("97,5%");
    expect(text).toContain("Coleta Workspace: concluída");
    expect(text).toContain("https://fluxora.example.com/monitoring");
    expect(setFirestoreDocument).toHaveBeenCalledTimes(2);
  });
  it("does not send a second summary already delivered for the day", async () => {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    vi.mocked(getFirestoreDocument).mockResolvedValue({ day, sentAt: new Date().toISOString() });
    expect(await sendDailyChatSummary(collection)).toEqual({ status: "already_sent" });
    expect(request).not.toHaveBeenCalled();
  });
  it("shows unavailable data and collection failures instead of reporting zero risk", async () => {
    vi.mocked(getN8nAnalytics).mockRejectedValue(new Error("private error"));
    vi.mocked(runFirestoreQuery).mockRejectedValue(new Error("private error"));
    await sendDailyChatSummary({ status: "failure", sources: {} });
    const { text } = JSON.parse(request.mock.calls[0][1].body);
    expect(text).toContain("Incidentes: dados indisponíveis");
    expect(text).toContain("Segurança: dados indisponíveis");
    expect(text).toContain("Coleta Workspace: falhou");
    expect(text).not.toContain("private error");
  });
  it("blocks unexpected destinations and keeps delivery errors sanitized", async () => {
    vi.stubEnv("GOOGLE_CHAT_DAILY_SUMMARY_WEBHOOK_URL", "https://evil.example/messages?key=test&token=secret");
    expect(await sendDailyChatSummary(collection)).toEqual({ status: "invalid_configuration" });
    expect(request).not.toHaveBeenCalled();
    vi.stubEnv("GOOGLE_CHAT_DAILY_SUMMARY_WEBHOOK_URL", "https://chat.googleapis.com/v1/spaces/test/messages?key=test&token=test");
    request.mockRejectedValue(new Error("private token"));
    expect(await sendDailyChatSummary(collection)).toEqual({ status: "failed" });
  });
});

it("reuses a pending message on retry without recomputing data", async () => {
  vi.mocked(getFirestoreDocument).mockResolvedValue({ text: "Resumo pendente" });
  expect(await sendDailyChatSummary(collection)).toEqual({ status: "sent" });
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ text: "Resumo pendente" });
  expect(getN8nAnalytics).not.toHaveBeenCalled();
});

it("does not mark unsuccessful HTTP delivery as sent", async () => {
  request.mockResolvedValue({ ok: false });
  expect(await sendDailyChatSummary(collection)).toEqual({ status: "failed" });
  expect(setFirestoreDocument).toHaveBeenCalledTimes(1);
  expect(vi.mocked(setFirestoreDocument).mock.calls[0][2]).toMatchObject({ status: "pending" });
});