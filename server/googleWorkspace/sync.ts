export interface WorkspaceSyncSource { readonly name: string; run(): Promise<{ collected: number; persisted: number }> }
export type WorkspaceSourceStatus = "ok" | "empty" | "failure";
export type WorkspaceSourceSafeError = "permission" | "configuration" | "unknown";
export interface WorkspaceSyncSummary { status: "success" | "partial" | "failure" | "skipped_locked"; startedAt: string; finishedAt: string; sources: Record<string, { status: WorkspaceSourceStatus; collected: number; persisted: number; safeError?: WorkspaceSourceSafeError }>; expiredEventsRemoved: number }

function safeError(error: unknown): WorkspaceSourceSafeError {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/HTTP_(401|403)|FIREBASE_AUTH_(401|403)|authorization/i.test(message)) return "permission";
  if (/FIREBASE_NOT_CONFIGURED|Missing required Google Workspace configuration/i.test(message)) return "configuration";
  return "unknown";
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
          : { status: "failure", collected: 0, persisted: 0, safeError: safeError(result.reason) };
      });
      const successes = Object.values(sources).filter((item) => item.status !== "failure").length;
      return { status: successes === input.sources.length ? "success" : successes ? "partial" : "failure", startedAt, finishedAt: now().toISOString(), sources, expiredEventsRemoved: 0 };
    } finally { running = false; }
  } };
}
