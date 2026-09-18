const FLUXORA_COLLECTION_PATHS = {
  users: { legacy: "fluxora_users", destination: "fluxora/data/users" },
  auditEvents: { legacy: "fluxora_audit_events", destination: "fluxora/data/audit-events" },
  alertRules: { legacy: "fluxora_alert_rules", destination: "fluxora/data/alert-rules" },
  incidents: { legacy: "fluxora_incidents", destination: "fluxora/data/incidents" },
  notificationState: { legacy: "fluxora_notification_state", destination: "fluxora/data/notification-state" },
  slos: { legacy: "fluxora_slos", destination: "fluxora/data/slos" },
  system: { legacy: "fluxora_system", destination: "fluxora/data/system" },
  workspaceDirectoryPosture: { legacy: "fluxora_workspace_directory_posture", destination: "fluxora/data/workspace-directory-posture" },
  workspaceSecurityEvents: { legacy: "fluxora_workspace_security_events", destination: "fluxora/data/workspace-security-events" },
  workspaceSecurityFindings: { legacy: "fluxora_workspace_security_findings", destination: "fluxora/data/workspace-security-findings" },
  workspaceSyncState: { legacy: "fluxora_workspace_sync_state", destination: "fluxora/data/workspace-sync-state" },
} as const;

export type FluxoraCollectionKey = keyof typeof FLUXORA_COLLECTION_PATHS;

export function getFluxoraCollectionPaths(key: FluxoraCollectionKey) {
  return FLUXORA_COLLECTION_PATHS[key];
}

export function isAllowedFluxoraLegacyCollection(collection: string): collection is (typeof FLUXORA_COLLECTION_PATHS)[FluxoraCollectionKey]["legacy"] {
  return Object.values(FLUXORA_COLLECTION_PATHS).some((paths) => paths.legacy === collection);
}

export const fluxoraCollectionKeys = Object.freeze(Object.keys(FLUXORA_COLLECTION_PATHS) as FluxoraCollectionKey[]);
