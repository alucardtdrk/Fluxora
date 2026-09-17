import { describe, expect, it } from "vitest";
import type { GoogleWorkspaceClient } from "../client.js";
import { collectReportsEvidence } from "./reports.js";
import {
  normalizeReportsActivity,
  type GoogleReportsActivity,
} from "../normalizers/reports.js";

const loginActivity: GoogleReportsActivity = {
  id: { time: "1789552800", uniqueQualifier: "100", applicationName: "login" },
  actor: { email: "employee@example.com" },
  networkInfo: { ipAddress: "203.0.113.42", countryCode: "BR" },
  events: [
    { name: "login_success", parameters: [{ name: "is_suspicious", boolValue: true }] },
    { name: "login_failure", parameters: [{ name: "login_type", value: "password" }] },
  ],
};

const adminPasswordResetActivity: GoogleReportsActivity = {
  id: { time: "1789552810", uniqueQualifier: "101", applicationName: "admin" },
  actor: { email: "superadmin@example.com" },
  events: [{ name: "RESET_PASSWORD", parameters: [{ name: "USER_IS_SUPER_ADMIN", boolValue: true }] }],
};

const adminRoleActivity: GoogleReportsActivity = {
  id: { time: "1789552820", uniqueQualifier: "102", applicationName: "admin" },
  actor: { email: "superadmin@example.com" },
  events: [{ name: "ASSIGN_ROLE", parameters: [{ name: "ROLE_NAME", value: "Help Desk Admin" }] }],
};

const tokenActivity: GoogleReportsActivity = {
  id: { time: "1789552830", uniqueQualifier: "103", applicationName: "token" },
  actor: { email: "employee@example.com" },
  events: [{ name: "authorize", parameters: [{ name: "client_name", value: "Untrusted OAuth App" }] }],
};

const driveActivity: GoogleReportsActivity = {
  id: { time: "1789552840", uniqueQualifier: "104", applicationName: "drive" },
  actor: { email: "employee@example.com" },
  events: [{ name: "change_user_access", parameters: [{ name: "doc_title", value: "Budget 2026" }] }],
};

class PageClient implements GoogleWorkspaceClient {
  readonly requestedUrls: string[] = [];
  constructor(private readonly pages: readonly unknown[]) {}

  async getJson<T>(_url: URL): Promise<T> {
    throw new Error("Reports collection must use pagination");
  }

  async *paginate<T>(url: URL): AsyncIterable<T> {
    this.requestedUrls.push(url.toString());
    for (const page of this.pages) yield page as T;
  }
}

describe("Reports collector", () => {
  it("paginates login activity from a five-minute overlap window", async () => {
    const client = new PageClient([{ items: [loginActivity], nextPageToken: "page-2" }, { items: [] }]);

    const events = await collectReportsEvidence({
      client,
      application: "login",
      customerId: "C01234567",
      lastSuccessfulEventAt: new Date("2026-09-17T12:00:00.000Z"),
      now: () => new Date("2026-09-17T12:10:00.000Z"),
    });

    expect(events).toHaveLength(2);
    expect(client.requestedUrls).toEqual([
      "https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/login?customerId=C01234567&startTime=2026-09-17T11%3A55%3A00.000Z&endTime=2026-09-17T12%3A10%3A00.000Z&maxResults=1000",
    ]);
  });

  it("keeps source-specific normalized identities for login, token and drive", () => {
    const observedAt = new Date("2026-09-17T12:10:00.000Z");

    const login = normalizeReportsActivity("login", loginActivity, observedAt);
    const token = normalizeReportsActivity("token", tokenActivity, observedAt);
    const drive = normalizeReportsActivity("drive", driveActivity, observedAt);

    expect(login.map((event) => event.externalId)).toEqual(["login:100:login_success:0", "login:100:login_failure:1"]);
    expect(token[0]).toMatchObject({ source: "oauth_token", actor: "employee@example.com" });
    expect(drive[0]).toMatchObject({ source: "drive", type: "change_user_access" });
    expect(new Set([login[0]?.id, token[0]?.id, drive[0]?.id]).size).toBe(3);
  });

  it("extracts actor and network information while raising suspicious logins", () => {
    const [event] = normalizeReportsActivity("login", loginActivity, new Date("2026-09-17T12:10:00.000Z"));

    expect(event).toMatchObject({
      severity: "high",
      actor: "employee@example.com",
      ipAddress: "203.0.113.42",
      country: "BR",
      metadata: { parameter_is_suspicious: true },
    });
  });

  it("drops only superadministrator password reset events", () => {
    expect(normalizeReportsActivity("admin", adminPasswordResetActivity, new Date("2026-09-17T12:10:00.000Z"))).toEqual([]);
    expect(normalizeReportsActivity("admin", adminRoleActivity, new Date("2026-09-17T12:10:00.000Z"))).toHaveLength(1);
  });

  it("marks discarded oversized parameter values without persisting them", () => {
    const [event] = normalizeReportsActivity("token", {
      ...tokenActivity,
      events: [{ name: "authorize", parameters: [{ name: "unsafe", value: "x".repeat(2_001) }] }],
    }, new Date("2026-09-17T12:10:00.000Z"));

    expect(event?.metadata).toMatchObject({ parametersTruncated: true });
    expect(JSON.stringify(event?.metadata)).not.toContain("x".repeat(100));
  });

  it("surfaces a forbidden Reports source as a failure", async () => {
    const client: GoogleWorkspaceClient = {
      getJson: async () => ({}) as never,
      paginate: async function* () {
        throw Object.assign(new Error("forbidden"), { code: "upstream_error", status: 403 });
      },
    };

    await expect(collectReportsEvidence({
      client,
      application: "drive",
      customerId: "C01234567",
      lastSuccessfulEventAt: new Date("2026-09-17T12:00:00.000Z"),
    })).rejects.toMatchObject({ status: 403 });
  });
});
