import { describe, expect, it } from "vitest";
import type { GoogleWorkspaceClient } from "../client.js";
import { collectDirectoryPosture } from "./directory.js";

class PageClient implements GoogleWorkspaceClient {
  readonly urls: string[] = [];
  constructor(private readonly pages: Readonly<Record<string, readonly unknown[]>>) {}
  async getJson<T>(_url: URL): Promise<T> { throw new Error("Directory uses pagination"); }
  async *paginate<T>(url: URL): AsyncIterable<T> {
    this.urls.push(url.toString());
    const path = url.pathname.includes("roleassignments") ? "assignments" : url.pathname.endsWith("/roles") ? "roles" : "users";
    for (const page of this.pages[path] ?? []) yield page as T;
  }
}

describe("Directory posture collector", () => {
  it("counts active and suspended users", async () => {
    const client = new PageClient({ users: [{ users: [{ id: "u1", suspended: false, isEnrolledIn2Sv: true }, { id: "u2", suspended: true, isEnrolledIn2Sv: false }] }], roles: [{ items: [] }], assignments: [{ items: [] }] });
    const posture = await collectDirectoryPosture({ client, customerId: "C01234567", domain: "example.com", capturedAt: new Date("2026-09-17T12:00:00Z") });
    expect(posture.users).toEqual({ active: 1, suspended: 1, withoutTwoStepVerification: 1 });
  });

  it("resolves delegated administrators from role assignments", async () => {
    const client = new PageClient({ users: [{ users: [] }], roles: [{ items: [{ roleId: "r1", roleName: "Help Desk Admin" }] }], assignments: [{ items: [{ roleId: "r1", assignedTo: "u1" }, { roleId: "r1", assignedTo: "u2" }] }] });
    const posture = await collectDirectoryPosture({ client, customerId: "C01234567", domain: "example.com", capturedAt: new Date("2026-09-17T12:00:00Z") });
    expect(posture.delegatedAdministrators).toEqual({ totalAssignments: 2, roleNames: ["Help Desk Admin"] });
  });

  it("paginates users and role assignments using only safe fields", async () => {
    const client = new PageClient({ users: [{ users: [], nextPageToken: "u2" }, { users: [] }], roles: [{ items: [] }], assignments: [{ items: [], nextPageToken: "a2" }, { items: [] }] });
    await collectDirectoryPosture({ client, customerId: "C01234567", domain: "example.com", capturedAt: new Date("2026-09-17T12:00:00Z") });
    expect(client.urls[0]).toContain("fields=nextPageToken%2Cusers%28id%2Csuspended%2CisEnrolledIn2Sv%29");
    expect(client.urls[2]).toContain("roleassignments");
    expect(client.urls.join(" ")).not.toContain("recovery");
  });

  it("does not store recovery emails, phone numbers or access credentials", async () => {
    const client = new PageClient({ users: [{ users: [{ id: "u1", suspended: false, isEnrolledIn2Sv: false, recoveryEmail: "secret@example.com", recoveryPhone: "+5511999999999", accessToken: "secret" }] }], roles: [{ items: [] }], assignments: [{ items: [] }] });
    const posture = await collectDirectoryPosture({ client, customerId: "C01234567", domain: "example.com", capturedAt: new Date("2026-09-17T12:00:00Z") });
    expect(JSON.stringify(posture)).not.toContain("secret@example.com");
    expect(JSON.stringify(posture)).not.toContain("9999999999");
    expect(JSON.stringify(posture)).not.toContain("accessToken");
  });
});
