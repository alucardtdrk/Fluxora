const CURRENT_SECURITY_STALE_MS = 5 * 60 * 1_000;

export function shouldRefreshCurrentSecurity(
  sources: readonly { readonly source: string; readonly status?: string; readonly completedAt?: string }[],
  now: Date = new Date(),
): boolean {
  const alertCenter = sources.find((source) => source.source === "alert_center");
  if (alertCenter?.status === "incomplete") return true;
  if (!alertCenter?.completedAt) return true;
  const completedAt = new Date(alertCenter.completedAt).getTime();
  return !Number.isFinite(completedAt) || now.getTime() - completedAt >= CURRENT_SECURITY_STALE_MS;
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

export function summarizeSecurityCollection(sources: readonly { readonly status: string; readonly completedAt?: string }[]) {
  const timestamps = sources.map((source) => Date.parse(source.completedAt ?? "")).filter(Number.isFinite);
  return {
    latestCompletedAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
    failed: sources.filter((source) => source.status === "failure").length,
    incomplete: sources.filter((source) => source.status === "incomplete").length,
    awaiting: sources.filter((source) => !["ok", "empty", "failure", "incomplete"].includes(source.status)).length,
  };
}