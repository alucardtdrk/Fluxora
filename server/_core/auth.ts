import crypto from "node:crypto";
import type { Request, Response } from "express";
import { parse, serialize } from "cookie";
import type { FluxoraRole } from "./access.js";

const COOKIE_NAME = "app_session_id";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const OAUTH_STATE_COOKIE = "acc_google_oauth_state";
const OAUTH_STATE_TTL_SECONDS = 60 * 10;

export type AuthenticatedUser = {
  id: number;
  name: string;
  email: string;
  role: FluxoraRole;
};

function secret() { return process.env.JWT_SECRET || ""; }
function googleClientId() { return process.env.GOOGLE_CLIENT_ID || ""; }
function googleClientSecret() { return process.env.GOOGLE_CLIENT_SECRET || ""; }
function allowedDomain() { return (process.env.GOOGLE_ALLOWED_DOMAIN || "").trim().toLowerCase(); }
function sign(payload: string) { return crypto.createHmac("sha256", secret()).update(payload).digest("base64url"); }
function safeEqual(a: string, b: string) { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && crypto.timingSafeEqual(aa, bb); }

export function authConfigured() { return Boolean(secret() && googleClientId() && googleClientSecret()); }

export function createSessionToken(user: AuthenticatedUser) {
  const payload = JSON.stringify({ sub: user.id, name: user.name, email: user.email, role: user.role, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS });
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

export function verifySessionToken(token?: string | null): AuthenticatedUser | null {
  if (!token || !authConfigured()) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  let payload = "";
  try { payload = Buffer.from(encoded, "base64url").toString("utf8"); } catch { return null; }
  if (!safeEqual(signature, sign(payload))) return null;
  try {
    const parsed = JSON.parse(payload) as { sub?: number; name?: string; email?: string; role?: string; exp?: number };
    if (!parsed.exp || parsed.exp <= Math.floor(Date.now() / 1000) || !parsed.email || !parsed.name) return null;
    const domain = allowedDomain();
    if (domain && !parsed.email.toLowerCase().endsWith(`@${domain}`)) return null;
    const role: FluxoraRole = ["admin", "operator", "viewer"].includes(String(parsed.role)) ? parsed.role as FluxoraRole : "viewer";
    return { id: Number(parsed.sub || 1), name: parsed.name, email: parsed.email.toLowerCase(), role };
  } catch { return null; }
}

export function readSession(req: Request) { return verifySessionToken(parse(req.headers.cookie || "")[COOKIE_NAME]); }
export function setSessionCookie(res: Response, user: AuthenticatedUser) {
  res.append("Set-Cookie", serialize(COOKIE_NAME, createSessionToken(user), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_TTL_SECONDS }));
}
export function clearSessionCookie(res: Response) {
  res.setHeader("Set-Cookie", serialize(COOKIE_NAME, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 }));
}
export function createOAuthState(res: Response) {
  const state = crypto.randomBytes(24).toString("base64url");
  res.append("Set-Cookie", serialize(OAUTH_STATE_COOKIE, `${state}.${sign(state)}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: OAUTH_STATE_TTL_SECONDS }));
  return state;
}
export function consumeOAuthState(req: Request, res: Response, receivedState?: string) {
  const [state, signature] = (parse(req.headers.cookie || "")[OAUTH_STATE_COOKIE] || "").split(".");
  res.append("Set-Cookie", serialize(OAUTH_STATE_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 }));
  if (!state || !signature || !receivedState || !safeEqual(signature, sign(state))) return false;
  return safeEqual(state, receivedState);
}
export function getGoogleOAuthConfig() { return { clientId: googleClientId(), clientSecret: googleClientSecret(), allowedDomain: allowedDomain() }; }
