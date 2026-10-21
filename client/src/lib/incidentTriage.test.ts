import { describe, expect, it } from "vitest";
import { triageIncidents, formatIncidentHistoryAction } from "./incidentTriage";

const now = new Date("2026-09-15T12:00:00.000Z");

function incident(overrides: Record<string, unknown>) {
  return {
    fingerprint: "incident",
    automation: "Workflow",
    count: 1,
    firstAt: "2026-09-15T11:50:00.000Z",
    lastAt: "2026-09-15T11:55:00.000Z",
    executionId: "100",
    lifecycle: { status: "new", severity: "low" },
    ...overrides,
  };
}

describe("triageIncidents", () => {
  it("prioriza incidente crítico vencido antes de incidentes menos graves", () => {
    const result = triageIncidents([
      incident({ fingerprint: "medium", lifecycle: { status: "new", severity: "medium" }, count: 10 }),
      incident({ fingerprint: "critical", firstAt: "2026-09-15T10:00:00.000Z", lifecycle: { status: "new", severity: "critical" } }),
    ], "attention", now);

    expect(result.items.map((item) => item.fingerprint)).toEqual(["critical", "medium"]);
    expect(result.items[0].overdue).toBe(true);
  });

  it("mantém pendentes separados de resolvidos, inclusive quando silenciados", () => {
    const result = triageIncidents([
      incident({ fingerprint: "active" }),
      incident({ fingerprint: "resolved", lifecycle: { status: "resolved", severity: "critical" } }),
      incident({ fingerprint: "silenced", lifecycle: { status: "new", severity: "high", silencedUntil: "2026-09-16T12:00:00.000Z" } }),
    ], "attention", now);

    expect(result.items.map((item) => item.fingerprint)).toEqual(["silenced", "active"]);
    expect(result.counts).toEqual({ attention: 2, investigating: 0, resolved: 1 });
  });

  it("marca incidente crítico novo sem responsável como exigindo ação imediata", () => {
    const result = triageIncidents([
      incident({ fingerprint: "critical", lifecycle: { status: "new", severity: "critical", owner: null } }),
    ], "attention", now);

    expect(result.items[0]).toMatchObject({ requiresOwner: true, nextAction: "Atribuir responsável e iniciar investigação" });
  });
});

it("separa as etapas e preserva incidentes reconhecidos antigos", () => {
  const incidents = [
    incident({ fingerprint: "new" }),
    incident({ fingerprint: "legacy", lifecycle: { status: "acknowledged", severity: "low" } }),
    incident({ fingerprint: "investigation", lifecycle: { status: "investigating", severity: "low" } }),
    incident({ fingerprint: "done", lifecycle: { status: "resolved", severity: "low" } }),
  ];
  expect(triageIncidents(incidents, "attention", now).items.map((item) => item.fingerprint)).toEqual(["new"]);
  expect(triageIncidents(incidents, "investigating", now).items).toHaveLength(2);
  expect(triageIncidents(incidents, "resolved", now).items).toHaveLength(1);
  expect(triageIncidents(incidents, "attention", now).counts).toEqual({ attention: 1, investigating: 2, resolved: 1 });
});

it("traduz ações antigas do histórico sem expor códigos de status", () => {
  expect(formatIncidentHistoryAction("new → investigating")).toBe("Pendente → Em investigação");
  expect(formatIncidentHistoryAction("acknowledged → investigating")).toBe("Investigação atualizada");
  expect(formatIncidentHistoryAction("Incidente definido como acknowledged")).toBe("Status definido: Em investigação");
});
it("ordena resolvidos pela resolução mais recente, sem priorizar gravidade antiga", () => {
  const result = triageIncidents([
    incident({ fingerprint: "old-critical", lifecycle: { status: "resolved", severity: "critical", resolvedAt: "2026-09-15T10:00:00Z" } }),
    incident({ fingerprint: "recent-low", lifecycle: { status: "resolved", severity: "low", resolvedAt: "2026-09-15T11:00:00Z" } }),
  ], "resolved", now);
  expect(result.items.map((item) => item.fingerprint)).toEqual(["recent-low", "old-critical"]);
});