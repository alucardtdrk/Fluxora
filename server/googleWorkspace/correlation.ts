import { createHash } from "node:crypto";
import type { WorkspaceSecurityEvent, WorkspaceSecurityFinding } from "./types.js";

export const CORRELATION_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const DISTRIBUTED_LOGIN_WINDOW_MS = 30 * 60 * 1_000;
export const MIN_DISTRIBUTED_LOGIN_FAILURES = 3;

function findingId(rule: string, subject: string, occurredAt: Date) {
  const bucket = occurredAt.toISOString().slice(0, 10);
  return createHash("sha256").update(JSON.stringify([rule, subject, bucket])).digest("hex");
}

function unique(values: readonly (string | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function isIdentityRisk(event: WorkspaceSecurityEvent) {
  return (event.source === "login" && /login|suspicious/.test(event.type.toLowerCase()) && (event.severity === "high" || event.severity === "critical")) ||
    (event.source === "alert_center" && /suspicious[ _](programmatic[ _])?login|account[ _]takeover|leaked[ _]password/.test(event.type.toLowerCase()));
}

function parameter(event: WorkspaceSecurityEvent, name: string) {
  return event.metadata[name] ?? event.metadata[name.toUpperCase()];
}

function hasSensitiveOAuthScope(event: WorkspaceSecurityEvent) {
  const scopes = parameter(event, "scope") ?? parameter(event, "scopes");
  return String(scopes ?? "").split(/[\s,]+/).some((scope) =>
    scope === "https://mail.google.com/" || /^https:\/\/www\.googleapis\.com\/auth\/(gmail\.(readonly|modify|settings\.sharing)|drive(\.readonly)?|admin\.directory\.(user|rolemanagement)(\.readonly)?)$/.test(scope));
}
export function correlateWorkspaceSecurityEvents(events: readonly WorkspaceSecurityEvent[], now: Date): readonly WorkspaceSecurityFinding[] {
  const since = now.getTime() - CORRELATION_WINDOW_MS;
  const failures = events
    .filter((event) => event.occurredAt.getTime() >= since && event.source === "login" && event.type.toLowerCase().includes("failure") && event.actor)
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
  const findings: WorkspaceSecurityFinding[] = [];

  for (const actor of unique(failures.map((event) => event.actor))) {
    const actorFailures = failures.filter((event) => event.actor === actor);
    const window = actorFailures.filter((event) => event.occurredAt.getTime() - actorFailures[0]!.occurredAt.getTime() <= DISTRIBUTED_LOGIN_WINDOW_MS);
    const differentOrigins = unique(window.map((event) => event.ipAddress)).length >= 2 || unique(window.map((event) => event.country)).length >= 2;
    if (window.length < MIN_DISTRIBUTED_LOGIN_FAILURES || !differentOrigins) continue;

    findings.push({
      id: findingId("distributed_login_failures", actor, window[0]!.occurredAt),
      rule: "distributed_login_failures",
      severity: "high",
      title: "Tentativas de login distribuídas",
      description: "Falhas de login para o mesmo usuário foram observadas em origens de rede diferentes.",
      subjects: [actor],
      ipAddresses: unique(window.map((event) => event.ipAddress)),
      eventIds: unique(window.map((event) => event.id)),
      firstOccurredAt: window[0]!.occurredAt,
      lastOccurredAt: window.at(-1)!.occurredAt,
      evidenceCount: window.length,
      expiresAt: new Date(Math.min(...window.map((event) => event.expiresAt.getTime()))),
    });
  }

  const recentEvents = events.filter((event) => event.occurredAt.getTime() >= since && event.occurredAt <= now).sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
  for (const actor of unique(recentEvents.map((event) => isIdentityRisk(event) ? event.target ?? event.actor : event.actor))) {
    const actorEvents = recentEvents.filter((event) => (isIdentityRisk(event) ? event.target ?? event.actor : event.actor) === actor);
    const suspiciousLogin = actorEvents.find(isIdentityRisk);
    const oauth = actorEvents.find((event) => event.source === "oauth_token" && suspiciousLogin && event.occurredAt >= suspiciousLogin.occurredAt);
    if (!suspiciousLogin || !oauth) continue;
    const evidence = [suspiciousLogin, oauth];
    findings.push({
      id: findingId("suspicious_login_then_oauth", actor, suspiciousLogin.occurredAt),
      rule: "suspicious_login_then_oauth",
      severity: "high",
      title: "Login suspeito seguido de autorização OAuth",
      description: "Uma autorização OAuth ocorreu após um login de alto risco para o mesmo usuário.",
      subjects: [actor], ipAddresses: unique(evidence.map((event) => event.ipAddress)), eventIds: unique(evidence.map((event) => event.id)),
      firstOccurredAt: suspiciousLogin.occurredAt, lastOccurredAt: oauth.occurredAt, evidenceCount: 2,
      expiresAt: new Date(Math.min(...evidence.map((event) => event.expiresAt.getTime()))),
    });
  }

  const phishingAlerts = recentEvents.filter((event) => event.source === "alert_center" && (event.type.toLowerCase().includes("phishing") || event.type.toLowerCase().includes("malware")));
  for (const subject of unique(phishingAlerts.map((event) => event.target ?? event.safeDetails?.reporterEmail ?? event.safeDetails?.suspectedSender))) {
    const evidence = phishingAlerts.filter((event) => (event.target ?? event.safeDetails?.reporterEmail ?? event.safeDetails?.suspectedSender) === subject);
    if (evidence.length < 3) continue;
    findings.push({
      id: findingId("repeated_phishing_or_malware", subject, evidence[0]!.occurredAt),
      rule: "repeated_phishing_or_malware",
      severity: "high",
      title: "Phishing ou malware recorrente",
      description: "Múltiplos alertas de phishing ou malware foram associados ao mesmo alvo.",
      subjects: [subject], ipAddresses: unique(evidence.map((event) => event.ipAddress)), eventIds: unique(evidence.map((event) => event.id)),
      firstOccurredAt: evidence[0]!.occurredAt, lastOccurredAt: evidence.at(-1)!.occurredAt, evidenceCount: evidence.length,
      expiresAt: new Date(Math.min(...evidence.map((event) => event.expiresAt.getTime()))),
    });
  }

  for (const actor of unique(recentEvents.map((event) => isIdentityRisk(event) ? event.target ?? event.actor : event.actor))) {
    const actorEvents = recentEvents.filter((event) => (isIdentityRisk(event) ? event.target ?? event.actor : event.actor) === actor);
    const identityRisk = actorEvents.find(isIdentityRisk);
    if (!identityRisk) continue;

    const adminEvent = actorEvents.find((event) => event.source === "admin" && /^(assign_role|grant_admin_privilege|grant_admin_privileges|create_gmail_setting|change_gmail_setting|change_email_setting|enforce_strong_authentication|trust_domain_owned_oauth2_apps|multiple_add_to_trusted_oauth2_apps)$/.test(event.type.toLowerCase()) && (event.severity === "high" || event.severity === "critical") && event.occurredAt >= identityRisk.occurredAt);
    if (adminEvent) {
      const evidence = [identityRisk, adminEvent];
      findings.push({
        id: findingId("admin_change_then_identity_risk", actor, identityRisk.occurredAt), rule: "admin_change_then_identity_risk", severity: "high",
        title: "Alteração administrativa após risco de identidade", description: "Uma alteração administrativa ocorreu após um sinal de risco para o mesmo usuário.",
        subjects: [actor], ipAddresses: unique(evidence.map((event) => event.ipAddress)), eventIds: unique(evidence.map((event) => event.id)),
        firstOccurredAt: identityRisk.occurredAt, lastOccurredAt: adminEvent.occurredAt, evidenceCount: 2,
        expiresAt: new Date(Math.min(...evidence.map((event) => event.expiresAt.getTime()))),
      });
    }

    const driveEvent = actorEvents.find((event) => event.source === "drive" && (/^(download|export)$/.test(event.type.toLowerCase()) || (/change_user_access|change_document_visibility|external_share/.test(event.type.toLowerCase()) && (event.severity === "high" || event.severity === "critical"))) && event.occurredAt >= identityRisk.occurredAt);
    if (driveEvent) {
      const evidence = [identityRisk, driveEvent];
      findings.push({
        id: findingId("drive_activity_after_identity_risk", actor, identityRisk.occurredAt), rule: "drive_activity_after_identity_risk", severity: "high",
        title: "Atividade no Drive após risco de identidade", description: "Uma atividade sensível no Drive ocorreu após um sinal de risco para o mesmo usuário.",
        subjects: [actor], ipAddresses: unique(evidence.map((event) => event.ipAddress)), eventIds: unique(evidence.map((event) => event.id)),
        firstOccurredAt: identityRisk.occurredAt, lastOccurredAt: driveEvent.occurredAt, evidenceCount: 2,
        expiresAt: new Date(Math.min(...evidence.map((event) => event.expiresAt.getTime()))),
      });
    }
  }

  for (const actor of unique(recentEvents.map((event) => isIdentityRisk(event) ? event.target ?? event.actor : event.actor))) {
    const logins = recentEvents.filter((event) => event.actor === actor && event.source === "login" && event.type === "login_success" && event.country && event.ipAddress)
      .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
    for (let index = 1; index < logins.length; index++) {
      const previous = logins[index - 1]!;
      const current = logins[index]!;
      if (previous.country === current.country || previous.ipAddress === current.ipAddress || current.occurredAt.getTime() - previous.occurredAt.getTime() > DISTRIBUTED_LOGIN_WINDOW_MS) continue;
      findings.push({
        id: findingId("rapid_login_country_change", `${actor}:${current.id}`, current.occurredAt), rule: "rapid_login_country_change", severity: "high",
        title: "Logins em países diferentes em curto intervalo",
        description: `A conta teve logins de ${previous.country} e ${current.country} em até 30 minutos. Confirme se o usuário reconhece os acessos e utiliza VPN; o sinal não confirma invasão.`,
        subjects: [actor], ipAddresses: unique([previous.ipAddress, current.ipAddress]), eventIds: [previous.id, current.id],
        firstOccurredAt: previous.occurredAt, lastOccurredAt: current.occurredAt, evidenceCount: 2,
        expiresAt: new Date(Math.min(previous.expiresAt.getTime(), current.expiresAt.getTime())),
      });
    }
  }
  const singleSignalRules = [
    { rule: "sensitive_oauth_grant", matches: (event: WorkspaceSecurityEvent) => event.source === "oauth_token" && event.type.toLowerCase() === "authorize" && hasSensitiveOAuthScope(event), title: "Aplicativo autorizado com permissões sensíveis", description: "Um aplicativo recebeu acesso a e-mails, arquivos ou administração. Esse acesso pode persistir sem novos logins. Revise o aplicativo, as permissões e a autorização com o usuário no Admin Console." },
    { rule: "email_routing_change", matches: (event: WorkspaceSecurityEvent) => event.source === "admin" && /^(create_gmail_setting|change_gmail_setting|change_email_setting)$/.test(event.type.toLowerCase()) && /forward|routing|delegate/.test(String(parameter(event, "setting_name") ?? "").toLowerCase()), title: "Alteração de roteamento ou delegação de e-mail", description: "Uma configuração de roteamento, encaminhamento ou delegação foi criada ou alterada. Ela pode mudar o destino ou o acesso às mensagens. Revise a regra, os destinatários e a aprovação da mudança no Admin Console." },
    { rule: "authentication_policy_weakened", matches: (event: WorkspaceSecurityEvent) => event.source === "admin" && event.type.toUpperCase() === "ENFORCE_STRONG_AUTHENTICATION" && /^(false|off|disabled)$/.test(String(parameter(event, "new_value") ?? "").toLowerCase()), title: "Exigência de autenticação forte reduzida", description: "A exigência de autenticação forte foi desativada para um escopo do domínio. Revise a unidade ou grupo afetado e confirme se a alteração foi autorizada antes de restaurar a proteção." },
    { rule: "oauth_trust_expanded", matches: (event: WorkspaceSecurityEvent) => event.source === "admin" && /^(TRUST_DOMAIN_OWNED_OAUTH2_APPS|MULTIPLE_ADD_TO_TRUSTED_OAUTH2_APPS|MULTIPLE_ADD_TO_TRUSTED_BY_OAUTH_SCOPE_OAUTH2_APPS)$/.test(event.type.toUpperCase()), title: "Confiança em aplicativos OAuth ampliada", description: "Aplicativos foram considerados confiáveis por uma alteração administrativa, ampliando possibilidades de acesso. Revise os aplicativos, os escopos e a autorização da mudança no Admin Console." },
    { rule: "suspicious_login", matches: (event: WorkspaceSecurityEvent) => (event.source === "login" && /login|suspicious/.test(event.type.toLowerCase()) && (event.severity === "high" || event.severity === "critical")) || (event.source === "alert_center" && /suspicious[ _](programmatic[ _])?login|account[ _]takeover|leaked[ _]password/.test(event.type.toLowerCase())), title: "Login suspeito requer investigação", description: "O Google sinalizou risco de acesso à conta. Confirme com o usuário o horário e a origem de rede; investigue acessos não reconhecidos no Admin Console." },
    { rule: "data_exfiltration", matches: (event: WorkspaceSecurityEvent) => (event.source === "alert_center" || event.source === "rules" || event.source === "drive") && /exfiltrat|data[ _]export|takeout/.test(event.type.toLowerCase()), title: "Possível extração de dados", description: "Foi registrado um sinal de extração ou exportação de dados. Verifique a autorização, os recursos afetados e o contexto no Admin Console; o evento isolado não confirma vazamento." },
    { rule: "two_step_verification_disabled", matches: (event: WorkspaceSecurityEvent) => event.source === "login" && /^(2sv_disable|2_step_verification_disable)$/.test(event.type.toLowerCase()), title: "Verificação em duas etapas desativada", description: "Uma conta teve a verificação em duas etapas desativada. Revise com o usuário se a alteração foi autorizada e se a proteção precisa ser restaurada." },
    { rule: "privilege_escalation", matches: (event: WorkspaceSecurityEvent) => event.source === "admin" && /^(assign_role|grant_admin_privilege|grant_admin_privileges)$/.test(event.type.toLowerCase()), title: "Alteração de privilégio administrativo", description: "Uma função ou privilégio administrativo foi concedido. Revise o usuário beneficiado, a função e a aprovação da mudança no Admin Console." },
    { rule: "external_drive_sharing", matches: (event: WorkspaceSecurityEvent) => event.source === "drive" && (event.type.toLowerCase().includes("external_share") || (/change_user_access|change_document_visibility/.test(event.type.toLowerCase()) && /external|public/.test(String(event.metadata.visibility || "").toLowerCase()))), title: "Compartilhamento externo no Drive", description: "Um recurso do Drive foi exposto externamente ou publicamente. Revise o arquivo, os destinatários e se esse compartilhamento foi autorizado." },
    { rule: "high_severity_dlp", matches: (event: WorkspaceSecurityEvent) => event.source === "rules" && (event.severity === "high" || event.severity === "critical"), title: "Regra de proteção de dados acionada", description: "Uma regra de proteção de dados de alta severidade foi acionada. Revise a política, os recursos afetados e o resultado da ação no Admin Console." },
  ] as const;
  for (const definition of singleSignalRules) {
    for (const signal of recentEvents.filter(definition.matches)) {
      const subject = signal.actor ?? signal.target ?? "workspace";
      findings.push({ id: findingId(definition.rule, ["suspicious_login", "data_exfiltration", "sensitive_oauth_grant", "email_routing_change", "authentication_policy_weakened", "oauth_trust_expanded"].includes(definition.rule) ? `${subject}:${signal.id}` : subject, signal.occurredAt), rule: definition.rule, severity: signal.severity === "critical" ? "critical" : "high", title: definition.title, description: definition.description, subjects: subject === "workspace" ? [] : [subject], ipAddresses: unique([signal.ipAddress]), eventIds: [signal.id], firstOccurredAt: signal.occurredAt, lastOccurredAt: signal.occurredAt, evidenceCount: 1, expiresAt: signal.expiresAt });
    }
  }

  for (const actor of unique(recentEvents.filter((event) => event.source === "drive" && event.type.toLowerCase() === "download").map((event) => event.actor))) {
    const downloads = [...new Map(recentEvents.filter((event) => event.source === "drive" && event.type.toLowerCase() === "download" && event.actor === actor).map((event) => [event.id, event])).values()];
    let start = 0;
    for (let end = 0; end < downloads.length; end++) {
      while (downloads[end]!.occurredAt.getTime() - downloads[start]!.occurredAt.getTime() > 30 * 60_000) start++;
      // shortcut: limite fixo de 20 downloads em 30 minutos; calibrar com o uso real se houver excesso de alertas.
      if (end - start + 1 < 20) continue;
      const evidence = downloads.slice(start, end + 1);
      findings.push({
        id: findingId("bulk_drive_download", actor, evidence[0]!.occurredAt), rule: "bulk_drive_download", severity: "high",
        title: "Volume elevado de downloads no Drive", description: "Foram registrados pelo menos 20 downloads em 30 minutos para a mesma conta. Pode ser uma atividade legítima ou extração de dados. Revise os arquivos e confirme a operação com o usuário.",
        subjects: [actor], ipAddresses: unique(evidence.map((event) => event.ipAddress)), eventIds: evidence.map((event) => event.id),
        firstOccurredAt: evidence[0]!.occurredAt, lastOccurredAt: evidence.at(-1)!.occurredAt, evidenceCount: evidence.length,
        expiresAt: new Date(Math.min(...evidence.map((event) => event.expiresAt.getTime()))),
      });
      break;
    }
  }
  return findings;
}
