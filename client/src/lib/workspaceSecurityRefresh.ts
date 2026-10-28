import { WORKSPACE_SECURITY_SOURCES, type WorkspaceSecuritySource } from "@shared/workspaceSecurity";

const CURRENT_SECURITY_STALE_MS = 5 * 60 * 1_000;

type SourceState = { readonly source: string; readonly status?: string; readonly completedAt?: string };
export type RefreshSourceResult = { readonly status: string; readonly completedAt?: string; readonly safeError?: string };

export function shouldRefreshCurrentSecurity(sources: readonly SourceState[], now = new Date()): boolean {
  return WORKSPACE_SECURITY_SOURCES.some(name => {
    const source = sources.find(item => item.source === name);
    const timestamp = Date.parse(source?.completedAt ?? "");
    return !source || !["ok", "empty"].includes(source.status ?? "") || !Number.isFinite(timestamp) || now.getTime() - timestamp >= CURRENT_SECURITY_STALE_MS;
  });
}

export async function runSecurityRefresh(
  refresh: (sources: WorkspaceSecuritySource[]) => Promise<{ sources: Record<string, RefreshSourceResult>; finishedAt?: string }>,
  options: {
    sources?: readonly WorkspaceSecuritySource[];
    isActive?: () => boolean;
    onBatch?: (results: Record<string, RefreshSourceResult>) => void;
    now?: () => number;
  } = {},
): Promise<Record<string, RefreshSourceResult>> {
  const queue = [...new Set(options.sources ?? WORKSPACE_SECURITY_SOURCES)];
  const results: Record<string, RefreshSourceResult> = {};
  const now = options.now ?? Date.now;
  const deadline = now() + 5 * 60 * 1_000;
  while (queue.length && (options.isActive?.() ?? true) && now() < deadline) {
    const batch = queue.splice(0, 3);
    const result = await refresh(batch);
    for (const source of batch) {
      const status = result.sources[source];
      if (!status) throw new Error("A coleta não retornou o resultado de todas as fontes. Tente novamente.");
      results[source] = { ...status, completedAt: result.finishedAt };
      if (status.status === "incomplete") queue.push(source);
    }
    options.onBatch?.({ ...results });
  }
  return results;
}
export const sourceLabels: Record<string, string> = {
  alert_center: "Alert Center",
  login: "Login",
  admin: "Administração",
  oauth_token: "OAuth",
  drive: "Drive",
  groups: "Grupos",
  mobile: "Dispositivos",
  rules: "Regras",
  gmail: "Gmail",
  user_accounts: "Contas de usuário",
  saml: "SAML",
  calendar: "Agenda",
  chat: "Chat",
  meet: "Meet",
};

export function summarizeSecurityCollection(sources: readonly SourceState[]) {
  const expected = WORKSPACE_SECURITY_SOURCES.map(name => sources.find(source => source.source === name));
  const complete = expected.filter(source => source && ["ok", "empty"].includes(source.status ?? "") && Number.isFinite(Date.parse(source.completedAt ?? "")));
  return {
    completedAt: complete.length === expected.length ? new Date(Math.min(...complete.map(source => Date.parse(source!.completedAt!)))).toISOString() : null,
    completed: complete.length,
    total: expected.length,
    failed: expected.filter(source => source?.status === "failure").length,
    incomplete: expected.filter(source => source?.status === "incomplete").length,
    awaiting: expected.filter(source => !source || !["ok", "empty", "failure", "incomplete"].includes(source.status ?? "")).length,
  };
}
