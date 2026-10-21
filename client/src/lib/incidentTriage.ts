export type IncidentFilter = "attention" | "investigating" | "resolved";

export type IncidentLifecycle = {
  status: "new" | "acknowledged" | "investigating" | "resolved";
  severity: "critical" | "high" | "medium" | "low";
  owner?: string | null;
  resolvedAt?: string | null;
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
      ? requiresOwner ? "Atribuir responsável e iniciar investigação" : "Iniciar investigação"
      : incident.lifecycle.status !== "resolved"
        ? requiresOwner ? "Definir responsável pela investigação" : "Registrar diagnóstico, ação tomada e resultado"
        : "Consultar a solução registrada";
    return { ...incident, ageMinutes, overdue, silenced, requiresOwner, nextAction };
  });

  const counts = {
    attention: enriched.filter((item) => item.lifecycle.status === "new").length,
    investigating: enriched.filter((item) => item.lifecycle.status === "acknowledged" || item.lifecycle.status === "investigating").length,
    resolved: enriched.filter((item) => item.lifecycle.status === "resolved").length,
  };
  const items = enriched.filter((item) => filter === "attention"
    ? item.lifecycle.status === "new"
    : filter === "investigating"
      ? item.lifecycle.status === "acknowledged" || item.lifecycle.status === "investigating"
      : item.lifecycle.status === "resolved");
  items.sort((a, b) => {
    if (filter === "resolved") return (timestamp(b.lifecycle.resolvedAt) ?? timestamp(b.lastAt) ?? 0) - (timestamp(a.lifecycle.resolvedAt) ?? timestamp(a.lastAt) ?? 0);
    const severity = severityWeight[b.lifecycle.severity] - severityWeight[a.lifecycle.severity];
    if (severity) return severity;
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.requiresOwner !== b.requiresOwner) return a.requiresOwner ? -1 : 1;
    if (b.count !== a.count) return b.count - a.count;
    return (timestamp(b.lastAt) || 0) - (timestamp(a.lastAt) || 0);
  });

  return { items, counts };
}

export const incidentStatusLabels = { new: "Pendente", acknowledged: "Em investigação", investigating: "Em investigação", resolved: "Resolvido" } as const;

export function formatIncidentHistoryAction(action: string) {
  const transition = action.match(/^(new|acknowledged|investigating|resolved) → (new|acknowledged|investigating|resolved)$/);
  if (transition) {
    const from = incidentStatusLabels[transition[1] as keyof typeof incidentStatusLabels];
    const to = incidentStatusLabels[transition[2] as keyof typeof incidentStatusLabels];
    return from === to ? "Investigação atualizada" : `${from} → ${to}`;
  }
  const initial = action.match(/^Incidente definido como (new|acknowledged|investigating|resolved)$/);
  return initial ? `Status definido: ${incidentStatusLabels[initial[1] as keyof typeof incidentStatusLabels]}` : action;
}