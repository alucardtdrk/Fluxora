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
