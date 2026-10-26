import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../server/routers.js";
import { createContext } from "../server/_core/context.js";
import { registerGoogleOAuthRoutes } from "../server/googleOAuth.js";
import { syncN8nArchive } from "../server/n8n.js";
import { archiveConfigured, getArchiveSyncState } from "../server/firestoreLogs.js";
import { isInternalRequestAuthorized } from "../server/internalAuth.js";
import { sendDailyChatSummary } from "../server/googleChatDailySummary.js";
import { syncDailyGoogleWorkspaceSecurity } from "../server/googleWorkspace/runtime.js";

const app = express();
app.set("trust proxy", 1);

app.use((req: any, _res: any, next: any) => {
  const current = new URL(req.url || "/", "http://localhost");
  const trpcPath = current.searchParams.get("trpcPath");
  const health = current.searchParams.get("health");
  const authPath = current.searchParams.get("authPath");
  const syncN8n = current.searchParams.get("syncN8n");
  const syncWorkspace = current.searchParams.get("syncWorkspace");

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
  } else if (syncWorkspace === "1") {
    req.url = "/api/internal/sync-google-workspace";
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

app.get("/api/internal/sync-google-workspace", async (req: any, res: any) => {
  if (!isInternalRequestAuthorized(req.headers)) return res.status(401).json({ ok: false, error: "unauthorized" });
  try {
    const summary = await syncDailyGoogleWorkspaceSecurity();
    const dailySummary = await sendDailyChatSummary(summary);
    console.info(JSON.stringify({ message: "google_chat_daily_summary", status: dailySummary.status }));
    const ok = summary.status === "success" || summary.status === "partial" || summary.status === "skipped_locked";
    return res.status(ok ? 200 : 500).json({ ok, summary, dailySummary });
  } catch (error) {
    const dailySummary = await sendDailyChatSummary({ status: "failure", sources: {} });
    console.info(JSON.stringify({ message: "google_chat_daily_summary", status: dailySummary.status }));
    const configurationError = error instanceof Error && error.message.startsWith("Missing required Google Workspace configuration:");
    console.error(JSON.stringify({ level: "error", message: "google_workspace_sync_failed", configurationError }));
    return res.status(configurationError ? 503 : 500).json({ ok: false, error: configurationError ? "configuration_missing" : "sync_failed" });
  }
});

registerGoogleOAuthRoutes(app);

app.use(
  "/api/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  }),
);

export const config = { maxDuration: 300 };
export default app;
