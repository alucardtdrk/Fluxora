import { authConfigured, clearSessionCookie } from "./auth.js";
import { adminProcedure, operatorProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc.js";
import { getN8nAnalytics, getN8nExecutionDetail, getN8nOverview, listN8nExecutions, listN8nWorkflows, setN8nWorkflowActive, syncN8nArchive } from "./n8n.js";
import { archiveConfigured, getArchiveDiagnostics, getArchiveSyncState } from "./firestoreLogs.js";
import { deleteFluxoraUser, listFluxoraUsers, setFluxoraUserActive, upsertFluxoraUser } from "./access.js";
import { isFirestoreConfigured } from "./firestore.js";
import { z } from "zod";

const periodSchema = z.enum(["today", "7d", "30d", "90d", "all"]);
const roleSchema = z.enum(["admin", "operator", "viewer"]);

export const appRouter = router({
  auth: router({
    me: publicProcedure.query(({ ctx }) => ctx.user),
    status: publicProcedure.query(() => ({ configured: authConfigured(), provider: "google" as const })),
    logout: publicProcedure.mutation(({ ctx }) => { clearSessionCookie(ctx.res); return { success: true } as const; }),
  }),
  n8n: router({
    overview: protectedProcedure.input(z.object({ period: periodSchema.default("7d"), workflowIds: z.array(z.string()).default([]), inactiveHours: z.number().int().min(1).max(168).default(24) })).query(({ input }) => getN8nOverview(input.period, input.workflowIds, input.inactiveHours)),
    workflows: protectedProcedure.query(() => listN8nWorkflows()),
    executions: protectedProcedure.query(() => listN8nExecutions()),
    executionDetail: protectedProcedure.input(z.object({ id: z.string().min(1) })).query(({ input }) => getN8nExecutionDetail(input.id)),
    analytics: protectedProcedure.input(z.object({ period: periodSchema.default("7d") })).query(({ input }) => getN8nAnalytics(input.period)),
    archiveStatus: protectedProcedure.query(async () => ({ configured: archiveConfigured(), state: archiveConfigured() ? await getArchiveSyncState() : null })),
    syncArchive: adminProcedure.mutation(() => syncN8nArchive()),
    toggleWorkflow: operatorProcedure.input(z.object({ id: z.string().min(1), active: z.boolean() })).mutation(({ input }) => setN8nWorkflowActive(input.id, input.active)),
  }),
  admin: router({
    users: adminProcedure.query(() => listFluxoraUsers()),
    saveUser: adminProcedure.input(z.object({ email: z.string().email(), name: z.string().max(120).optional(), role: roleSchema, active: z.boolean().default(true) })).mutation(({ input, ctx }) => upsertFluxoraUser({ ...input, actor: ctx.user.email })),
    setUserActive: adminProcedure.input(z.object({ email: z.string().email(), active: z.boolean() })).mutation(({ input, ctx }) => setFluxoraUserActive(input.email, input.active, ctx.user.email)),
    deleteUser: adminProcedure.input(z.object({ email: z.string().email() })).mutation(({ input }) => deleteFluxoraUser(input.email)),
    systemStatus: adminProcedure.query(async () => {
      const archive = await getArchiveDiagnostics().catch((error) => ({ configured: archiveConfigured(), totalArchived: 0, state: { lastError: error instanceof Error ? error.message : String(error) } }));
      return { firestoreConfigured: isFirestoreConfigured(), archive };
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
