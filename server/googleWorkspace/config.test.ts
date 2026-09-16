import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GOOGLE_WORKSPACE_SCOPES,
  getDetailedEvidenceExpiry,
  loadGoogleWorkspaceConfig,
  workspaceSecurityEventId,
} from "./config.js";
import { sanitizeWorkspaceSecurityMetadata } from "./types.js";
import type { WorkspaceSyncCursor } from "./types.js";

const completeEnvironment = {
  GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL: "workspace-audit@example.iam.gserviceaccount.com",
  GOOGLE_WORKSPACE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nline-two\\n-----END PRIVATE KEY-----",
  GOOGLE_WORKSPACE_ADMIN_EMAIL: "security-admin@example.com",
  GOOGLE_WORKSPACE_CUSTOMER_ID: "C01234567",
  GOOGLE_WORKSPACE_DOMAIN: "example.com",
};

describe("Google Workspace security configuration", () => {
  it("rejects a missing delegated administrator without exposing environment values", () => {
    const environment: Record<string, string | undefined> = { ...completeEnvironment };
    environment.GOOGLE_WORKSPACE_ADMIN_EMAIL = undefined;

    let message = "";
    try {
      loadGoogleWorkspaceConfig(environment);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("GOOGLE_WORKSPACE_ADMIN_EMAIL");
    for (const value of Object.values(completeEnvironment)) {
      expect(message).not.toContain(value);
    }
  });

  it("converts escaped private-key newlines and returns an immutable configuration", () => {
    const config = loadGoogleWorkspaceConfig(completeEnvironment);

    expect(config.privateKey).toBe("-----BEGIN PRIVATE KEY-----\nline-two\n-----END PRIVATE KEY-----");
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.scopes)).toBe(true);
  });

  it("uses only the approved Google Workspace audit scopes", () => {
    expect(GOOGLE_WORKSPACE_SCOPES).toEqual([
      "https://www.googleapis.com/auth/apps.alerts",
      "https://www.googleapis.com/auth/admin.reports.audit.readonly",
      "https://www.googleapis.com/auth/admin.directory.user.readonly",
      "https://www.googleapis.com/auth/admin.directory.group.readonly",
      "https://www.googleapis.com/auth/admin.directory.rolemanagement.readonly",
    ]);
  });

  it("derives a deterministic event identity from the source and external ID only", () => {
    const expected = createHash("sha256")
      .update(JSON.stringify(["login", "event-123"]))
      .digest("hex");

    expect(workspaceSecurityEventId("login", "event-123")).toBe(expected);
    expect(workspaceSecurityEventId("login", "event-123")).toBe(workspaceSecurityEventId("login", "event-123"));
    expect(workspaceSecurityEventId("admin", "event-123")).not.toBe(expected);
    expect(workspaceSecurityEventId("login", "event-124")).not.toBe(expected);
  });

  it("expires detailed evidence exactly 183 days after its occurrence", () => {
    const occurredAt = new Date("2026-01-01T12:34:56.789Z");

    expect(getDetailedEvidenceExpiry(occurredAt).toISOString()).toBe("2026-07-03T12:34:56.789Z");
    expect(occurredAt.toISOString()).toBe("2026-01-01T12:34:56.789Z");
  });

  it("keeps a deterministic maximum of 50 metadata entries", () => {
    const metadata = Object.fromEntries(
      Array.from({ length: 52 }, (_, index) => [`entry-${String(index).padStart(2, "0")}`, index]),
    );

    const sanitized = sanitizeWorkspaceSecurityMetadata(metadata);

    expect(Object.keys(sanitized.metadata)).toEqual(
      Array.from({ length: 50 }, (_, index) => `entry-${String(index).padStart(2, "0")}`),
    );
    expect(sanitized.truncated).toBe(true);
  });

  it("truncates long metadata strings and discards overlong keys", () => {
    const sanitized = sanitizeWorkspaceSecurityMetadata({
      normal: "a".repeat(2_001),
      ["k".repeat(101)]: "discarded",
    });

    expect(sanitized.metadata).toEqual({ normal: "a".repeat(2_000) });
    expect(sanitized.truncated).toBe(true);
  });

  it("preserves __proto__ as a safe own metadata property without truncation", () => {
    const input = Object.create(null) as Record<string, unknown>;
    input.__proto__ = "safe-value";

    const sanitized = sanitizeWorkspaceSecurityMetadata(input);

    expect(Object.hasOwn(sanitized.metadata, "__proto__")).toBe(true);
    expect(sanitized.metadata.__proto__).toBe("safe-value");
    expect(Object.getPrototypeOf(sanitized.metadata)).toBeNull();
    expect(sanitized.truncated).toBe(false);
  });

  it("limits cursor errors to the safe closed error-code set", () => {
    const cursor: WorkspaceSyncCursor = {
      source: "login",
      cursor: null,
      lastAttemptedAt: null,
      lastSucceededAt: null,
      lastError: "authentication",
    };

    expect(cursor.lastError).toBe("authentication");
  });
});

// @ts-expect-error Workspace sync state must never retain arbitrary upstream error text.
const unsafeCursorError: WorkspaceSyncCursor["lastError"] = "token for user@example.com was rejected";
void unsafeCursorError;
