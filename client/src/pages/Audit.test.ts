import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Audit from "./Audit";

const state = vi.hoisted(() => ({ query: {} as any, options: {} as any, input: {} as any, loadMore: undefined as undefined | (() => void) }));
vi.mock("@/lib/trpc", () => ({ trpc: { audit: { list: { useInfiniteQuery: (input: any, options: any) => { state.input = input; state.options = options; return state.query; }, useQuery: () => state.query } } } }));
vi.mock("@/components/OperationsShell", () => ({ default: ({ children }: any) => children }));
vi.mock("@/components/ui/button", () => ({ Button: ({ children, onClick }: any) => { state.loadMore = onClick; return React.createElement("button", null, children); } }));

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.query = { data: { pages: [{ items: [], nextCursor: { documentName: "projects/test-project/databases/(default)/documents/fluxora/data/audit-events/cursor", createdAt: "2026-10-26T10:00:00.000Z" }, searchIncomplete: true }] }, hasNextPage: true, isLoading: false, isError: false, fetchNextPage: vi.fn(), isFetchingNextPage: false };
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
const render = () => renderToStaticMarkup(React.createElement(Audit));

it("does not call a partial search empty and allows continuation", () => {
  const html = render();
  expect(html.includes("Nenhum evento encontrado")).toBe(false);
  expect(html.includes("A busca ainda não terminou")).toBe(true);
  expect(html.includes("Continuar busca")).toBe(true);
  state.loadMore!();
  expect(state.query.fetchNextPage).toHaveBeenCalledOnce();
});

it("shows records from multiple pages and labels counts as loaded records", () => {
  state.query.data.pages = [
    { items: [{ id: "first", action: "First action", category: "access", status: "success" }], nextCursor: { documentName: "projects/test-project/databases/(default)/documents/fluxora/data/audit-events/first", createdAt: "2026-10-26T10:00:00.000Z" } },
    { items: [{ id: "second", action: "Older action", category: "workflow", status: "failure" }], nextCursor: null },
  ];
  state.query.hasNextPage = false;
  const html = render();
  expect(html.includes("First action")).toBe(true);
  expect(html.includes("Older action")).toBe(true);
  expect(html.includes("Eventos carregados")).toBe(true);
  expect(state.options.getNextPageParam({ nextCursor: null })).toBeUndefined();
});
