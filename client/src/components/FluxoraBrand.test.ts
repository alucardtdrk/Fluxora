import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, expect, it, vi } from "vitest";
import { FluxoraMark } from "./FluxoraBrand";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

it("preserves the original white mark on dark backgrounds", () => {
  for (const light of [true, false]) {
    const html = renderToStaticMarkup(React.createElement(FluxoraMark, { light }));
    expect(html).toContain("/fluxora-mark-transparent.png");
    expect(html.includes("brightness-0 invert")).toBe(light);
    expect(html).toContain('aria-hidden="true"');
  }
});
