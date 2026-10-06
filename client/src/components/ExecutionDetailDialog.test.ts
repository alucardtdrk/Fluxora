import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, expect, it, vi } from "vitest";
import { ErrorDetails } from "./ExecutionDetailDialog";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

it("shows the failed step and explains a timeout without requiring technical mode", () => {
  const html = renderToStaticMarkup(createElement(ErrorDetails, { nodeName: "Consultar calendário", error: { message: "ETIMEDOUT" } }));
  expect(html).toContain("Falha na etapa: Consultar calendário");
  expect(html).toContain("O serviço demorou além do tempo permitido");
  expect(html).toContain("Copiar detalhes do erro");
});

it("provides a neutral explanation when the cause is unknown", () => {
  const html = renderToStaticMarkup(createElement(ErrorDetails, { error: null }));
  expect(html).toContain("O serviço não informou uma mensagem de erro.");
  expect(html).toContain("A etapa não conseguiu concluir a operação.");
});
