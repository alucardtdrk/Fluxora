export type DashboardPeriod = "today" | "7d" | "30d" | "90d" | "all";
export const PREFERENCE_SCOPES = ["home", "analytics", "errors", "executions"] as const;
export const PREFERENCES_UPDATED_EVENT = "fluxora:preferences-updated";

const VALID_PERIODS = new Set<DashboardPeriod>(["today", "7d", "30d", "90d", "all"]);
const VALID_PAGE_SIZES = new Set(["25", "50", "100"]);

function readStorage(key: string) {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
}

export function rememberFiltersEnabled() {
  return readStorage("fluxoraRememberFilters") !== "false";
}

export function readDefaultPeriod(fallback: DashboardPeriod = "7d") {
  const value = readStorage("fluxoraDefaultPeriod");
  return value && VALID_PERIODS.has(value as DashboardPeriod) ? (value as DashboardPeriod) : fallback;
}

export function readScopedPeriod(scope: string, fallback?: DashboardPeriod) {
  const base = fallback ?? readDefaultPeriod();
  if (!rememberFiltersEnabled()) return base;
  const value = readStorage(`fluxoraPeriod:${scope}`);
  return value && VALID_PERIODS.has(value as DashboardPeriod) ? (value as DashboardPeriod) : base;
}

export function saveScopedPeriod(scope: string, period: DashboardPeriod) {
  if (typeof window === "undefined") return;
  if (!rememberFiltersEnabled()) {
    window.localStorage.removeItem(`fluxoraPeriod:${scope}`);
    return;
  }
  window.localStorage.setItem(`fluxoraPeriod:${scope}`, period);
}

export function readPreferredRefreshSeconds(fallback = 30) {
  const raw = Number(readStorage("preferredRefreshInterval") || String(fallback));
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(15, Math.min(300, Math.floor(raw)));
}

export function readOperationalAlertPreferences() {
  const errorThreshold = Number(readStorage("fluxoraErrorThreshold") || "5");
  const inactiveHours = Number(readStorage("fluxoraInactiveHours") || "24");
  return {
    errorThreshold: Number.isFinite(errorThreshold) ? Math.max(1, Math.min(100, Math.floor(errorThreshold))) : 5,
    inactiveHours: Number.isFinite(inactiveHours) ? Math.max(1, Math.min(168, Math.floor(inactiveHours))) : 24,
  };
}

export function readPreferredPageSize(fallback = 25) {
  const value = readStorage("fluxoraPageSize");
  if (!value || !VALID_PAGE_SIZES.has(value)) return fallback;
  return Number(value);
}

export function readFocusWorkflows() {
  if (!rememberFiltersEnabled()) return [] as string[];
  try {
    const parsed = JSON.parse(readStorage("focusWorkflows") || "[]");
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

export function saveFocusWorkflows(ids: string[]) {
  if (typeof window === "undefined") return;
  if (!rememberFiltersEnabled()) {
    window.localStorage.removeItem("focusWorkflows");
    return;
  }
  window.localStorage.setItem("focusWorkflows", JSON.stringify(ids));
}

export function broadcastPreferencesUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PREFERENCES_UPDATED_EVENT));
}
