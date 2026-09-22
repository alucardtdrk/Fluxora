export interface WorkspaceSyncSource { readonly name: string; run(): Promise<{ collected: number; persisted: number; received?: number }> }
export type WorkspaceSourceStatus = "ok" | "empty" | "failure";
export type WorkspaceSourceSafeError = "permission" | "configuration" | "invalid_request" | "rate_limited" | "upstream" | "unknown";
export interface WorkspaceSyncSummary { status: "success" | "partial" | "failure" | "skipped_locked"; startedAt: string; finishedAt: string; sources: Record<string, { status: WorkspaceSourceStatus; collected: number; persisted: number; received?: number; safeError?: WorkspaceSourceSafeError; httpStatus?: number }>; expiredEventsRemoved: number }

function safeFailure(error: unknown): { safeError: WorkspaceSourceSafeError; httpStatus?: number } {
  const message = error instanceof Error ? error.message : String(error || "");
  const statusValue = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) : undefined;
  const statusMatch = message.match(/(?:HTTP_|FIREBASE_AUTH_)(\d{3})/i);
  const httpStatus = Number.isFinite(statusValue) ? statusValue : statusMatch ? Number(statusMatch[1]) : undefined;
  if (httpStatus === 401 || httpStatus === 403 || /authorization/i.test(message)) return { safeError: "permission", httpStatus };
  if (/FIREBASE_NOT_CONFIGURED|Missing required Google Workspace configuration/i.test(message)) return { safeError: "configuration", httpStatus };
  if (httpStatus === 400) return { safeError: "invalid_request", httpStatus };
  if (httpStatus === 429) return { safeError: "rate_limited", httpStatus };
  if (httpStatus && httpStatus >= 500) return { safeError: "upstream", httpStatus };
  return { safeError: "unknown", httpStatus };
}

export function createWorkspaceSync(input: { readonly sources: readonly WorkspaceSyncSource[]; readonly now?: () => Date }) {
  let running = false;
  const now = input.now ?? (() => new Date());
  return { async run(): Promise<WorkspaceSyncSummary> {
    const startedAt = now().toISOString();
    if (running) return { status: "skipped_locked", startedAt, finishedAt: now().toISOString(), sources: {}, expiredEventsRemoved: 0 };
    running = true;
    try {
      const settled = await Promise.allSettled(input.sources.map((source) => source.run()));
      const sources: WorkspaceSyncSummary["sources"] = {};
      settled.forEach((result, index) => {
        const name = input.sources[index]!.name;
        sources[name] = result.status === "fulfilled"
          ? { status: result.value.collected === 0 ? "empty" : "ok", ...result.value }
          : { status: "failure", collected: 0, persisted: 0, ...safeFailure(result.reason) };
      });
      const successes = Object.values(sources).filter((item) => item.status !== "failure").length;
      return { status: successes === input.sources.length ? "success" : successes ? "partial" : "failure", startedAt, finishedAt: now().toISOString(), sources, expiredEventsRemoved: 0 };
    } finally { running = false; }
  } };
}
