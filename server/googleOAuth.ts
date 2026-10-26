import type { Express } from "express";
import {
  authConfigured,
  consumeOAuthState,
  createOAuthState,
  getGoogleOAuthConfig,
  setSessionCookie,
} from "./auth.js";
import { authorizeGoogleUser } from "./access.js";
function getBaseUrl(req: any) {
  const configured = (process.env.APP_BASE_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;

  const proto = String(
    req.headers["x-forwarded-proto"] || req.protocol || "https"
  )
    .split(",")[0]
    .trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}

function getRedirectUri(req: any) {
  const configured = (process.env.GOOGLE_REDIRECT_URI || "").trim();
  return configured || `${getBaseUrl(req)}/api/auth/google/callback`;
}

export function registerGoogleOAuthRoutes(app: Express) {
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
    return res.redirect(
      `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
    );
  });

  app.get("/api/auth/google/callback", async (req: any, res: any) => {
    try {
      const code = String(req.query.code || "");
      const state = String(req.query.state || "");
      const oauthError = String(req.query.error || "");

      if (oauthError)
        return res.redirect(`/?authError=${encodeURIComponent(oauthError)}`);
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
        console.error(
          "Google token exchange failed",
          tokenResponse.status,
          await tokenResponse.text()
        );
        return res.redirect("/?authError=token_exchange_failed");
      }

      const token = (await tokenResponse.json()) as { access_token?: string };
      if (!token.access_token)
        return res.redirect("/?authError=missing_access_token");

      const userResponse = await fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: { Authorization: `Bearer ${token.access_token}` },
        }
      );

      if (!userResponse.ok) {
        console.error(
          "Google userinfo failed",
          userResponse.status,
          await userResponse.text()
        );
        return res.redirect("/?authError=userinfo_failed");
      }

      const profile = (await userResponse.json()) as {
        sub?: string;
        email?: string;
        email_verified?: boolean;
        name?: string;
        given_name?: string;
      };

      const email = String(profile.email || "")
        .trim()
        .toLowerCase();
      if (!email || profile.email_verified !== true) {
        return res.redirect("/?authError=email_not_verified");
      }

      if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) {
        return res.redirect("/?authError=domain_not_allowed");
      }

      const name = String(
        profile.name || profile.given_name || email.split("@")[0] || "Usuário"
      );
      const authorized = await authorizeGoogleUser({ email, name });
      if (!authorized) return res.redirect("/?authError=access_not_allowed");

      const numericId =
        Number.parseInt(String(profile.sub || "1").slice(-9), 10) || 1;
      setSessionCookie(res, {
        id: numericId,
        name: authorized.name || name,
        email,
        role: authorized.role,
      });
      return res.redirect("/");
    } catch (error) {
      console.error("Google OAuth callback error", error);
      return res.redirect("/?authError=oauth_failed");
    }
  });
}
