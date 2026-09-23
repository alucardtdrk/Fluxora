import { getDetailedEvidenceExpiry, workspaceSecurityEventId } from "../config.js";
import { isExcludedSuperadminPasswordReset } from "./alertCenter.js";
import {
  MAX_WORKSPACE_SECURITY_METADATA_STRING_CHARACTERS,
  sanitizeWorkspaceSecurityMetadata,
  type SecuritySeverity,
  type WorkspaceSecurityEvent,
  type WorkspaceSecuritySource,
} from "../types.js";

export type ReportsApplicationName = "login" | "admin" | "token" | "drive" | "groups" | "mobile" | "rules" | "gmail" | "user_accounts" | "saml" | "calendar" | "chat" | "meet";

export interface GoogleReportsParameter {
  readonly name: string;
  readonly value?: string;
  readonly intValue?: string;
  readonly boolValue?: boolean;
  readonly multiValue?: readonly string[];
  readonly multiMessageValue?: readonly Record<string, unknown>[];
}

export interface GoogleReportsActivity {
  readonly id: {
    readonly time: string;
    readonly uniqueQualifier: string;
    readonly applicationName: string;
  };
  readonly actor?: { readonly email?: string };
  readonly networkInfo?: { readonly ipAddress?: string; readonly countryCode?: string };
  readonly events: readonly {
    readonly name: string;
    readonly parameters?: readonly GoogleReportsParameter[];
  }[];
}

function sourceFor(application: ReportsApplicationName): WorkspaceSecuritySource {
  if (application === "token") return "oauth_token";
  return application;
}

function parameterValue(parameter: GoogleReportsParameter): string | boolean | undefined {
  if (parameter.boolValue !== undefined) return parameter.boolValue;
  if (parameter.value !== undefined) return parameter.value;
  if (parameter.intValue !== undefined) return parameter.intValue;
  if (parameter.multiValue !== undefined || parameter.multiMessageValue !== undefined) {
    try {
      return JSON.stringify(parameter.multiValue ?? parameter.multiMessageValue);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function parameterMetadata(parameters: readonly GoogleReportsParameter[] | undefined): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  let truncated = false;
  for (const parameter of parameters ?? []) {
    const value = parameterValue(parameter);
    if (value === undefined) continue;
    if (typeof value === "string" && Array.from(value).length > MAX_WORKSPACE_SECURITY_METADATA_STRING_CHARACTERS) {
      truncated = true;
      continue;
    }
    metadata[`parameter_${parameter.name}`] = value;
    metadata[parameter.name] = value;
  }
  if (truncated) metadata.parametersTruncated = true;
  return metadata;
}

function severityFor(application: ReportsApplicationName, eventName: string, parameters: Record<string, unknown>): SecuritySeverity {
  const name = eventName.toLowerCase();
  const severity = String(parameters.severity ?? "").toLowerCase();
  const visibility = String(parameters.visibility ?? "").toLowerCase();
  if (name.includes("account_takeover") || name.includes("leaked_password") || severity === "critical") return "critical";
  if (application === "login" && (name.includes("2sv_disable") || name.includes("2_step_verification_disable"))) return "high";
  if (application === "login" && (parameters.is_suspicious === true || name.includes("suspicious"))) return "high";
  if (application === "login" && name.includes("failure")) return "medium";
  if (application === "token" && (name.includes("authorize") || name.includes("suspicious"))) return "high";
  if (application === "drive" && (visibility.includes("external") || visibility.includes("public") || name.includes("external_share"))) return "high";
  if (application === "admin" && (name.includes("role") || name.includes("security") || name.includes("config"))) return "high";
  if (application === "rules" && (severity === "high" || name.includes("dlp"))) return "high";
  return "informational";
}

function categoryFor(application: ReportsApplicationName): string {
  if (application === "login") return "identity";
  if (application === "token") return "oauth";
  if (application === "drive") return "data_protection";
  if (application === "groups") return "identity";
  if (application === "user_accounts" || application === "saml") return "identity";
  if (application === "gmail") return "email_security";
  if (application === "calendar" || application === "chat" || application === "meet") return "collaboration";
  if (application === "mobile") return "device_security";
  if (application === "rules") return "security_policy";
  return "administration";
}

function activityTime(time: string): Date | null {
  const epochSeconds = Number(time);
  const occurredAt = Number.isFinite(epochSeconds) ? new Date(epochSeconds * 1_000) : new Date(time);
  return Number.isNaN(occurredAt.getTime()) ? null : occurredAt;
}

export function normalizeReportsActivity(
  application: ReportsApplicationName,
  activity: GoogleReportsActivity,
  observedAt: Date,
): WorkspaceSecurityEvent[] {
  const occurredAt = activityTime(activity.id.time);
  if (!occurredAt || !activity.id.uniqueQualifier) return [];

  const events: WorkspaceSecurityEvent[] = [];
  for (const [index, child] of activity.events.entries()) {
    const metadataInput = parameterMetadata(child.parameters);
    if (isExcludedSuperadminPasswordReset({ type: child.name, data: metadataInput })) continue;

    const externalId = `${application}:${activity.id.uniqueQualifier}:${child.name}:${index}`;
    const sanitized = sanitizeWorkspaceSecurityMetadata({
      application,
      uniqueQualifier: activity.id.uniqueQualifier,
      ...metadataInput,
    });
    events.push({
      id: workspaceSecurityEventId(sourceFor(application), externalId),
      externalId,
      source: sourceFor(application),
      category: categoryFor(application),
      type: child.name,
      severity: severityFor(application, child.name, metadataInput),
      title: `${application}: ${child.name}`,
      description: `Google Workspace ${application} activity: ${child.name}`,
      occurredAt,
      observedAt,
      expiresAt: getDetailedEvidenceExpiry(occurredAt),
      actor: activity.actor?.email,
      ipAddress: activity.networkInfo?.ipAddress,
      country: activity.networkInfo?.countryCode,
      metadata: sanitized.metadata,
    });
  }
  return events;
}
