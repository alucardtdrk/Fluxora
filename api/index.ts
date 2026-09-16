import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../server/routers.js";
import { createContext } from "../server/_core/context.js";
import {
  authConfigured,
  consumeOAuthState,
  createOAuthState,
  getGoogleOAuthConfig,
  setSessionCookie,
} from "../server/auth.js";
import { syncN8nArchive } from "../server/n8n.js";
import { archiveConfigured, getArchiveSyncState } from "../server/firestoreLogs.js";
import { authorizeGoogleUser } from "../server/access.js";

const app = express();
app.set("trust proxy", 1);

app.use((req: any, _res: any, next: any) => {
  const current = new URL(req.url || "/", "http://localhost");
  const trpcPath = current.searchParams.get("trpcPath");
  const health = current.searchParams.get("health");
  const authPath = current.searchParams.get("authPath");
  const syncN8n = current.searchParams.get("syncN8n");

  if (trpcPath !== null) {
    current.searchParams.delete("trpcPath");
    const suffix = current.searchParams.toString();
    req.url = `/api/trpc/${trpcPath}${suffix ? `?${suffix}` : ""}`;
  } else if (health === "1") {
    req.url = "/api/health";
  } else if (authPath !== null) {
    current.searchParams.delete("authPath");
    const suffix = current.searchParams.toString();
    req.url = `/api/auth/${authPath}${suffix ? `?${suffix}` : ""}`;
  } else if (syncN8n === "1") {
    req.url = "/api/internal/sync-n8n";
  }
  next();
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.get("/api/health", async (_req: any, res: any) => {
  const archiveState = archiveConfigured() ? await getArchiveSyncState().catch(() => null) : null;
  res.status(200).json({ ok: true, service: "fluxora", firestore: archiveConfigured(), archive: archiveState });
});

function syncRequestAuthorized(req: any) {
  const expected = [process.env.FLUXORA_SYNC_SECRET, process.env.CRON_SECRET]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!expected.length) return false;
  const authorization = String(req.headers.authorization || "");
  const headerSecret = String(req.headers["x-fluxora-sync-secret"] || "");
  return expected.some((secret) => authorization === `Bearer ${secret}` || headerSecret === secret);
}

app.all("/api/internal/sync-n8n", async (req: any, res: any) => {
  if (!syncRequestAuthorized(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const startedAt = Date.now();
  const requestId = String(req.headers["x-vercel-id"] || req.headers["x-request-id"] || "");
  console.info(JSON.stringify({ level: "info", message: "history_sync_started", route: "/api/internal/sync-n8n", requestId }));
  // Keep the scheduled cycle bounded and resumable. On Hobby this runs daily;
  // manual cycles use the same batch size and continue from the saved cursor.
  const result = await syncN8nArchive({ recentPages: 1, backfillPages: 2, hydrateDetails: true, detailBatchSize: 300, trigger: "scheduled" });
  const ok = result.status === "ok";
  const log = { level: ok ? "info" : "error", message: ok ? "history_sync_completed" : "history_sync_failed", route: "/api/internal/sync-n8n", requestId, durationMs: Date.now() - startedAt, processed: result.processed, saved: result.saved, status: result.status };
  (ok ? console.info : console.error)(JSON.stringify(log));
  return res.status(ok ? 200 : 500).json({ ok, ...result });
});

function getBaseUrl(req: any) {
  const configured = (process.env.APP_BASE_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;

  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return `${proto}://${host}`;
}

function getRedirectUri(req: any) {
  const configured = (process.env.GOOGLE_REDIRECT_URI || "").trim();
  return configured || `${getBaseUrl(req)}/api/auth/google/callback`;
}

app.get("/api/auth/google", (req: any, res: any) => {
  if (!authConfigured()) {
    return res.redirect("/?authError=google_not_configured");
  }

  const { clientId, allowedDomain } = getGoogleOAuthConfig();
  const state = createOAuthState(res);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(req),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
    access_type: "online",
  });

  if (allowedDomain) params.set("hd", allowedDomain);
  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get("/api/auth/google/callback", async (req: any, res: any) => {
  try {
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    const oauthError = String(req.query.error || "");

    if (oauthError) return res.redirect(`/?authError=${encodeURIComponent(oauthError)}`);
    if (!code || !consumeOAuthState(req, res, state)) {
      return res.redirect("/?authError=invalid_state");
    }

    const { clientId, clientSecret, allowedDomain } = getGoogleOAuthConfig();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: getRedirectUri(req),
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      console.error("Google token exchange failed", tokenResponse.status, await tokenResponse.text());
      return res.redirect("/?authError=token_exchange_failed");
    }

    const token = await tokenResponse.json() as { access_token?: string };
    if (!token.access_token) return res.redirect("/?authError=missing_access_token");

    const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });

    if (!userResponse.ok) {
      console.error("Google userinfo failed", userResponse.status, await userResponse.text());
      return res.redirect("/?authError=userinfo_failed");
    }

    const profile = await userResponse.json() as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      given_name?: string;
    };

    const email = String(profile.email || "").trim().toLowerCase();
    if (!email || profile.email_verified === false) {
      return res.redirect("/?authError=email_not_verified");
    }

    if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) {
      return res.redirect("/?authError=domain_not_allowed");
    }

    const name = String(profile.name || profile.given_name || email.split("@")[0] || "Usuário");
    const authorized = await authorizeGoogleUser({ email, name });
    if (!authorized) return res.redirect("/?authError=access_not_allowed");

    const numericId = Number.parseInt(String(profile.sub || "1").slice(-9), 10) || 1;
    setSessionCookie(res, { id: numericId, name: authorized.name || name, email, role: authorized.role });
    return res.redirect("/");
  } catch (error) {
    console.error("Google OAuth callback error", error);
    return res.redirect("/?authError=oauth_failed");
  }
});

app.use(
  "/api/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  }),
);

export const config = { maxDuration: 300 };
export default app;
