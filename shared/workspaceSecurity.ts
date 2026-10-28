export const WORKSPACE_SECURITY_SOURCES = [
  "alert_center", "login", "admin", "oauth_token", "drive", "groups", "mobile",
  "rules", "gmail", "user_accounts", "saml", "calendar", "chat", "meet",
] as const;

export type WorkspaceSecuritySource = typeof WORKSPACE_SECURITY_SOURCES[number];
