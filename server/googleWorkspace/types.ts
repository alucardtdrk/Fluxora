export type WorkspaceSecuritySource = "alert_center" | "login" | "admin" | "oauth_token" | "drive";

export type SecuritySeverity = "critical" | "high" | "medium" | "low" | "informational";

export const MAX_WORKSPACE_SECURITY_METADATA_ENTRIES = 50;
export const MAX_WORKSPACE_SECURITY_METADATA_KEY_CHARACTERS = 100;
export const MAX_WORKSPACE_SECURITY_METADATA_STRING_CHARACTERS = 2_000;

type WorkspaceSecurityMetadataValue = string | number | boolean | null;

declare const workspaceSecurityMetadataBrand: unique symbol;

export type WorkspaceSecurityMetadata = Readonly<Record<string, WorkspaceSecurityMetadataValue>> & {
  readonly [workspaceSecurityMetadataBrand]: true;
};

export interface WorkspaceSecuritySafeDetails {
  readonly reporterEmail?: string;
  readonly suspectedSender?: string;
  readonly subject?: string;
  readonly affectedUsers?: readonly string[];
  readonly indicatorUrls?: readonly string[];
  readonly attachmentNames?: readonly string[];
}

export interface SanitizedWorkspaceSecurityMetadata {
  readonly metadata: WorkspaceSecurityMetadata;
  readonly truncated: boolean;
}

function compareMetadataKeys(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function truncateCharacters(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("");
}

function isMetadataValue(value: unknown): value is WorkspaceSecurityMetadataValue {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

export function sanitizeWorkspaceSecurityMetadata(
  input: Readonly<Record<string, unknown>>,
): SanitizedWorkspaceSecurityMetadata {
  const metadata = Object.create(null) as Record<string, WorkspaceSecurityMetadataValue>;
  let truncated = false;
  let entryCount = 0;

  for (const [key, value] of Object.entries(input).sort(([left], [right]) => compareMetadataKeys(left, right))) {
    if (Array.from(key).length > MAX_WORKSPACE_SECURITY_METADATA_KEY_CHARACTERS || !isMetadataValue(value)) {
      truncated = true;
      continue;
    }

    if (entryCount >= MAX_WORKSPACE_SECURITY_METADATA_ENTRIES) {
      truncated = true;
      continue;
    }

    if (typeof value === "string" && Array.from(value).length > MAX_WORKSPACE_SECURITY_METADATA_STRING_CHARACTERS) {
      metadata[key] = truncateCharacters(value, MAX_WORKSPACE_SECURITY_METADATA_STRING_CHARACTERS);
      truncated = true;
    } else {
      metadata[key] = value;
    }
    entryCount += 1;
  }

  return Object.freeze({
    metadata: Object.freeze(metadata) as WorkspaceSecurityMetadata,
    truncated,
  });
}

export interface WorkspaceSecurityEvent {
  id: string;
  externalId: string;
  source: WorkspaceSecuritySource;
  category: string;
  type: string;
  severity: SecuritySeverity;
  title: string;
  description: string;
  occurredAt: Date;
  observedAt: Date;
  expiresAt: Date;
  actor?: string;
  target?: string;
  ipAddress?: string;
  country?: string;
  safeDetails?: WorkspaceSecuritySafeDetails;
  metadata: WorkspaceSecurityMetadata;
}

export interface WorkspaceSyncCursor {
  source: WorkspaceSecuritySource;
  cursor: string | null;
  lastAttemptedAt: Date | null;
  lastSucceededAt: Date | null;
  lastError: WorkspaceSyncErrorCode | null;
}

export type WorkspaceSyncErrorCode =
  | "configuration"
  | "authentication"
  | "authorization"
  | "rate_limited"
  | "upstream"
  | "persistence"
  | "unknown";
