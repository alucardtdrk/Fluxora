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
  it("flags persistence and weakened security without a suspicious login", () => {
    const findings = correlateWorkspaceSecurityEvents([
      event({ externalId: "oauth", source: "oauth_token", type: "authorize", metadata: { scope: ["https://www.googleapis.com/auth/gmail.readonly"] } }),
      event({ externalId: "routing", source: "admin", type: "CREATE_GMAIL_SETTING", metadata: { SETTING_NAME: "EMAIL_ROUTING" } }),
      event({ externalId: "auth", source: "admin", type: "ENFORCE_STRONG_AUTHENTICATION", metadata: { NEW_VALUE: "false" } }),
      event({ externalId: "trust", source: "admin", type: "TRUST_DOMAIN_OWNED_OAUTH2_APPS" }),
    ], observedAt);
    expect(findings.map((finding) => finding.rule)).toEqual(expect.arrayContaining(["sensitive_oauth_grant", "email_routing_change", "authentication_policy_weakened", "oauth_trust_expanded"]));
    expect(findings.every((finding) => finding.eventIds.length && finding.description.includes("Revise"))).toBe(true);
  });

  it("does not flag harmless scopes, revoked access, stronger policies or generic settings", () => {
    expect(correlateWorkspaceSecurityEvents([
      event({ source: "oauth_token", type: "authorize", metadata: { scope: "openid email profile" } }),
      event({ source: "oauth_token", type: "revoke", metadata: { scope: "https://www.googleapis.com/auth/drive" } }),
      event({ source: "admin", type: "ENFORCE_STRONG_AUTHENTICATION", metadata: { NEW_VALUE: "true" } }),
      event({ source: "admin", type: "CREATE_GMAIL_SETTING", metadata: { SETTING_NAME: "SIGNATURE" } }),
      event({ source: "admin", type: "unassign_role" }),
    ], observedAt)).toEqual([]);
  });

  it("detects a download burst, but not isolated downloads or downloads across users", () => {
    const downloads = Array.from({ length: 20 }, (_, index) => event({ externalId: `download-${index}`, source: "drive", type: "download", actor: "ana@example.com", occurredAt: new Date(observedAt.getTime() - index * 60_000) }));
    expect(correlateWorkspaceSecurityEvents(downloads, observedAt)).toContainEqual(expect.objectContaining({ rule: "bulk_drive_download", evidenceCount: 20 }));
    expect(correlateWorkspaceSecurityEvents(downloads.slice(0, 19), observedAt)).toEqual([]);
    expect(correlateWorkspaceSecurityEvents(downloads.map((item) => ({ ...item, id: "duplicate" })), observedAt)).toEqual([]);
    expect(correlateWorkspaceSecurityEvents(downloads.map((item, index) => ({ ...item, actor: `user-${index}@example.com` })), observedAt)).toEqual([]);
    expect(correlateWorkspaceSecurityEvents(downloads.map((item, index) => ({ ...item, occurredAt: new Date(observedAt.getTime() - index * 120_000) })), observedAt)).toEqual([]);
  });

  it("correlates a risky Alert Center identity with subsequent Drive downloads", () => {
    expect(correlateWorkspaceSecurityEvents([
      event({ externalId: "identity", source: "alert_center", type: "Suspicious login", severity: "high", target: "ana@example.com" }),
      event({ externalId: "download", source: "drive", type: "download", severity: "informational", actor: "ana@example.com", occurredAt: new Date("2026-09-17T11:10:00Z") }),
    ], observedAt)).toContainEqual(expect.objectContaining({ rule: "drive_activity_after_identity_risk", evidenceCount: 2 }));
  });

  it("flags successful logins from different countries within 30 minutes", () => {
    const logins = [
      event({ externalId: "br", type: "login_success", actor: "ana@example.com", country: "BR", ipAddress: "198.51.100.1" }),
      event({ externalId: "us", type: "login_success", actor: "ana@example.com", country: "US", ipAddress: "203.0.113.2", occurredAt: new Date("2026-09-17T11:10:00Z") }),
    ];
    expect(correlateWorkspaceSecurityEvents(logins, observedAt)).toContainEqual(expect.objectContaining({ rule: "rapid_login_country_change", evidenceCount: 2, ipAddresses: ["198.51.100.1", "203.0.113.2"] }));
    expect(correlateWorkspaceSecurityEvents(logins.map((login) => ({ ...login, country: "BR" })), observedAt)).toEqual([]);
    expect(correlateWorkspaceSecurityEvents(logins.map((login) => ({ ...login, country: undefined })), observedAt)).toEqual([]);
    expect(correlateWorkspaceSecurityEvents([logins[0]!, { ...logins[1]!, occurredAt: new Date("2026-09-17T11:40:00Z") }], observedAt)).toEqual([]);
  });

  it("flags standalone suspicious logins and data exfiltration", () => {
    const findings = correlateWorkspaceSecurityEvents([
      event({ externalId: "alert", source: "alert_center", type: "Suspicious login", severity: "high", target: "ana@example.com", ipAddress: "2001:db8::1" }),
      event({ externalId: "login", type: "login_success", severity: "high", actor: "ana@example.com" }),
      event({ externalId: "data", source: "alert_center", type: "Data exfiltration", severity: "critical", target: "ana@example.com" }),
    ], observedAt);
    expect(findings).toContainEqual(expect.objectContaining({ rule: "suspicious_login", subjects: ["ana@example.com"], ipAddresses: ["2001:db8::1"], eventIds: ["event-alert"] }));
    expect(findings).toContainEqual(expect.objectContaining({ rule: "suspicious_login", eventIds: ["event-login"] }));
    expect(findings).toContainEqual(expect.objectContaining({ rule: "data_exfiltration", severity: "critical" }));
  });

  it("does not count one IP and its country as different login origins", () => {
    expect(correlateWorkspaceSecurityEvents([0, 1, 2].map(() => event({ actor: "ana@example.com", ipAddress: "198.51.100.1", country: "BR" })), observedAt)).toEqual([]);
  });

  it("does not flag routine logins, downloads, investigations or stale signals", () => {
    expect(correlateWorkspaceSecurityEvents([
      event({ type: "login_success", severity: "informational" }),
      event({ source: "drive", type: "download", severity: "informational" }),
      event({ source: "admin", type: "SECURITY_INVESTIGATION_QUERY", severity: "high" }),
      event({ source: "alert_center", type: "Suspicious login", severity: "high", occurredAt: new Date("2026-09-15T11:00:00Z") }),
    ], observedAt)).toEqual([]);
  });

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

  it("does not treat reading an externally shared Drive item as a new exposure", () => {
    const findings = correlateWorkspaceSecurityEvents([
      event({ externalId: "risk", actor: "ana@example.com", source: "login", type: "suspicious_login", severity: "high" }),
      event({ externalId: "read", actor: "ana@example.com", source: "drive", type: "access_item_content", severity: "high", metadata: { visibility: "shared_externally" }, occurredAt: new Date("2026-09-17T11:20:00.000Z") }),
    ], observedAt);
    expect(findings.some((finding) => finding.rule === "external_drive_sharing" || finding.rule === "drive_activity_after_identity_risk")).toBe(false);
  });
});
