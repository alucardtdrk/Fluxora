import { createHash } from "node:crypto";
import type { WorkspaceSecuritySource } from "./types.js";

export const GOOGLE_WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/apps.alerts",
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
  "https://www.googleapis.com/auth/admin.directory.rolemanagement.readonly",
] as const;

Object.freeze(GOOGLE_WORKSPACE_SCOPES);

export interface GoogleWorkspaceConfig {
  readonly serviceAccountEmail: string;
  readonly privateKey: string;
  readonly adminEmail: string;
  readonly customerId: string;
  readonly domain: string;
  readonly scopes: typeof GOOGLE_WORKSPACE_SCOPES;
}

type WorkspaceEnvironment = Readonly<Record<string, string | undefined>>;

const REQUIRED_VARIABLES = [
  "GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_WORKSPACE_PRIVATE_KEY",
  "GOOGLE_WORKSPACE_ADMIN_EMAIL",
  "GOOGLE_WORKSPACE_CUSTOMER_ID",
  "GOOGLE_WORKSPACE_DOMAIN",
] as const;

function requiredEnvironmentValue(environment: WorkspaceEnvironment, key: (typeof REQUIRED_VARIABLES)[number]): string {
  const value = environment[key];
  if (!value?.trim()) {
    throw new Error(`Missing required Google Workspace configuration: ${key}`);
  }
  return value;
}

export function loadGoogleWorkspaceConfig(environment: WorkspaceEnvironment = process.env): GoogleWorkspaceConfig {
  const serviceAccountEmail = requiredEnvironmentValue(environment, "GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = requiredEnvironmentValue(environment, "GOOGLE_WORKSPACE_PRIVATE_KEY").replaceAll("\\n", "\n");
  const adminEmail = requiredEnvironmentValue(environment, "GOOGLE_WORKSPACE_ADMIN_EMAIL");
  const customerId = requiredEnvironmentValue(environment, "GOOGLE_WORKSPACE_CUSTOMER_ID");
  const domain = requiredEnvironmentValue(environment, "GOOGLE_WORKSPACE_DOMAIN");

  return Object.freeze({
    serviceAccountEmail,
    privateKey,
    adminEmail,
    customerId,
    domain,
    scopes: GOOGLE_WORKSPACE_SCOPES,
  });
}

export function workspaceSecurityEventId(source: WorkspaceSecuritySource, externalId: string): string {
  return createHash("sha256").update(JSON.stringify([source, externalId])).digest("hex");
}

export function getDetailedEvidenceExpiry(occurredAt: Date): Date {
  return new Date(occurredAt.getTime() + 183 * 24 * 60 * 60 * 1000);
}
