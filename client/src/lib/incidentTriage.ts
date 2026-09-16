export type IncidentFilter = "attention" | "open" | "resolved";

export type IncidentLifecycle = {
  status: "new" | "acknowledged" | "investigating" | "resolved";
  severity: "critical" | "high" | "medium" | "low";
  owner?: string | null;
  silencedUntil?: string | null;
};

export type TriageIncident = {
  fingerprint: string;
  count: number;
  firstAt?: string | null;
  lastAt?: string | null;
  lifecycle: IncidentLifecycle;
  [key: string]: unknown;
};

export type TriagedIncident<T extends TriageIncident> = T & {
  ageMinutes: number | null;
  overdue: boolean;
  silenced: boolean;
  requiresOwner: boolean;
  nextAction: string;
};

const severityWeight: Record<IncidentLifecycle["severity"], number> = { critical: 4, high: 3, medium: 2, low: 1 };
const responseMinutes: Record<IncidentLifecycle["severity"], number> = { critical: 15, high: 60, medium: 240, low: 1440 };

function timestamp(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function triageIncidents<T extends TriageIncident>(incidents: T[], filter: IncidentFilter, now = new Date()) {
  const nowMs = now.getTime();
  const enriched: Array<TriagedIncident<T>> = incidents.map((incident) => {
    const firstAt = timestamp(incident.firstAt);
    const ageMinutes = firstAt == null ? null : Math.max(0, Math.floor((nowMs - firstAt) / 60000));
    const silencedUntil = timestamp(incident.lifecycle.silencedUntil);
    const silenced = silencedUntil != null && silencedUntil > nowMs;
    const requiresOwner = incident.lifecycle.status !== "resolved" && !incident.lifecycle.owner;
    const overdue = incident.lifecycle.status !== "resolved" && ageMinutes != null && ageMinutes >= responseMinutes[incident.lifecycle.severity];
    const nextAction = incident.lifecycle.status === "new"
      ? requiresOwner ? "Reconhecer e atribuir responsável" : "Reconhecer incidente"
      : incident.lifecycle.status === "acknowledged"
        ? "Iniciar investigação"
        : incident.lifecycle.status === "investigating"
          ? "Registrar diagnóstico ou resolver"
          : "Nenhuma ação pendente";
    return { ...incident, ageMinutes, overdue, silenced, requiresOwner, nextAction };
  });

  const counts = {
    attention: enriched.filter((item) => item.lifecycle.status !== "resolved" && !item.silenced).length,
    open: enriched.filter((item) => item.lifecycle.status !== "resolved").length,
    resolved: enriched.filter((item) => item.lifecycle.status === "resolved").length,
  };
  const items = enriched.filter((item) => filter === "attention"
    ? item.lifecycle.status !== "resolved" && !item.silenced
    : filter === "open"
      ? item.lifecycle.status !== "resolved"
      : item.lifecycle.status === "resolved");

  items.sort((a, b) => {
    const severity = severityWeight[b.lifecycle.severity] - severityWeight[a.lifecycle.severity];
    if (severity) return severity;
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.requiresOwner !== b.requiresOwner) return a.requiresOwner ? -1 : 1;
    if (b.count !== a.count) return b.count - a.count;
    return (timestamp(b.lastAt) || 0) - (timestamp(a.lastAt) || 0);
  });

  return { items, counts };
}
