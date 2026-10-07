import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, expect, it, vi } from "vitest";
import { FluxoraMark } from "./FluxoraBrand";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

it("uses the existing dark-background logo without inverting its pixels", () => {
  for (const light of [true, false]) {
    const html = renderToStaticMarkup(React.createElement(FluxoraMark, { light }));
    expect(html).toContain(light ? "/fluxora-mark-dark.png" : "/fluxora-mark-transparent.png");
    expect(html).not.toContain("brightness-0");
    expect(html).not.toContain("invert");
    expect(html).toContain('aria-hidden="true"');
  }
});
