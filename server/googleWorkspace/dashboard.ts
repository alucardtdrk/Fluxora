import { getFirestoreDocument, isFirestoreConfigured, runFirestoreQuery, type FirestoreRecord } from "../firestore.js";
import {
  WORKSPACE_DIRECTORY_POSTURE_COLLECTION,
  WORKSPACE_SECURITY_FINDINGS_COLLECTION,
  WORKSPACE_SECURITY_EVENTS_COLLECTION,
  WORKSPACE_SYNC_STATE_COLLECTION,
} from "./repository.js";
import type { SecuritySeverity, WorkspaceSecuritySource } from "./types.js";

export interface WorkspaceDashboardEvent {
  readonly id: string;
  readonly externalId?: string;
  readonly source: WorkspaceSecuritySource;
  readonly category: string;
  readonly type: string;
  readonly severity: SecuritySeverity;
  readonly title: string;
  readonly description: string;
  readonly occurredAt: string;
  readonly actor?: string;
  readonly target?: string;
  readonly ipAddress?: string;
  readonly country?: string;
  readonly details?: readonly { readonly label: string; readonly value: string }[];
  readonly safeDetails?: { readonly reporterEmail?: string; readonly suspectedSender?: string; readonly subject?: string; readonly affectedUsers?: readonly string[]; readonly indicatorUrls?: readonly string[]; readonly attachmentNames?: readonly string[] };
}

export interface WorkspaceSecurityDashboard {
  readonly events: readonly WorkspaceDashboardEvent[];
  readonly findings: readonly WorkspaceDashboardFinding[];
  readonly summary: { readonly recentEvents: number; readonly highOrCriticalEvents: number; readonly openFindings: number; readonly coveragePercent: number; readonly backfillPagesProcessed: number };
  readonly posture: { readonly suspendedUsers: number; readonly usersWithoutTwoStepVerification: number; readonly suspendedUserDetails: readonly WorkspacePostureUser[]; readonly usersWithoutTwoStepVerificationDetails: readonly WorkspacePostureUser[] } | null;
  readonly sources: readonly { readonly source: string; readonly status: string; readonly received: number; readonly collected: number; readonly persisted: number; readonly completedAt?: string; readonly safeError?: string; readonly httpStatus?: number; readonly coveragePercent: number; readonly backfillPagesProcessed: number; readonly rangeStart?: string; readonly rangeEnd?: string; readonly coveredThrough?: string }[];
}

export interface WorkspacePostureUser {
  readonly id: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly orgUnitPath?: string;
}

export interface WorkspaceDashboardFinding {
  readonly id: string;
  readonly rule: string;
  readonly severity: SecuritySeverity;
  readonly title: string;
  readonly description: string;
  readonly subjects: readonly string[];
  readonly ipAddresses: readonly string[];
  readonly eventIds: readonly string[];
  readonly firstOccurredAt: string;
  readonly lastOccurredAt: string;
  readonly evidenceCount: number;
}

type DashboardDependencies = {
  readonly listEvents: () => Promise<readonly FirestoreRecord[]>;
  readonly listFindings: () => Promise<readonly FirestoreRecord[]>;
  readonly getPosture: () => Promise<FirestoreRecord | null>;
  readonly listSources?: () => Promise<readonly FirestoreRecord[]>;
};

const EMPTY_DASHBOARD: WorkspaceSecurityDashboard = {
  events: [],
  findings: [],
  summary: { recentEvents: 0, highOrCriticalEvents: 0, openFindings: 0, coveragePercent: 0, backfillPagesProcessed: 0 },
  posture: null,
  sources: [],
};

function stringValue(value: unknown): string | undefined {
  const valueAsString = typeof value === "string" ? value.trim() : "";
  return valueAsString || undefined;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function dashboardFinding(record: FirestoreRecord): WorkspaceDashboardFinding | null {
  const id = stringValue(record.id) ?? stringValue(record._documentId);
  if (!id) return null;
  return { id, rule: String(record.rule || "unknown"), severity: String(record.severity || "high") as SecuritySeverity, title: String(record.title || "Achado de segurança"), description: String(record.description || ""), subjects: stringList(record.subjects), ipAddresses: stringList(record.ipAddresses), eventIds: stringList(record.eventIds), firstOccurredAt: dateValue(record.firstOccurredAt), lastOccurredAt: dateValue(record.lastOccurredAt), evidenceCount: Number(record.evidenceCount || 0) };
}

function dateValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value || ""));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date(0).toISOString();
}

function eventDetailValue(key: string, value: unknown): string | undefined {
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (key === "login_type" && value === "google_password") return "Senha do Google";
  if (key === "login_challenge_method") {
    try {
      const steps: unknown = JSON.parse(value);
      if (!Array.isArray(steps)) return undefined;
      const labels: Record<string, string> = { password: "Senha", device_prompt: "Confirmação no dispositivo" };
      return steps.filter((step): step is string => typeof step === "string" && Boolean(step.trim()))
        .map((step) => labels[step] ?? step).join(" → ").slice(0, 2_000) || undefined;
    } catch {
      return undefined;
    }
  }
  if (["triggered_actions", "matched_detectors", "resource_recipients", "recipients"].includes(key)) {
    try {
      const items: unknown = JSON.parse(value);
      if (!Array.isArray(items)) return undefined;
      const values = items.flatMap((item: unknown): string[] => {
        if (key === "resource_recipients" || key === "recipients") return typeof item === "string" ? [item] : [];
        if (!item || typeof item !== "object" || !("parameter" in item) || !Array.isArray(item.parameter)) return [];
        return item.parameter.flatMap((parameter: unknown): string[] => {
          if (!parameter || typeof parameter !== "object" || !("name" in parameter) || !("value" in parameter) || typeof parameter.value !== "string") return [];
          if (key === "triggered_actions" && parameter.name === "action_type") {
            return [parameter.value === "DRIVE_WARN_ON_EXTERNAL_SHARING" ? "Avisar sobre compartilhamento externo no Drive" : parameter.value];
          }
          return key === "matched_detectors" && parameter.name === "display_name" ? [parameter.value] : [];
        });
      });
      return [...new Set(values)].join(", ").slice(0, 2_000) || undefined;
    } catch {
      return undefined;
    }
  }
  return value.trim().slice(0, 2_000);
}

function dashboardEvent(record: FirestoreRecord): WorkspaceDashboardEvent {
  const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata as FirestoreRecord : {};
  const detailKeys: ReadonlyArray<[string, string]> = [["app_name", "Aplicativo"], ["client_name", "Aplicativo"], ["client_id", "ID do aplicativo"], ["scope", "Permissões"], ["scopes", "Permissões"], ["event_type", "Tipo de ação"], ["status", "Resultado"], ["failure_type", "Motivo da falha"], ["login_type", "Método de login"], ["role_name", "Função administrativa"], ["resource_name", "Recurso"], ["doc_title", "Documento"], ["visibility", "Visibilidade"], ["owner", "Proprietário"], ["user_email", "Usuário afetado"],
    ["is_suspicious", "Marcado como suspeito pelo Google"], ["login_challenge_method", "Etapas de autenticação registradas"],
    ["resource_title", "Documento"], ["resource_id", "ID do recurso"], ["doc_id", "ID do documento"], ["resource_type", "Tipo de recurso"],
    ["resource_owner_email", "Proprietário"], ["resource_recipients", "Destinatários"], ["recipients", "Destinatários"],
    ["rule_name", "Regra"], ["rule_type", "Tipo de regra"], ["rule_resource_name", "ID da regra"],
    ["data_source", "Fonte dos dados"], ["scan_type", "Tipo de verificação"], ["severity", "Severidade informada pela fonte"],
    ["triggered_actions", "Ações da regra"], ["matched_detectors", "Detectores correspondentes"],
    ["actor_email", "Responsável informado no evento"], ["target_user", "Usuário de destino"], ["target_user_email", "E-mail de destino"],
    ["group_email", "Grupo"], ["org_unit_name", "Unidade organizacional"], ["setting_name", "Configuração"],
    ["permission", "Permissão"],
    ["is_external", "Externo"], ["num_recipients", "Quantidade de destinatários"],
    ["message_id", "ID da mensagem"], ["subject", "Assunto"], ["sender", "Remetente"], ["recipient", "Destinatário"],
    ["calendar_id", "ID da agenda"], ["event_id", "ID do evento"], ["event_title", "Título do evento"],
    ["meeting_code", "Código da reunião"], ["conference_id", "ID da conferência"],
    ["device_id", "ID do dispositivo"], ["device_type", "Tipo de dispositivo"], ["device_model", "Modelo do dispositivo"],
  ];
  const details = detailKeys.flatMap(([key, label]) => {
    const value = eventDetailValue(key, metadata[key]);
    return value ? [{ label, value }] : [];
  });
  const safe = record.safeDetails && typeof record.safeDetails === "object" ? record.safeDetails as FirestoreRecord : null;
  const safeDetails = safe ? {
    reporterEmail: stringValue(safe.reporterEmail), suspectedSender: stringValue(safe.suspectedSender), subject: stringValue(safe.subject),
    affectedUsers: stringList(safe.affectedUsers).slice(0, 20), indicatorUrls: stringList(safe.indicatorUrls).slice(0, 20), attachmentNames: stringList(safe.attachmentNames).slice(0, 20),
  } : undefined;
  return {
    id: stringValue(record.id) ?? stringValue(record._documentId) ?? "",
    externalId: stringValue(record.externalId),
    source: String(record.source || "alert_center") as WorkspaceSecuritySource,
    category: String(record.category || "workspace_security"),
    type: String(record.type || "unknown"),
    severity: record.source === "drive" && record.type === "access_item_content" ? "informational" : String(record.severity || "informational") as SecuritySeverity,
    title: String(record.title || "Evento do Google Workspace"),
    description: String(record.description || ""),
    occurredAt: dateValue(record.occurredAt),
    actor: stringValue(record.actor),
    target: stringValue(record.target),
    ipAddress: stringValue(record.ipAddress),
    country: stringValue(record.country),
    details,
    safeDetails,
  };
}

function dashboardPosture(record: FirestoreRecord | null): WorkspaceSecurityDashboard["posture"] {
  if (!record) return null;
  const users = record.users as FirestoreRecord | undefined;
  return {
    suspendedUsers: Number(users?.suspended || 0),
    usersWithoutTwoStepVerification: Number(users?.withoutTwoStepVerification || 0),
    suspendedUserDetails: postureUsers(record.suspendedUsers),
    usersWithoutTwoStepVerificationDetails: postureUsers(record.withoutTwoStepVerificationUsers),
  };
}

function coverage(record: FirestoreRecord) {
  const start = record.backfillTargetStart ? new Date(dateValue(record.backfillTargetStart)) : null;
  const end = record.backfillTargetEnd ? new Date(dateValue(record.backfillTargetEnd)) : null;
  const covered = record.backfillCoveredThrough ? new Date(dateValue(record.backfillCoveredThrough)) : null;
  if (!start || !end || !covered || end <= start) return { coveragePercent: 0 };
  const coveragePercent = Math.max(0, Math.min(100, Math.round(((covered.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100)));
  return { coveragePercent, rangeStart: start.toISOString(), rangeEnd: end.toISOString(), coveredThrough: covered.toISOString() };
}

function postureUsers(value: unknown): readonly WorkspacePostureUser[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as FirestoreRecord;
    const id = stringValue(record.id);
    return id ? [{ id, email: stringValue(record.email), displayName: stringValue(record.displayName), orgUnitPath: stringValue(record.orgUnitPath) }] : [];
  });
}

export function createWorkspaceSecurityDashboard(dependencies: DashboardDependencies) {
  return {
    async load(): Promise<WorkspaceSecurityDashboard> {
      const [records, findingRecords, posture, sourceRecords] = await Promise.all([dependencies.listEvents(), dependencies.listFindings(), dependencies.getPosture(), dependencies.listSources?.() ?? []]);
      const events = records.map(dashboardEvent).filter((event) => Boolean(event.id));
      const findings = findingRecords.map(dashboardFinding).filter((finding): finding is WorkspaceDashboardFinding => Boolean(finding));
      const sources = sourceRecords.map((record) => ({ source: String(record.source || record._documentId || "unknown"), status: String(record.lastStatus || "unknown"), received: Number(record.lastReceived ?? record.lastCollected ?? 0), collected: Number(record.lastCollected || 0), persisted: Number(record.lastPersisted || 0), httpStatus: record.lastHttpStatus ? Number(record.lastHttpStatus) : undefined, completedAt: record.lastCompletedAt ? dateValue(record.lastCompletedAt) : undefined, safeError: stringValue(record.lastSafeError), backfillPagesProcessed: Number(record.backfillPagesProcessed || 0), ...coverage(record) }));
      return {
        events,
        findings,
        summary: {
          recentEvents: events.length,
          highOrCriticalEvents: events.filter((event) => event.severity === "high" || event.severity === "critical").length,
          openFindings: findings.length,
          coveragePercent: sources.length ? Math.round(sources.reduce((total, source) => total + source.coveragePercent, 0) / sources.length) : 0,
          backfillPagesProcessed: sources.reduce((total, source) => total + source.backfillPagesProcessed, 0),
        },
        posture: dashboardPosture(posture),
        sources,
      };
    },
  };
}

async function listWorkspaceSourceStates(): Promise<readonly FirestoreRecord[]> {
  return runFirestoreQuery({ from: [{ collectionId: WORKSPACE_SYNC_STATE_COLLECTION }], limit: 20 });
}

async function listWorkspaceFindings(): Promise<readonly FirestoreRecord[]> {
  return runFirestoreQuery({ from: [{ collectionId: WORKSPACE_SECURITY_FINDINGS_COLLECTION }], orderBy: [{ field: { fieldPath: "lastOccurredAt" }, direction: "DESCENDING" }], limit: 100 });
}

async function listWorkspaceEvents(): Promise<readonly FirestoreRecord[]> {
  return runFirestoreQuery({
    select: { fields: ["externalId", "source", "category", "type", "severity", "title", "description", "occurredAt", "actor", "target", "ipAddress", "country"].map((fieldPath) => ({ fieldPath })) },
    from: [{ collectionId: WORKSPACE_SECURITY_EVENTS_COLLECTION }],
    orderBy: [{ field: { fieldPath: "occurredAt" }, direction: "DESCENDING" }],
    limit: 250,
  });
}

export async function createWorkspaceEventPage(
  input: { offset: number; pageSize?: number; source?: string; severity?: string; category?: string; periodDays?: number },
  listBatch: (offset: number, limit: number) => Promise<readonly FirestoreRecord[]>,
): Promise<{ events: readonly WorkspaceDashboardEvent[]; nextOffset: number | null }> {
  const pageSize = Math.min(Math.max(input.pageSize ?? 25, 1), 50);
  const events: WorkspaceDashboardEvent[] = [];
  let offset = input.offset;
  const cutoff = input.periodDays ? Date.now() - input.periodDays * 86_400_000 : 0;
  for (let batch = 0; batch < 5; batch++) {
    const records = await listBatch(offset, 100);
    const batchEnd = offset + records.length;
    for (const record of records) {
      offset++;
      const event = dashboardEvent(record);
      if ((input.source && event.source !== input.source) || (input.severity && event.severity !== input.severity) || (input.category && event.category !== input.category) || new Date(event.occurredAt).getTime() < cutoff) continue;
      events.push(event);
      if (events.length === pageSize) return { events, nextOffset: offset < batchEnd || records.length === 100 ? offset : null };
    }
    if (records.length < 100) return { events, nextOffset: null };
  }
  return { events, nextOffset: offset };
}

export async function getWorkspaceEventPage(input: { offset: number; source?: string; severity?: string; category?: string; periodDays?: number }) {
  if (!isFirestoreConfigured()) return { events: [], nextOffset: null };
  return createWorkspaceEventPage(input, (offset, limit) => runFirestoreQuery({
    select: { fields: ["externalId", "source", "category", "type", "severity", "title", "description", "occurredAt", "actor", "target", "ipAddress", "country", "metadata", "safeDetails"].map((fieldPath) => ({ fieldPath })) },
    from: [{ collectionId: WORKSPACE_SECURITY_EVENTS_COLLECTION }],
    orderBy: [{ field: { fieldPath: "occurredAt" }, direction: "DESCENDING" }],
    offset,
    limit,
  }));
}

export async function getWorkspaceEvent(id: string, getDocument: (collection: string, id: string) => Promise<FirestoreRecord | null> = getFirestoreDocument): Promise<WorkspaceDashboardEvent | null> {
  const record = await getDocument(WORKSPACE_SECURITY_EVENTS_COLLECTION, id);
  return record ? dashboardEvent({ ...record, id }) : null;
}

export async function getWorkspaceSecurityDashboard(): Promise<WorkspaceSecurityDashboard> {
  if (!isFirestoreConfigured()) return EMPTY_DASHBOARD;
  return createWorkspaceSecurityDashboard({
    listEvents: listWorkspaceEvents,
    listFindings: listWorkspaceFindings,
    getPosture: () => getFirestoreDocument(WORKSPACE_DIRECTORY_POSTURE_COLLECTION, "current"),
    listSources: listWorkspaceSourceStates,
  }).load();
}
