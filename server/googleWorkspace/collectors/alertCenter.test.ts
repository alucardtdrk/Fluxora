import { describe, expect, it } from "vitest";
import type { GoogleWorkspaceClient } from "../client.js";
import { collectAlertCenterEvidence, collectAlertCenterEvidenceBatch } from "./alertCenter.js";
import {
  isExcludedSuperadminPasswordReset,
  normalizeAlertCenterAlert,
  type GoogleAlertCenterAlert,
} from "../normalizers/alertCenter.js";

const accountTakeoverAlert: GoogleAlertCenterAlert = {
  customerId: "C01234567",
  alertId: "account-takeover-1",
  createTime: "2026-09-16T10:00:00.000Z",
  startTime: "2026-09-16T09:58:00.000Z",
  endTime: "2026-09-16T10:01:00.000Z",
  type: "Account takeover",
  source: "Google identity",
  data: {
    "@type": "type.googleapis.com/google.apps.alertcenter.type.AccountWarning",
    actorEmail: "attacker@example.net",
    affectedUserEmails: ["victim@example.com"],
    ipAddress: "203.0.113.10",
  },
};

const phishingAlert: GoogleAlertCenterAlert = {
  customerId: "C01234567",
  alertId: "phishing-1",
  createTime: "2026-09-16T10:03:00.000Z",
  type: "User reported phishing",
  source: "Gmail phishing",
  data: {
    "@type": "type.googleapis.com/google.apps.alertcenter.type.MailPhishing",
    affectedUserEmails: ["employee@example.com"],
    domainId: "example.com",
  },
};

const dataLossAlert: GoogleAlertCenterAlert = {
  customerId: "C01234567",
  alertId: "data-loss-1",
  createTime: "2026-09-16T10:05:00.000Z",
  type: "Sensitive data leak",
  source: "Data Loss Prevention",
  data: {
    "@type": "type.googleapis.com/google.apps.alertcenter.type.DlpRuleViolation",
    actorEmail: "employee@example.com",
    resourceName: "drive-file-123",
  },
};

const superadminPasswordResetAlert: GoogleAlertCenterAlert = {
  customerId: "C01234567",
  alertId: "superadmin-password-reset-1",
  createTime: "2026-09-16T10:07:00.000Z",
  type: "Super admin password reset",
  source: "Google identity",
  data: {
    "@type": "type.googleapis.com/google.apps.alertcenter.type.SuperadminPasswordReset",
    affectedUserEmails: ["superadmin@example.com"],
  },
};

class PageClient implements GoogleWorkspaceClient {
  readonly requestedUrls: string[] = [];
  constructor(private readonly pages: readonly unknown[]) {}

  async getJson<T>(_url: URL): Promise<T> {
    throw new Error("Alert Center collection must use pagination");
  }

  async *paginate<T>(url: URL): AsyncIterable<T> {
    this.requestedUrls.push(url.toString());
    for (const page of this.pages) yield page as T;
  }
}

describe("Alert Center collector", () => {
  it("reports how many raw alerts Google returned before normalization", async () => {
    const client = new PageClient([{ alerts: [accountTakeoverAlert, superadminPasswordResetAlert] }]);

    const result = await collectAlertCenterEvidenceBatch({ client, customerId: "C01234567" });

    expect(result.alertsRead).toBe(2);
    expect(result.events).toHaveLength(1);
  });

  it("paginates alerts from the overlap start time", async () => {
    const client = new PageClient([
      { alerts: [accountTakeoverAlert], nextPageToken: "second-page" },
      { alerts: [phishingAlert, dataLossAlert] },
    ]);

    const result = await collectAlertCenterEvidence({
      client,
      customerId: "C01234567",
      lastSuccessfulEventAt: new Date("2026-09-16T10:00:00.000Z"),
      now: () => new Date("2026-09-16T12:00:00.000Z"),
    });

    expect(result.map((event) => event.externalId)).toEqual([
      "account-takeover-1",
      "phishing-1",
      "data-loss-1",
    ]);
    expect(client.requestedUrls).toEqual([
      "https://alertcenter.googleapis.com/v1beta1/alerts?customerId=01234567&pageSize=1000&orderBy=createTime+asc&filter=createTime+%3E%3D+%222026-09-16T09%3A55%3A00.000Z%22",
    ]);
  });

  it("uses the configured bootstrap lookback on the first run", async () => {
    const client = new PageClient([{ alerts: [] }]);

    await collectAlertCenterEvidence({
      client,
      customerId: "01234567",
      bootstrapLookbackHours: 12,
      now: () => new Date("2026-09-16T12:00:00.000Z"),
    });

    expect(client.requestedUrls[0]).toContain(
      "filter=createTime+%3E%3D+%222026-09-16T00%3A00%3A00.000Z%22",
    );
  });
});

describe("Alert Center normalizer", () => {
  it("maps an account takeover alert to high or critical severity", () => {
    const normalized = normalizeAlertCenterAlert(accountTakeoverAlert, new Date("2026-09-16T10:10:00.000Z"));

    expect(normalized?.severity).toBe("critical");
    expect(normalized?.source).toBe("alert_center");
    expect(normalized?.externalId).toBe("account-takeover-1");
  });

  it("preserves useful actor, target and alert metadata", () => {
    const normalized = normalizeAlertCenterAlert(accountTakeoverAlert, new Date("2026-09-16T10:10:00.000Z"));

    expect(normalized).toMatchObject({
      actor: "attacker@example.net",
      target: "victim@example.com",
      ipAddress: "203.0.113.10",
      metadata: {
        originalType: "Account takeover",
        originalSource: "Google identity",
        createTime: "2026-09-16T10:00:00.000Z",
        dataType: "type.googleapis.com/google.apps.alertcenter.type.AccountWarning",
      },
    });
  });

  it("keeps only safe phishing details", () => {
    const normalized = normalizeAlertCenterAlert({
      ...phishingAlert,
      data: {
        "@type": "type.googleapis.com/google.apps.alertcenter.type.MailPhishing",
        reporterEmail: "reporter@example.com",
        maliciousEntity: { fromHeader: "attacker@example.net", subject: "Urgente" },
        affectedUserEmails: ["employee@example.com"],
        urls: ["https://phishing.example"],
        attachments: ["invoice.zip"],
        messageBody: "never persist this",
      },
    }, new Date("2026-09-16T10:10:00.000Z"));

    expect(normalized?.safeDetails).toEqual({
      reporterEmail: "reporter@example.com",
      suspectedSender: "attacker@example.net",
      subject: "Urgente",
      affectedUsers: ["employee@example.com"],
      indicatorUrls: ["https://phishing.example"],
      attachmentNames: ["invoice.zip"],
    });
    expect(JSON.stringify(normalized)).not.toContain("never persist this");
  });

  it("drops a superadministrator password reset event", () => {
    expect(isExcludedSuperadminPasswordReset(superadminPasswordResetAlert)).toBe(true);
    expect(normalizeAlertCenterAlert(superadminPasswordResetAlert, new Date("2026-09-16T10:10:00.000Z"))).toBeNull();
  });

  it("does not drop unrelated administrator events", () => {
    const ordinaryAdminAlert: GoogleAlertCenterAlert = {
      ...superadminPasswordResetAlert,
      alertId: "admin-role-change-1",
      type: "Super admin role assignment",
      data: {
        "@type": "type.googleapis.com/google.apps.alertcenter.type.AdminRoleAssignment",
        affectedUserEmails: ["admin@example.com"],
      },
    };

    expect(isExcludedSuperadminPasswordReset(ordinaryAdminAlert)).toBe(false);
    expect(normalizeAlertCenterAlert(ordinaryAdminAlert, new Date("2026-09-16T10:10:00.000Z"))).not.toBeNull();
  });

  it("classifies suspicious login alerts as high priority and exposes safe login details", () => {
    const normalized = normalizeAlertCenterAlert({
      alertId: "suspicious-login-1",
      createTime: "2026-09-21T14:17:23.000Z",
      type: "Suspicious login",
      source: "Google identity",
      data: {
        "@type": "type.googleapis.com/google.apps.alertcenter.type.AccountWarning",
        email: "employee@example.com",
        loginDetails: { loginTime: "2026-09-21T14:17:23.000Z", ipAddress: "203.0.113.42" },
      },
    }, new Date("2026-09-21T14:20:00.000Z"));

    expect(normalized).toMatchObject({
      severity: "high",
      category: "identity",
      target: "employee@example.com",
      ipAddress: "203.0.113.42",
    });
  });
});
