import { createGoogleWorkspaceTokenProvider } from "./auth.js";
import { createGoogleWorkspaceClient, type GoogleWorkspaceClient } from "./client.js";
import { loadGoogleWorkspaceConfig } from "./config.js";

export async function checkGoogleWorkspaceAccess(client: GoogleWorkspaceClient, config: { customerId: string }) {
  const reports = { login: "Login", admin: "Administração", token: "OAuth", drive: "Drive", groups: "Grupos", mobile: "Dispositivos", rules: "Regras", gmail: "Gmail", user_accounts: "Contas de usuário", saml: "SAML", calendar: "Agenda", chat: "Chat", meet: "Meet" };
  const endpoints = [
    { source: "Alert Center", url: `https://alertcenter.googleapis.com/v1beta1/alerts?customerId=${encodeURIComponent(config.customerId.replace(/^C/, ""))}&pageSize=1` },
    ...Object.entries(reports).map(([application, source]) => ({ source, url: `https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/${application}?customerId=${encodeURIComponent(config.customerId)}&maxResults=1&startTime=${new Date(Date.now() - 86_400_000).toISOString()}` })),
    { source: "Diretório de usuários", url: `https://admin.googleapis.com/admin/directory/v1/users?customer=${encodeURIComponent(config.customerId)}&maxResults=1` },
    { source: "Perfis administrativos", url: `https://admin.googleapis.com/admin/directory/v1/customer/${encodeURIComponent(config.customerId)}/roles?maxResults=1` },
    { source: "Atribuições administrativas", url: `https://admin.googleapis.com/admin/directory/v1/customer/${encodeURIComponent(config.customerId)}/roleassignments?maxResults=1` },
  ];
  const checks = await Promise.all(endpoints.map(async ({ source, url }) => {
    try {
      await client.getJson(new URL(url));
      return { source, ok: true, message: "Acesso confirmado." };
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
      return { source, ok: false, message: status === 401 || status === 403 ? "Acesso negado. Revise as permissões e a delegação de domínio." : status === 429 ? "Limite temporário do Google atingido. Tente novamente depois." : "Não foi possível autenticar ou consultar esta fonte. Revise a conexão e tente novamente." };
    }
  }));
  return { ok: checks.every((check) => check.ok), checks };
}

export async function testGoogleWorkspaceConnection() {
  let config;
  try { config = loadGoogleWorkspaceConfig(); }
  catch { return { ok: false, checks: [{ source: "Configuração", ok: false, message: "A configuração do Google Workspace está incompleta." }] }; }
  const client = createGoogleWorkspaceClient(createGoogleWorkspaceTokenProvider(config));
  return checkGoogleWorkspaceAccess(client, config);
}
