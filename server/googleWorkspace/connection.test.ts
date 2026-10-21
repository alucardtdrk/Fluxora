import { describe, expect, it } from "vitest";
import { checkGoogleWorkspaceAccess } from "./connection.js";

describe("Google Workspace connection test", () => {
  it("checks read access without collecting or persisting data", async () => {
    const urls: URL[] = [];
    const result = await checkGoogleWorkspaceAccess({ getJson: async (url: URL) => { urls.push(url); return {}; } } as never, { customerId: "C123" });
    expect(result.ok).toBe(true);
    expect(urls).toHaveLength(17);
    expect(urls.some((url) => url.pathname.endsWith("/drive"))).toBe(true);
    expect(urls.find((url) => url.hostname === "alertcenter.googleapis.com")?.searchParams.get("customerId")).toBe("123");
  });

  it("reports partial permission failures without exposing upstream messages", async () => {
    const result = await checkGoogleWorkspaceAccess({ getJson: async (url: URL) => {
      if (url.pathname.endsWith("/drive")) throw Object.assign(new Error("sensitive upstream details"), { status: 403 });
      return {};
    } } as never, { customerId: "C123" });
    expect(result.ok).toBe(false);
    expect(result.checks.filter((check) => !check.ok)).toEqual([{ source: "Drive", ok: false, message: "Acesso negado. Revise as permissões e a delegação de domínio." }]);
    expect(JSON.stringify(result)).not.toContain("sensitive");
  });
});
