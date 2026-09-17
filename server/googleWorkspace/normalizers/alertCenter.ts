import { getDetailedEvidenceExpiry, workspaceSecurityEventId } from "../config.js";
import {
  sanitizeWorkspaceSecurityMetadata,
  type SecuritySeverity,
  type WorkspaceSecurityEvent,
} from "../types.js";

export interface GoogleAlertCenterAlert {
  readonly customerId?: string;
  readonly alertId: string;
  readonly createTime: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly type: string;
  readonly source: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly updateTime?: string;
  readonly deleted?: boolean;
}

const SUPERADMIN_PASSWORD_RESET_TYPE = "super admin password reset";
const SUPERADMIN_PASSWORD_RESET_DATA_TYPE = "type.googleapis.com/google.apps.alertcenter.type.SuperadminPasswordReset";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function firstText(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === "string" && item.trim() !== "");
  return text(value);
}

function metadataValue(value: unknown): string | number | boolean | null | undefined {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function severityFor(alert: GoogleAlertCenterAlert): SecuritySeverity {
  const classification = `${alert.type} ${alert.source}`.toLowerCase();
  if (classification.includes("account takeover") || classification.includes("leaked password")) return "critical";
  if (
    classification.includes("phishing") ||
    classification.includes("malware") ||
    classification.includes("data loss") ||
    classification.includes("sensitive data")
  ) return "high";
  return "medium";
}

function categoryFor(alert: GoogleAlertCenterAlert): string {
  const classification = `${alert.type} ${alert.source}`.toLowerCase();
  if (classification.includes("phishing") || classification.includes("malware") || classification.includes("gmail")) {
    return "email_security";
  }
  if (classification.includes("data loss") || classification.includes("sensitive data")) return "data_protection";
  if (classification.includes("account") || classification.includes("identity")) return "identity";
  return "workspace_security";
}

export function isExcludedSuperadminPasswordReset(alert: Pick<GoogleAlertCenterAlert, "type" | "data">): boolean {
  const dataType = text(alert.data?.["@type"]);
  const normalizedType = alert.type.trim().toLowerCase().replaceAll(/[_-]+/g, " ").replaceAll(/\s+/g, " ");
  const superadminParameter = alert.data?.USER_IS_SUPER_ADMIN ?? alert.data?.userIsSuperAdmin;
  return (
    normalizedType === SUPERADMIN_PASSWORD_RESET_TYPE ||
    dataType === SUPERADMIN_PASSWORD_RESET_DATA_TYPE ||
    (normalizedType === "reset password" && superadminParameter === true)
  );
}

export function normalizeAlertCenterAlert(
  alert: GoogleAlertCenterAlert,
  observedAt: Date,
): WorkspaceSecurityEvent | null {
  if (isExcludedSuperadminPasswordReset(alert)) return null;

  const occurredAt = new Date(alert.createTime);
  if (!alert.alertId || !alert.type || !alert.source || Number.isNaN(occurredAt.getTime())) return null;

  const data = alert.data ?? {};
  const metadataInput: Record<string, unknown> = {
    originalType: alert.type,
    originalSource: alert.source,
    createTime: alert.createTime,
    startTime: alert.startTime,
    endTime: alert.endTime,
    updateTime: alert.updateTime,
    dataType: text(data["@type"]),
  };

  for (const [key, value] of Object.entries(data)) {
    if (key === "@type") continue;
    metadataInput[`data_${key}`] = metadataValue(value);
  }

  return {
    id: workspaceSecurityEventId("alert_center", alert.alertId),
    externalId: alert.alertId,
    source: "alert_center",
    category: categoryFor(alert),
    type: alert.type,
    severity: severityFor(alert),
    title: alert.type,
    description: `Google Workspace Alert Center: ${alert.type}`,
    occurredAt,
    observedAt,
    expiresAt: getDetailedEvidenceExpiry(occurredAt),
    actor: text(data.actorEmail) ?? text(data.actor),
    target: firstText(data.affectedUserEmails) ?? text(data.targetEmail) ?? text(data.resourceName),
    ipAddress: text(data.ipAddress),
    country: text(data.country),
    metadata: sanitizeWorkspaceSecurityMetadata(metadataInput).metadata,
  };
}
