import { afterEach, beforeEach, expect, it, vi } from "vitest";
import handler from "../api/logs";
import { readSession } from "./auth";
import { getFluxoraUser } from "./access";

vi.mock("./auth", () => ({ readSession: vi.fn() }));
vi.mock("./access", () => ({ getFluxoraUser: vi.fn() }));

beforeEach(() => {
  vi.stubEnv("N8N_API_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }));
  vi.mocked(readSession).mockReturnValue({ id: 1, email: "user@example.com", name: "User", role: "viewer" });
  vi.mocked(getFluxoraUser).mockResolvedValue({ email: "user@example.com", name: "User", role: "viewer", active: true });
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
}

it.each(["missing", "disabled", "removed", "unavailable"])("refuses logs when access is %s without querying n8n", async (access) => {
  if (access === "missing") vi.mocked(readSession).mockReturnValue(null);
  if (access === "disabled") vi.mocked(getFluxoraUser).mockResolvedValue({ email: "user@example.com", name: "User", role: "viewer", active: false });
  if (access === "removed") vi.mocked(getFluxoraUser).mockResolvedValue(null);
  if (access === "unavailable") vi.mocked(getFluxoraUser).mockRejectedValue(new Error("unavailable"));
  const res = response();
  await handler({ method: "GET", headers: {}, query: {} }, res);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(fetch).not.toHaveBeenCalled();
  expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
});

it("allows an active viewer and never enables shared caching", async () => {
  const res = response();
  await handler({ method: "GET", headers: {}, query: {} }, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(fetch).toHaveBeenCalled();
  expect(res.setHeader.mock.calls.filter(([name]) => name.toLowerCase() === "cache-control")).toEqual([["Cache-Control", "private, no-store"]]);
});
