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

export function correlateWorkspaceSecurityEvents(events: readonly WorkspaceSecurityEvent[], now: Date): readonly WorkspaceSecurityFinding[] {
  const since = now.getTime() - CORRELATION_WINDOW_MS;
  const failures = events
    .filter((event) => event.occurredAt.getTime() >= since && event.source === "login" && event.type.toLowerCase().includes("failure") && event.actor)
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
  const findings: WorkspaceSecurityFinding[] = [];

  for (const actor of unique(failures.map((event) => event.actor))) {
    const actorFailures = failures.filter((event) => event.actor === actor);
    const window = actorFailures.filter((event) => event.occurredAt.getTime() - actorFailures[0]!.occurredAt.getTime() <= DISTRIBUTED_LOGIN_WINDOW_MS);
    const locations = unique(window.flatMap((event) => [event.ipAddress, event.country]));
    if (window.length < MIN_DISTRIBUTED_LOGIN_FAILURES || locations.length < 2) continue;

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

  const recentEvents = events.filter((event) => event.occurredAt.getTime() >= since);
  for (const actor of unique(recentEvents.map((event) => event.actor))) {
    const actorEvents = recentEvents.filter((event) => event.actor === actor);
    const suspiciousLogin = actorEvents.find((event) => event.source === "login" && (event.severity === "high" || event.severity === "critical"));
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

  for (const actor of unique(recentEvents.map((event) => event.actor))) {
    const actorEvents = recentEvents.filter((event) => event.actor === actor);
    const identityRisk = actorEvents.find((event) => event.source === "login" && (event.severity === "high" || event.severity === "critical"));
    if (!identityRisk) continue;

    const adminEvent = actorEvents.find((event) => event.source === "admin" && (event.severity === "high" || event.severity === "critical") && event.occurredAt >= identityRisk.occurredAt);
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

    const driveEvent = actorEvents.find((event) => event.source === "drive" && /change_user_access|change_document_visibility|external_share/.test(event.type.toLowerCase()) && (event.severity === "high" || event.severity === "critical") && event.occurredAt >= identityRisk.occurredAt);
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

  const singleSignalRules = [
    { rule: "two_step_verification_disabled", matches: (event: WorkspaceSecurityEvent) => event.source === "login" && event.type.toLowerCase().includes("2sv_disable"), title: "Verificação em duas etapas desativada", description: "Uma conta teve a verificação em duas etapas desativada." },
    { rule: "privilege_escalation", matches: (event: WorkspaceSecurityEvent) => event.source === "admin" && /assign.*role|role.*assign|privilege/.test(event.type.toLowerCase()), title: "Alteração de privilégio administrativo", description: "Uma função ou privilégio administrativo sensível foi alterado." },
    { rule: "external_drive_sharing", matches: (event: WorkspaceSecurityEvent) => event.source === "drive" && (event.type.toLowerCase().includes("external_share") || (/change_user_access|change_document_visibility/.test(event.type.toLowerCase()) && /external|public/.test(String(event.metadata.visibility || "").toLowerCase()))), title: "Compartilhamento externo no Drive", description: "Um recurso do Drive foi exposto externamente ou publicamente." },
    { rule: "high_severity_dlp", matches: (event: WorkspaceSecurityEvent) => event.source === "rules" && event.severity === "high", title: "Regra de proteção de dados acionada", description: "Uma regra de alta severidade foi acionada no Google Workspace." },
  ] as const;
  for (const definition of singleSignalRules) {
    for (const signal of recentEvents.filter(definition.matches)) {
      const subject = signal.actor ?? signal.target ?? "workspace";
      findings.push({ id: findingId(definition.rule, subject, signal.occurredAt), rule: definition.rule, severity: signal.severity === "critical" ? "critical" : "high", title: definition.title, description: definition.description, subjects: subject === "workspace" ? [] : [subject], ipAddresses: unique([signal.ipAddress]), eventIds: [signal.id], firstOccurredAt: signal.occurredAt, lastOccurredAt: signal.occurredAt, evidenceCount: 1, expiresAt: signal.expiresAt });
    }
  }

  return findings;
}
