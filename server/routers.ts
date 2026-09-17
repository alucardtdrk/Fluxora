import { authConfigured, clearSessionCookie } from "./auth.js";
import { adminProcedure, operatorProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc.js";
import { getN8nAnalytics, getN8nExecutionDetail, getN8nOverview, listN8nExecutions, listN8nExecutionsPage, listN8nWorkflows, preserveN8nExecutionDetails, setN8nWorkflowActive, syncN8nArchive } from "./n8n.js";
import { archiveConfigured, getArchiveDiagnostics, getArchiveSyncState, type ArchiveSyncState } from "./firestoreLogs.js";
import { deleteFluxoraUser, listFluxoraUsers, setFluxoraUserActive, upsertFluxoraUser } from "./access.js";
import { isFirestoreConfigured } from "./firestore.js";
import { getN8nWorkflowDetail, restoreN8nWorkflowVersion, updateN8nWorkflowNode } from "./workflowEditor.js";
import { getNotificationReadState, saveNotificationReadState } from "./notificationState.js";
import { listWorkflowAlertRules, listWorkflowRunbooks, listWorkflowSlos, saveWorkflowAlertRule, saveWorkflowRunbook, saveWorkflowSlo, updateIncidentState } from "./observability.js";
import { z } from "zod";
import { listAuditEvents, recordAuditEventSafe, type AuditEventInput } from "./audit.js";

const periodSchema = z.enum(["today", "7d", "30d", "90d", "all"]);
const roleSchema = z.enum(["admin", "operator", "viewer"]);

async function audited<T>(event: AuditEventInput, operation: () => Promise<T>) {
  try {
    const result = await operation();
    const resultStatus = result && typeof result === "object" && "status" in result ? String((result as { status?: unknown }).status || "ok") : "ok";
    const failureReason = resultStatus === "error" && result && typeof result === "object" && "message" in result ? String((result as { message?: unknown }).message || "A ação não foi concluída") : event.reason;
    await recordAuditEventSafe({ ...event, status: resultStatus === "error" ? "failure" : "success", reason: failureReason, metadata: { ...event.metadata, resultStatus } });
    return result;
  } catch (error) {
    await recordAuditEventSafe({ ...event, status: "failure", reason: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export const appRouter = router({
  auth: router({
    me: publicProcedure.query(({ ctx }) => ctx.user),
    status: publicProcedure.query(() => ({ configured: authConfigured(), provider: "google" as const })),
    logout: publicProcedure.mutation(({ ctx }) => { clearSessionCookie(ctx.res); return { success: true } as const; }),
  }),
  notifications: router({
    readState: protectedProcedure.query(({ ctx }) => getNotificationReadState(ctx.user.email)),
    markRead: protectedProcedure
      .input(z.object({ executionIds: z.array(z.string().min(1)).max(250) }))
      .mutation(({ input, ctx }) => saveNotificationReadState(ctx.user.email, input.executionIds)),
  }),
  n8n: router({
    overview: protectedProcedure.input(z.object({ period: periodSchema.default("7d"), workflowIds: z.array(z.string()).default([]), inactiveHours: z.number().int().min(1).max(168).default(24) })).query(({ input }) => getN8nOverview(input.period, input.workflowIds, input.inactiveHours)),
    workflows: protectedProcedure.query(() => listN8nWorkflows()),
    workflowDetail: protectedProcedure.input(z.object({ id: z.string().min(1) })).query(({ input }) => getN8nWorkflowDetail(input.id)),
    executions: protectedProcedure.query(() => listN8nExecutions()),
    executionsPage: protectedProcedure.input(z.object({
      page: z.number().int().min(1).default(1), pageSize: z.number().int().min(10).max(100).default(50), period: periodSchema.default("30d"),
      search: z.string().max(120).optional(), status: z.string().max(30).optional(), workflowId: z.string().max(120).optional(), sectionName: z.string().max(160).optional(),
    })).query(({ input }) => listN8nExecutionsPage(input)),
    executionDetail: protectedProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ input, ctx }) => {
      const result = await getN8nExecutionDetail(input.id);
      await recordAuditEventSafe({ action: "execution.details_view", category: "data", actor: ctx.user.email, actorRole: ctx.user.role, targetType: "execution", targetId: input.id, summary: `Consultou os detalhes técnicos da execução #${input.id}` });
      return result;
    }),
    analytics: protectedProcedure.input(z.object({ period: periodSchema.default("7d") })).query(({ input }) => getN8nAnalytics(input.period)),
    slos: protectedProcedure.query(() => listWorkflowSlos()),
    saveSlo: adminProcedure.input(z.object({ workflowId: z.string().min(1), workflowName: z.string().max(160).optional(), enabled: z.boolean(), successRateTarget: z.number().min(0).max(100), p95TargetSeconds: z.number().positive().max(86400) })).mutation(({ input, ctx }) => audited({ action: "slo.save", category: "configuration", actor: ctx.user.email, actorRole: ctx.user.role, targetType: "workflow", targetId: input.workflowId, targetName: input.workflowName, summary: `Atualizou a meta operacional de ${input.workflowName || input.workflowId}`, after: input }, () => saveWorkflowSlo(input, ctx.user.email))),
    runbooks: protectedProcedure.query(() => listWorkflowRunbooks()),
    saveRunbook: adminProcedure.input(z.object({ workflowId: z.string().min(1), workflowName: z.string().max(160).optional(), owner: z.string().max(160).nullable().optional(), url: z.string().url().max(500).nullable().optional(), instructions: z.string().max(4000).nullable().optional() })).mutation(({ input, ctx }) => audited({ action: "runbook.save", category: "configuration", actor: ctx.user.email, actorRole: ctx.user.role, targetType: "workflow", targetId: input.workflowId, targetName: input.workflowName, summary: `Atualizou o plano de resposta de ${input.workflowName || input.workflowId}`, after: { owner: input.owner, url: input.url, hasInstructions: Boolean(input.instructions) } }, () => saveWorkflowRunbook(input, ctx.user.email))),
    alertRules: protectedProcedure.query(() => listWorkflowAlertRules()),
    saveAlertRule: adminProcedure.input(z.object({ workflowId: z.string().min(1), workflowName: z.string().max(160).optional(), enabled: z.boolean(), failureRateThreshold: z.number().min(0).max(100), consecutiveFailures: z.number().int().min(1).max(100), inactivityHours: z.number().min(1).max(8760), severity: z.enum(["critical", "high", "medium", "low"]) })).mutation(({ input, ctx }) => audited({ action: "alert_rule.save", category: "configuration", actor: ctx.user.email, actorRole: ctx.user.role, targetType: "workflow", targetId: input.workflowId, targetName: input.workflowName, summary: `Atualizou os alertas de ${input.workflowName || input.workflowId}`, after: input }, () => saveWorkflowAlertRule(input, ctx.user.email))),
    updateIncident: operatorProcedure.input(z.object({ fingerprint: z.string().min(1), firstOccurredAt: z.string().datetime().nullable().optional(), status: z.enum(["new", "acknowledged", "investigating", "resolved"]), severity: z.enum(["critical", "high", "medium", "low"]), owner: z.string().max(160).nullable().optional(), silencedUntil: z.string().datetime().nullable().optional(), note: z.string().max(1000).nullable().optional() })).mutation(({ input, ctx }) => audited({ action: "incident.update", category: "incident", actor: ctx.user.email, actorRole: ctx.user.role, targetType: "incident", targetId: input.fingerprint, summary: `Alterou o incidente para ${input.status}`, after: { status: input.status, severity: input.severity, owner: input.owner, silencedUntil: input.silencedUntil, hasNote: Boolean(input.note) } }, () => updateIncidentState(input, ctx.user.email))),
    archiveStatus: protectedProcedure.query(async () => ({ configured: archiveConfigured(), state: archiveConfigured() ? await getArchiveSyncState() : null })),
    syncArchive: adminProcedure.mutation(({ ctx }) => audited({ action: "history.sync", category: "history", actor: ctx.user.email, actorRole: ctx.user.role, targetType: "history", summary: "Executou a sincronização do histórico principal" }, () => syncN8nArchive({ recentPages: 1, backfillPages: 2, hydrateDetails: false, trigger: "manual" }))),
    preserveExecutionDetails: adminProcedure.input(z.object({ batchSize: z.number().int().min(1).max(300).optional() }).optional()).mutation(({ input, ctx }) => audited({ action: "history.details_preserve", category: "history", actor: ctx.user.email, actorRole: ctx.user.role, targetType: "execution_details", summary: "Preservou o próximo lote de nodes e respostas", after: { batchSize: input?.batchSize ?? 300 } }, () => preserveN8nExecutionDetails(input?.batchSize))),
    toggleWorkflow: operatorProcedure.input(z.object({ id: z.string().min(1), active: z.boolean() })).mutation(({ input, ctx }) => audited({ action: "workflow.toggle", category: "workflow", actor: ctx.user.email, actorRole: ctx.user.role, targetType: "workflow", targetId: input.id, summary: `${input.active ? "Ativou" : "Desativou"} o workflow ${input.id}`, before: { active: !input.active }, after: { active: input.active } }, () => setN8nWorkflowActive(input.id, input.active))),
    updateWorkflowNode: operatorProcedure.input(z.object({
      workflowId: z.string().min(1),
      nodeName: z.string().min(1),
      changes: z.array(z.object({ path: z.string().min(1), value: z.unknown() })).max(80).optional(),
      additions: z.array(z.object({ path: z.string().min(1), kind: z.enum(["condition", "header"]), value: z.record(z.string(), z.unknown()) })).max(20).optional(),
      parameters: z.record(z.string(), z.unknown()).optional(),
      summary: z.string().trim().max(240).optional(),
    }).refine((input) => Boolean(input.parameters) || Boolean(input.changes?.length) || Boolean(input.additions?.length), { message: "Informe ao menos uma alteracao." })).mutation(({ input, ctx }) => audited({ action: "workflow.node_update", category: "workflow", actor: ctx.user.email, actorRole: ctx.user.role, targetType: "node", targetId: input.workflowId, targetName: input.nodeName, summary: `Editou o node ${input.nodeName}`, metadata: { changedPaths: input.changes?.map((item) => item.path) ?? [], addedPaths: input.additions?.map((item) => item.path) ?? [], summary: input.summary } }, () => updateN8nWorkflowNode(input, { email: ctx.user.email, role: ctx.user.role }))),
    restoreWorkflowVersion: adminProcedure.input(z.object({ workflowId: z.string().min(1), snapshotId: z.string().min(1) })).mutation(({ input, ctx }) => audited({ action: "workflow.restore", category: "workflow", actor: ctx.user.email, actorRole: ctx.user.role, targetType: "workflow", targetId: input.workflowId, summary: `Restaurou uma versão anterior do workflow ${input.workflowId}`, metadata: { snapshotId: input.snapshotId } }, () => restoreN8nWorkflowVersion(input.workflowId, input.snapshotId, { email: ctx.user.email, role: ctx.user.role }))),
  }),
  audit: router({
    list: adminProcedure.input(z.object({ period: periodSchema.default("30d"), category: z.enum(["workflow", "incident", "configuration", "access", "history", "data"]).optional(), status: z.enum(["success", "failure"]).optional(), search: z.string().max(160).optional() })).query(({ input }) => listAuditEvents(input)),
  }),
  admin: router({
    users: adminProcedure.query(() => listFluxoraUsers()),
    saveUser: adminProcedure.input(z.object({ email: z.string().email(), name: z.string().max(120).optional(), role: roleSchema, active: z.boolean().default(true) })).mutation(({ input, ctx }) => audited({ action: "user.save", category: "access", actor: ctx.user.email, actorRole: ctx.user.role, targetType: "user", targetId: input.email, targetName: input.name, summary: `Criou ou atualizou o acesso de ${input.email}`, after: input }, () => upsertFluxoraUser({ ...input, actor: ctx.user.email }))),
    setUserActive: adminProcedure.input(z.object({ email: z.string().email(), active: z.boolean() })).mutation(({ input, ctx }) => audited({ action: "user.status", category: "access", actor: ctx.user.email, actorRole: ctx.user.role, targetType: "user", targetId: input.email, summary: `${input.active ? "Ativou" : "Bloqueou"} o acesso de ${input.email}`, after: { active: input.active } }, () => setFluxoraUserActive(input.email, input.active, ctx.user.email))),
    deleteUser: adminProcedure.input(z.object({ email: z.string().email() })).mutation(({ input, ctx }) => audited({ action: "user.delete", category: "access", actor: ctx.user.email, actorRole: ctx.user.role, targetType: "user", targetId: input.email, summary: `Removeu o acesso de ${input.email}` }, () => deleteFluxoraUser(input.email))),
    systemStatus: adminProcedure.query(async () => {
      const archive = await getArchiveDiagnostics().catch((error) => ({ configured: archiveConfigured(), totalArchived: 0, state: { lastError: error instanceof Error ? error.message : String(error) } as ArchiveSyncState }));
      const workspaceConfigured = ["GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_WORKSPACE_PRIVATE_KEY", "GOOGLE_WORKSPACE_ADMIN_EMAIL", "GOOGLE_WORKSPACE_CUSTOMER_ID", "GOOGLE_WORKSPACE_DOMAIN"].every((key) => Boolean(String(process.env[key] || "").trim()));
      return { firestoreConfigured: isFirestoreConfigured(), archive, googleWorkspaceSecurity: { configured: workspaceConfigured } };
    }),
    testN8n: adminProcedure.query(async () => {
      const [overview, workflows] = await Promise.all([getN8nOverview("today", []), listN8nWorkflows()]);
      return { ok: Boolean(overview.connected && workflows.connected), workflows: workflows.items?.length ?? 0 };
    }),
    testFirestore: adminProcedure.query(async () => {
      const diagnostics = await getArchiveDiagnostics();
      return { ok: diagnostics.configured, totalArchived: diagnostics.totalArchived };
    }),
  }),
});

export type AppRouter = typeof appRouter;
