import { describe, expect, it } from "vitest";
import { correlateWorkspaceSecurityEvents } from "./correlation.js";
import type { WorkspaceSecurityEvent } from "./types.js";

const observedAt = new Date("2026-09-17T12:00:00.000Z");

function event(overrides: Partial<WorkspaceSecurityEvent>): WorkspaceSecurityEvent {
  return {
    id: `event-${overrides.externalId ?? Math.random()}`,
    externalId: overrides.externalId ?? "event",
    source: "login",
    category: "identity",
    type: "login_failure",
    severity: "medium",
    title: "Login failure",
    description: "Login failure",
    occurredAt: new Date("2026-09-17T11:00:00.000Z"),
    observedAt,
    expiresAt: new Date("2027-03-19T11:00:00.000Z"),
    metadata: Object.freeze({}) as WorkspaceSecurityEvent["metadata"],
    ...overrides,
  };
}

describe("Workspace security correlation", () => {
  it("finds distributed login failures for the same user", () => {
    const findings = correlateWorkspaceSecurityEvents([
      event({ externalId: "a", actor: "ana@example.com", ipAddress: "198.51.100.1", occurredAt: new Date("2026-09-17T11:00:00.000Z") }),
      event({ externalId: "b", actor: "ana@example.com", ipAddress: "198.51.100.2", occurredAt: new Date("2026-09-17T11:10:00.000Z") }),
      event({ externalId: "c", actor: "ana@example.com", country: "BR", occurredAt: new Date("2026-09-17T11:20:00.000Z") }),
    ], observedAt);

    expect(findings).toEqual([expect.objectContaining({
      rule: "distributed_login_failures",
      severity: "high",
      subjects: ["ana@example.com"],
      evidenceCount: 3,
    })]);
  });

  it("does not flag a single login failure", () => {
    expect(correlateWorkspaceSecurityEvents([event({ actor: "ana@example.com" })], observedAt)).toEqual([]);
  });

  it("correlates suspicious login followed by OAuth authorization", () => {
    const findings = correlateWorkspaceSecurityEvents([
      event({ externalId: "login", actor: "ana@example.com", type: "login_success", severity: "high" }),
      event({ externalId: "oauth", actor: "ana@example.com", source: "oauth_token", category: "oauth", type: "authorize", severity: "high", occurredAt: new Date("2026-09-17T11:30:00.000Z") }),
    ], observedAt);

    expect(findings).toContainEqual(expect.objectContaining({ rule: "suspicious_login_then_oauth", subjects: ["ana@example.com"] }));
  });

  it("correlates repeated phishing evidence by target", () => {
    const findings = correlateWorkspaceSecurityEvents([0, 1, 2].map((index) => event({
      externalId: `phishing-${index}`,
      source: "alert_center",
      category: "email_security",
      type: "User reported phishing",
      target: "ana@example.com",
      occurredAt: new Date(`2026-09-17T11:${index}0:00.000Z`),
    })), observedAt);

    expect(findings).toContainEqual(expect.objectContaining({ rule: "repeated_phishing_or_malware", subjects: ["ana@example.com"], evidenceCount: 3 }));
  });

  it("correlates administration and Drive activity after an identity risk", () => {
    const findings = correlateWorkspaceSecurityEvents([
      event({ externalId: "risk", actor: "ana@example.com", source: "login", type: "login_success", severity: "high" }),
      event({ externalId: "admin", actor: "ana@example.com", source: "admin", category: "administration", type: "assign_role", severity: "high", occurredAt: new Date("2026-09-17T11:10:00.000Z") }),
      event({ externalId: "drive", actor: "ana@example.com", source: "drive", category: "data_protection", type: "change_user_access", severity: "high", occurredAt: new Date("2026-09-17T11:20:00.000Z") }),
    ], observedAt);

    expect(findings).toContainEqual(expect.objectContaining({ rule: "admin_change_then_identity_risk" }));
    expect(findings).toContainEqual(expect.objectContaining({ rule: "drive_activity_after_identity_risk" }));
  });

  it("turns high-confidence policy signals into actionable findings", () => {
    const findings = correlateWorkspaceSecurityEvents([
      event({ externalId: "2sv", actor: "ana@example.com", type: "2sv_disable", severity: "high" }),
      event({ externalId: "role", actor: "admin@example.com", source: "admin", type: "assign_role", severity: "high" }),
      event({ externalId: "share", actor: "ana@example.com", source: "drive", type: "external_share", severity: "high" }),
      event({ externalId: "dlp", actor: "ana@example.com", source: "rules", type: "rule_trigger", severity: "high" }),
    ], observedAt);

    expect(findings.map((finding) => finding.rule)).toEqual(expect.arrayContaining(["two_step_verification_disabled", "privilege_escalation", "external_drive_sharing", "high_severity_dlp"]));
  });
});
