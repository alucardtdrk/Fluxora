import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Home from "./Home";
import { toast } from "sonner";

const queries = vi.hoisted(() => ({ overview: {} as any, workflows: {} as any, refresh: undefined as undefined | (() => Promise<void>) }));
vi.mock("@/lib/trpc", () => ({ trpc: { n8n: { overview: { useQuery: () => queries.overview }, workflows: { useQuery: () => queries.workflows } } } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: "admin" } }) }));
vi.mock("@/components/OperationsShell", () => ({ default: ({ children }: any) => children }));
vi.mock("@/components/PeriodFilter", () => ({ default: () => null }));
vi.mock("@/components/ui/button", () => ({ Button: ({ children, onClick }: any) => { if (onClick) queries.refresh = onClick; return React.createElement("button", null, children); } }));
vi.mock("@/lib/preferences", () => ({ readPreferredRefreshSeconds: () => 60, readScopedPeriod: () => "7d", readFocusWorkflows: () => [], saveFocusWorkflows: vi.fn(), saveScopedPeriod: vi.fn(), PREFERENCES_UPDATED_EVENT: "preferences" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.stubGlobal("React", React);
  queries.overview = { data: { status: "ok", connected: true, metrics: { executions: 10, success: 9, errors: 1, successRate: 90, health: 90 }, chart: [], workflowStats: [] }, dataUpdatedAt: Date.now(), isPending: false, isError: false, isFetching: false, refetch: vi.fn() };
  queries.workflows = { data: { status: "ok", connected: true, items: [] }, isError: false, refetch: vi.fn() };
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
const render = () => renderToStaticMarkup(React.createElement(Home));

it("shows operational attention when executions failed", () => {
  const html = render();
  expect(html.includes("Tudo sob controle.")).toBe(false);
  expect(html.includes("Há falhas no período.")).toBe(true);
  expect(html.includes("Última consulta bem-sucedida")).toBe(true);
});

it.each(["api_error", "not_configured"])("does not show zero as measured telemetry on %s", (status) => {
  queries.overview.data = { status, connected: false, metrics: null, chart: [], workflowStats: [] };
  const html = render();
  expect(html.includes("Dados indisponíveis")).toBe(true);
  expect(html.includes("Tudo sob controle.")).toBe(false);
  expect(html.match(/text-3xl font-semibold text-foreground">([^<]+)/g)?.every((value) => value.endsWith("—") || value.endsWith("Offline"))).toBe(true);
});

it("identifies retained data after a transport failure", () => {
  queries.overview.isError = true;
  expect(render().includes("Dados desatualizados")).toBe(true);
});

it("identifies old restored telemetry while a new query is pending", () => {
  queries.overview.dataUpdatedAt = Date.now() - 10 * 60_000;
  queries.overview.isFetching = true;
  expect(render().includes("Dados desatualizados")).toBe(true);
});

it.each(["transport", "business"])("does not confirm refresh after a %s failure", async (failure) => {
  render();
  queries.overview.refetch.mockResolvedValue(failure === "transport" ? { isError: true, data: queries.overview.data } : { isError: false, data: { status: "api_error", connected: false } });
  queries.workflows.refetch.mockResolvedValue({ isError: false, data: queries.workflows.data });
  await queries.refresh!();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
});

it("confirms refresh only after both queries succeed", async () => {
  render();
  queries.overview.refetch.mockResolvedValue({ isError: false, data: queries.overview.data });
  queries.workflows.refetch.mockResolvedValue({ isError: false, data: queries.workflows.data });
  await queries.refresh!();
  expect(toast.success).toHaveBeenCalledWith("Dados atualizados");
});

it("does not confirm refresh when only the workflow query failed", async () => {
  render();
  queries.overview.refetch.mockResolvedValue({ isError: false, data: queries.overview.data });
  queries.workflows.refetch.mockResolvedValue({ isError: true, data: queries.workflows.data });
  await queries.refresh!();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
});
