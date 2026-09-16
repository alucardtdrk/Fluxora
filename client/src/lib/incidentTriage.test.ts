import { describe, expect, it } from "vitest";
import { triageIncidents } from "./incidentTriage";

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

  it("remove resolvidos e silenciados do filtro que requer atuação", () => {
    const result = triageIncidents([
      incident({ fingerprint: "active" }),
      incident({ fingerprint: "resolved", lifecycle: { status: "resolved", severity: "critical" } }),
      incident({ fingerprint: "silenced", lifecycle: { status: "new", severity: "high", silencedUntil: "2026-09-16T12:00:00.000Z" } }),
    ], "attention", now);

    expect(result.items.map((item) => item.fingerprint)).toEqual(["active"]);
    expect(result.counts).toEqual({ attention: 1, open: 2, resolved: 1 });
  });

  it("marca incidente crítico novo sem responsável como exigindo ação imediata", () => {
    const result = triageIncidents([
      incident({ fingerprint: "critical", lifecycle: { status: "new", severity: "critical", owner: null } }),
    ], "attention", now);

    expect(result.items[0]).toMatchObject({ requiresOwner: true, nextAction: "Reconhecer e atribuir responsável" });
  });
});
