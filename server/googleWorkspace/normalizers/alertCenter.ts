import { getDetailedEvidenceExpiry, workspaceSecurityEventId } from "../config.js";
import {
  MAX_WORKSPACE_SECURITY_METADATA_STRING_CHARACTERS,
  sanitizeWorkspaceSecurityMetadata,
  type SecuritySeverity,
  type WorkspaceSecuritySafeDetails,
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

function boundedText(value: unknown): string | undefined {
  const result = text(value);
  return result ? Array.from(result).slice(0, MAX_WORKSPACE_SECURITY_METADATA_STRING_CHARACTERS).join("") : undefined;
}

function stringList(value: unknown): readonly string[] | undefined {
  const values = Array.isArray(value) ? value : [value];
  const safeValues = values
    .map(boundedText)
    .filter((item): item is string => Boolean(item))
    .slice(0, 20);
  return safeValues.length ? safeValues : undefined;
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function phishingSafeDetails(data: Readonly<Record<string, unknown>>): WorkspaceSecuritySafeDetails | undefined {
  if (text(data["@type"]) !== "type.googleapis.com/google.apps.alertcenter.type.MailPhishing") return undefined;

  const maliciousEntity = recordValue(data.maliciousEntity);
  const details: WorkspaceSecuritySafeDetails = {
    reporterEmail: boundedText(data.reporterEmail) ?? boundedText(data.reportedBy),
    suspectedSender: boundedText(maliciousEntity?.fromHeader) ?? boundedText(data.senderEmail),
    subject: boundedText(maliciousEntity?.subject) ?? boundedText(data.subject),
    affectedUsers: stringList(data.affectedUserEmails),
    indicatorUrls: stringList(data.urls),
    attachmentNames: stringList(data.attachments),
  };

  return Object.values(details).some((value) => value !== undefined) ? details : undefined;
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
    safeDetails: phishingSafeDetails(data),
    metadata: sanitizeWorkspaceSecurityMetadata(metadataInput).metadata,
  };
}
