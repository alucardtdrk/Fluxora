import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "cookie";
import type { Express } from "express";
import { registerGoogleOAuthRoutes } from "./googleOAuth";
import { authorizeGoogleUser, getFluxoraUser } from "./access";
import { clearSessionCookie, readSession } from "./auth";
import { createContext } from "./_core/context";
import { createApp } from "./app";
import vercelApp from "../api/index";

vi.mock("./access", async (original) => ({ ...await original<typeof import("./access")>(), authorizeGoogleUser: vi.fn(), getFluxoraUser: vi.fn() }));
vi.mock("./_core/vite", () => ({ setupVite: vi.fn(), serveStatic: vi.fn() }));

const routes = new Map<string, Function>();
function response() {
  return { append: vi.fn(), redirect: vi.fn(), clearCookie: vi.fn(), setHeader: vi.fn() };
}
function startLogin() {
  const res = response();
  routes.get("/api/auth/google")!({ headers: { host: "localhost:3000" }, protocol: "http" }, res);
  const url = new URL(res.redirect.mock.calls[0][0]);
  const cookie = res.append.mock.calls[0][1].split(";")[0];
  return { cookie, state: url.searchParams.get("state"), url };
}
beforeEach(() => {
  for (const [name, value] of Object.entries({ NODE_ENV: "development", JWT_SECRET: "test-session-secret", GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-client-secret", GOOGLE_ALLOWED_DOMAIN: "example.com", GOOGLE_REDIRECT_URI: "", APP_BASE_URL: "" })) vi.stubEnv(name, value);
  registerGoogleOAuthRoutes({ get: (path: string, handler: Function) => routes.set(path, handler) } as Express);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "test-access-token" }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ sub: "123456", email: "user@example.com", email_verified: true, name: "User" }) }));
  vi.mocked(authorizeGoogleUser).mockResolvedValue({ email: "user@example.com", name: "User", role: "operator", active: true });
  vi.mocked(getFluxoraUser).mockResolvedValue({ email: "user@example.com", name: "User", role: "operator", active: true });
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); routes.clear(); });

it("registers the same Google endpoints locally and on Vercel", async () => {
  const localApp = await createApp({} as never);
  for (const app of [localApp, vercelApp]) {
    const paths = app._router.stack.filter((layer: any) => layer.route).map((layer: any) => layer.route.path);
    expect(paths).toContain("/api/auth/google");
    expect(paths).toContain("/api/auth/google/callback");
    expect(paths).not.toContain("/api/oauth/callback");
  }
});

it("uses the local callback and produces a session accepted by the shared context", async () => {
  const login = startLogin();
  expect(login.url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/google/callback");
  const res = response();
  await routes.get("/api/auth/google/callback")!({ headers: { cookie: login.cookie, host: "localhost:3000" }, protocol: "http", query: { code: "test-code", state: login.state } }, res);
  expect(res.redirect).toHaveBeenCalledWith("/");
  const sessionCookie = res.append.mock.calls.find(([, value]) => value.startsWith("app_session_id="))![1];
  expect(sessionCookie).toContain("HttpOnly");
  expect(sessionCookie).toContain("SameSite=Lax");
  const req = { headers: { cookie: sessionCookie.split(";")[0] } };
  expect(readSession(req)).toMatchObject({ email: "user@example.com", role: "operator" });
  expect((await createContext({ req, res } as never)).user?.role).toBe("operator");
  vi.mocked(getFluxoraUser).mockResolvedValue({ email: "user@example.com", name: "User", role: "operator", active: false });
  expect((await createContext({ req, res } as never)).user).toBeNull();
});

it("rejects an invalid state before contacting Google", async () => {
  const res = response();
  await routes.get("/api/auth/google/callback")!({ headers: {}, query: { code: "test-code", state: "invalid" } }, res);
  expect(res.redirect).toHaveBeenCalledWith("/?authError=invalid_state");
  expect(fetch).not.toHaveBeenCalled();
});

it("does not issue a session for a user without application access", async () => {
  vi.mocked(authorizeGoogleUser).mockResolvedValue(null);
  const login = startLogin();
  const res = response();
  await routes.get("/api/auth/google/callback")!({ headers: { cookie: login.cookie }, query: { code: "test-code", state: login.state } }, res);
  expect(res.redirect).toHaveBeenCalledWith("/?authError=access_not_allowed");
  expect(res.append.mock.calls.some(([, value]) => parse(value).app_session_id)).toBe(false);
});

it.each([
  { email: "user@example.com", email_verified: false, error: "email_not_verified" },
  { email: "user@example.com", error: "email_not_verified" },
  { email: "user@other.example", email_verified: true, error: "domain_not_allowed" },
])("rejects an invalid Google identity: $error", async ({ error, ...profile }) => {
  vi.mocked(fetch).mockReset().mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "test-access-token" }) } as Response).mockResolvedValueOnce({ ok: true, json: async () => profile } as Response);
  const login = startLogin();
  const res = response();
  await routes.get("/api/auth/google/callback")!({ headers: { cookie: login.cookie }, query: { code: "test-code", state: login.state } }, res);
  expect(res.redirect).toHaveBeenCalledWith(`/?authError=${error}`);
  expect(authorizeGoogleUser).not.toHaveBeenCalled();
  expect(res.append.mock.calls.some(([, value]) => parse(value).app_session_id)).toBe(false);
});

it.each(["development", "production"])("clears the cookie with matching settings in %s", (mode) => {
  vi.stubEnv("NODE_ENV", mode);
  const res = response();
  clearSessionCookie(res);
  expect(res.clearCookie).toHaveBeenCalledWith("app_session_id", { httpOnly: true, secure: mode === "production", sameSite: "lax", path: "/" });
});
