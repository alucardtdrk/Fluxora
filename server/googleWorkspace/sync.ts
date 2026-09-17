export interface WorkspaceSyncSource { readonly name: string; run(): Promise<{ collected: number; persisted: number }> }
export interface WorkspaceSyncSummary { status: "success" | "partial" | "failure" | "skipped_locked"; startedAt: string; finishedAt: string; sources: Record<string, { status: "success" | "failure"; collected: number; persisted: number; safeError?: string }>; expiredEventsRemoved: number }

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
        sources[name] = result.status === "fulfilled" ? { status: "success", ...result.value } : { status: "failure", collected: 0, persisted: 0, safeError: "unknown" };
      });
      const successes = Object.values(sources).filter((item) => item.status === "success").length;
      return { status: successes === input.sources.length ? "success" : successes ? "partial" : "failure", startedAt, finishedAt: now().toISOString(), sources, expiredEventsRemoved: 0 };
    } finally { running = false; }
  } };
}
