import { useMemo, useState } from "react";
import { Bell, DatabaseZap, Settings2, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import OperationsShell from "@/components/OperationsShell";
import HistoryBackupPanel from "@/components/HistoryBackupPanel";
import WorkflowSloManager from "@/components/WorkflowSloManager";
import WorkflowRunbookManager from "@/components/WorkflowRunbookManager";
import WorkflowAlertRulesManager from "@/components/WorkflowAlertRulesManager";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { broadcastPreferencesUpdated, PREFERENCE_SCOPES, readDefaultPeriod, readPreferredPageSize, readPreferredRefreshSeconds, rememberFiltersEnabled, type DashboardPeriod } from "@/lib/preferences";
import { trpc } from "@/lib/trpc";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { sourceLabels } from "@/lib/workspaceSecurityRefresh";

export default function Settings() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [activeTab, setActiveTab] = useState("general");
  const overview = trpc.n8n.overview.useQuery({ period: "7d", workflowIds: [] }, { retry: false });
  const system = trpc.admin.systemStatus.useQuery(undefined, { retry: false, staleTime: 300_000 });
  const [notifications, setNotifications] = useState(() => localStorage.getItem("notificationsEnabled") !== "false");
  const [refreshInterval, setRefreshInterval] = useState(() => String(readPreferredRefreshSeconds()));
  const [defaultPeriod, setDefaultPeriod] = useState(() => readDefaultPeriod());
  const [pageSize, setPageSize] = useState(() => String(readPreferredPageSize(50)));
  const [rememberFilters, setRememberFilters] = useState(() => rememberFiltersEnabled());
  const [errorThreshold, setErrorThreshold] = useState(() => localStorage.getItem("fluxoraErrorThreshold") || "5");
  const [inactiveHours, setInactiveHours] = useState(() => localStorage.getItem("fluxoraInactiveHours") || "24");
  const [savingSettings, setSavingSettings] = useState(false);
  const [syncingHistory, setSyncingHistory] = useState(false);
  const [syncProgress, setSyncProgress] = useState("");
  const [refreshingHistory, setRefreshingHistory] = useState(false);

  const sync = trpc.n8n.syncArchive.useMutation();
  const preserveDetails = trpc.n8n.preserveExecutionDetails.useMutation();
  const testN8n = trpc.admin.testN8n.useQuery(undefined, { enabled: false, retry: false });
  const testGoogleWorkspace = trpc.admin.testGoogleWorkspace.useQuery(undefined, { enabled: false, retry: false, refetchOnWindowFocus: false });
  const testFirestore = trpc.admin.testFirestore.useQuery(undefined, { enabled: false, retry: false });

  const securityDashboard = trpc.workspaceSecurity.overview.useQuery(undefined, { enabled: user?.role === "admin", retry: false, staleTime: 300_000 });
  const securitySources = securityDashboard.data?.sources ?? [];
  const archive = system.data?.archive;

  const storedNotifications = localStorage.getItem("notificationsEnabled") !== "false";
  const storedRefreshInterval = String(readPreferredRefreshSeconds());
  const storedDefaultPeriod = readDefaultPeriod();
  const storedPageSize = String(readPreferredPageSize(50));
  const storedRememberFilters = rememberFiltersEnabled();
  const storedErrorThreshold = localStorage.getItem("fluxoraErrorThreshold") || "5";
  const storedInactiveHours = localStorage.getItem("fluxoraInactiveHours") || "24";

  const hasChanges = useMemo(() => (
    notifications !== storedNotifications
    || refreshInterval !== storedRefreshInterval
    || defaultPeriod !== storedDefaultPeriod
    || pageSize !== storedPageSize
    || rememberFilters !== storedRememberFilters
    || errorThreshold !== storedErrorThreshold
    || inactiveHours !== storedInactiveHours
  ), [
    notifications,
    storedNotifications,
    refreshInterval,
    storedRefreshInterval,
    defaultPeriod,
    storedDefaultPeriod,
    pageSize,
    storedPageSize,
    rememberFilters,
    storedRememberFilters,
    errorThreshold,
    storedErrorThreshold,
    inactiveHours,
    storedInactiveHours,
  ]);

  const restoreDraft = () => {
    setNotifications(storedNotifications);
    setRefreshInterval(storedRefreshInterval);
    setDefaultPeriod(storedDefaultPeriod);
    setPageSize(storedPageSize);
    setRememberFilters(storedRememberFilters);
    setErrorThreshold(storedErrorThreshold);
    setInactiveHours(storedInactiveHours);
  };

  const saveSettings = async () => {
    if (savingSettings) return;
    setSavingSettings(true);
    try {
    localStorage.setItem("notificationsEnabled", String(notifications));
    localStorage.setItem("preferredRefreshInterval", refreshInterval);
    localStorage.setItem("fluxoraDefaultPeriod", defaultPeriod);
    localStorage.setItem("fluxoraPageSize", pageSize);
    localStorage.setItem("fluxoraRememberFilters", String(rememberFilters));
    localStorage.setItem("fluxoraErrorThreshold", errorThreshold);
    localStorage.setItem("fluxoraInactiveHours", inactiveHours);

    if (rememberFilters) {
      for (const scope of PREFERENCE_SCOPES) localStorage.setItem(`fluxoraPeriod:${scope}`, defaultPeriod);
    } else {
      for (const scope of PREFERENCE_SCOPES) localStorage.removeItem(`fluxoraPeriod:${scope}`);
      localStorage.removeItem("focusWorkflows");
    }

    broadcastPreferencesUpdated();
    await Promise.all([
      utils.n8n.overview.invalidate(),
      utils.n8n.analytics.invalidate(),
      utils.n8n.executions.invalidate(),
    ]);
    toast.success("Alterações salvas", { description: "As preferências do painel foram aplicadas agora." });
    } catch {
      toast.error("Não foi possível aplicar as preferências. Tente novamente.");
    } finally {
      setSavingSettings(false);
    }
  };

  const clearLocalCache = () => {
    const preserve = ["notificationsEnabled", "preferredRefreshInterval", "fluxoraDefaultPeriod", "fluxoraPageSize", "fluxoraRememberFilters", "fluxoraErrorThreshold", "fluxoraInactiveHours"];
    const saved = Object.fromEntries(preserve.map((key) => [key, localStorage.getItem(key)]));
    localStorage.clear();
    for (const [key, value] of Object.entries(saved)) if (value != null) localStorage.setItem(key, value);
    restoreDraft();
    broadcastPreferencesUpdated();
    toast.success("Cache local limpo");
  };

  const refreshHistoryStatus = async () => {
    setRefreshingHistory(true);
    try {
      const archive = await utils.client.admin.refreshArchiveStatus.query();
      utils.admin.systemStatus.setData(undefined, (current) => current ? { ...current, archive } : current);
    } catch {
      toast.error("Não foi possível atualizar o status do histórico. Tente novamente.");
    } finally {
      setRefreshingHistory(false);
    }
  };

  const synchronizeHistory = async () => {
    try {
      setSyncingHistory(true);
      const protectedBefore = Number(system.data?.archive?.totalArchived || 0);
      setSyncProgress("Verificando e copiando o histórico principal…");
      const archiveResult = await sync.mutateAsync();
      if (archiveResult.status !== "ok") throw new Error(("message" in archiveResult && archiveResult.message) || "Não foi possível copiar o histórico.");
      const refreshedArchive = await system.refetch();

      if (!archiveResult.backfillComplete) {
        const protectedAfter = Number(refreshedArchive.data?.archive?.totalArchived || protectedBefore);
        const newlyProtected = Math.max(0, protectedAfter - protectedBefore);
        const pending = Number(refreshedArchive.data?.archive?.state?.missingExecutionCount || 0);
        const addedLabel = newlyProtected === 1 ? "1 nova execução protegida" : `${newlyProtected.toLocaleString("pt-BR")} novas execuções protegidas`;
        toast.success("Ciclo do histórico concluído", { description: `${addedLabel}; ${pending.toLocaleString("pt-BR")} continuam pendentes. ${Number(archiveResult.processed || 0).toLocaleString("pt-BR")} registros foram verificados.` });
        return;
      }

      setSyncProgress("Preservando o próximo lote de nodes e respostas…");
      const result = await preserveDetails.mutateAsync({ batchSize: 300 });
      if (result.status !== "ok") throw new Error(("message" in result && result.message) || "Não foi possível salvar os detalhes dos nodes.");
      utils.admin.systemStatus.setData(undefined, (current: any) => {
        if (!current?.archive) return current;
        return {
          ...current,
          archive: {
            ...current.archive,
            state: {
              ...current.archive.state,
              detailsHydrated: result.detailsHydrated,
              detailsPending: result.detailsPending,
              detailsUnavailable: result.detailsUnavailable,
            },
          },
        };
      });
      await system.refetch();
      if (result.detailsPending) {
        const unavailableInCycle = Number(result.newlyUnavailable || 0);
        toast.success("Ciclo concluído", { description: `${Number(result.hydrated || 0).toLocaleString("pt-BR")} detalhes preservados${unavailableInCycle ? ` e ${unavailableInCycle.toLocaleString("pt-BR")} indisponíveis` : ""}; ${Number(result.detailsPending).toLocaleString("pt-BR")} continuam na fila.` });
      } else {
        toast.success("Proteção concluída", { description: "O histórico principal, os nodes e as respostas disponíveis estão preservados." });
      }
    } catch (error) {
      toast.error("A sincronização foi interrompida", { description: error instanceof Error ? error.message : "Tente novamente em instantes." });
    } finally {
      setSyncingHistory(false);
      setSyncProgress("");
    }
  };

  return <OperationsShell><div className="mx-auto max-w-[1180px] px-5 py-8 md:px-9">
    <p className="text-[11px] font-bold uppercase tracking-[.18em] text-muted-foreground">Gestão / Configurações</p>
    <h2 className="mt-2 text-4xl font-semibold tracking-[-.05em]">Configurações do Fluxora</h2>
    <p className="mt-2 text-sm text-muted-foreground">Preferências do painel, alertas, histórico permanente e controles administrativos.</p>

    <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-7">
      <TabsList className="h-auto max-w-full flex-wrap bg-card p-1.5 shadow-sm">
        <TabsTrigger value="general">Preferências</TabsTrigger><TabsTrigger value="integrations">Integrações</TabsTrigger><TabsTrigger value="alerts">Alertas</TabsTrigger><TabsTrigger value="workflows">Workflows</TabsTrigger><TabsTrigger value="history">Histórico</TabsTrigger><TabsTrigger value="access">Acesso</TabsTrigger>
      </TabsList>

      <TabsContent value="general" className="mt-6">
        <Card className="border-0">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Settings2 className="h-4 w-4" />Preferências do painel</CardTitle><p className="text-xs text-muted-foreground">Neste navegador · Personalize a visualização sem alterar as configurações da equipe.</p></CardHeader>
          <CardContent className="grid gap-5">
            <div><Label>Período padrão</Label><p className="mb-2 mt-1 text-xs text-muted-foreground">Período selecionado ao abrir dashboards e análises.</p><Select value={defaultPeriod} onValueChange={(value) => setDefaultPeriod(value as DashboardPeriod)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="today">Hoje</SelectItem><SelectItem value="7d">7 dias</SelectItem><SelectItem value="30d">30 dias</SelectItem><SelectItem value="90d">90 dias</SelectItem><SelectItem value="all">Todas as execuções</SelectItem></SelectContent></Select></div>
            <div><Label>Execuções por página</Label><Select value={pageSize} onValueChange={setPageSize}><SelectTrigger className="mt-2 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="25">25</SelectItem><SelectItem value="50">50</SelectItem><SelectItem value="100">100</SelectItem></SelectContent></Select></div>
            <div><Label>Atualização preferida</Label><p className="mb-2 mt-1 text-xs text-muted-foreground">Intervalo sugerido para consultas automáticas.</p><Select value={refreshInterval} onValueChange={setRefreshInterval}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="15">15 segundos</SelectItem><SelectItem value="30">30 segundos</SelectItem><SelectItem value="60">1 minuto</SelectItem><SelectItem value="300">5 minutos</SelectItem></SelectContent></Select></div>
            <div className="flex items-center justify-between gap-4"><div><Label>Lembrar filtros</Label><p className="mt-1 text-xs text-muted-foreground">Mantém filtros e preferências entre sessões.</p></div><Switch checked={rememberFilters} aria-label="Lembrar filtros" disabled={savingSettings} aria-busy={savingSettings} onCheckedChange={setRememberFilters} /></div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-xs text-muted-foreground">A limpeza do cache afeta apenas este navegador.</p><Button size="sm" variant="outline" onClick={clearLocalCache}>Limpar cache local</Button></div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="integrations" className="mt-6 space-y-6">
        <Card className="border-0"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><DatabaseZap className="h-4 w-4" />Integrações</CardTitle><p className="text-xs text-muted-foreground">Toda a equipe · Verifique conexões e consulte diagnósticos da coleta.</p></CardHeader><CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-xl bg-background p-4"><div><p className="text-sm font-semibold">n8n</p><p className="mt-1 text-xs text-muted-foreground">Fonte operacional das automações.</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${overview.data?.connected ? "bg-feedback-success-surface text-feedback-success" : "bg-feedback-error-surface text-feedback-error"}`}>{overview.isLoading ? "Verificando" : overview.data?.connected ? "Online" : "Indisponível"}</span></div>
          <div className="flex items-center justify-between rounded-xl bg-background p-4"><div><p className="text-sm font-semibold">Firestore</p><p className="mt-1 text-xs text-muted-foreground">Histórico permanente das execuções.</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${system.data?.firestoreConfigured ? "bg-feedback-success-surface text-feedback-success" : "bg-feedback-error-surface text-feedback-error"}`}>{system.isLoading ? "Verificando" : system.data?.firestoreConfigured ? "Conectado" : "Indisponível"}</span></div>
          <div className="flex items-center justify-between rounded-xl bg-background p-4"><div><p className="text-sm font-semibold">Google Workspace Security</p><p className="mt-1 text-xs text-muted-foreground">Alertas, login, OAuth, Drive e postura do domínio.</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${system.data?.googleWorkspaceSecurity?.configured ? "bg-feedback-success-surface text-feedback-success" : "bg-feedback-error-surface text-feedback-error"}`}>{system.isLoading ? "Verificando" : system.data?.googleWorkspaceSecurity?.configured ? "Pronto para sincronizar" : "Configuração pendente"}</span></div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-background p-4"><div><p className="text-sm font-semibold">Google Chat · Resumo diário</p><p className="mt-1 text-xs text-muted-foreground">Uma mensagem após a coleta diária, agendada para 1h de Brasília. A ativação é feita pelas variáveis protegidas do projeto na Vercel.</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${system.data?.googleChatDailySummary?.configured ? "bg-feedback-success-surface text-feedback-success" : "bg-muted text-muted-foreground"}`}>{system.isLoading ? "Verificando" : system.data?.googleChatDailySummary?.configured ? "Destino configurado" : "Envio desativado"}</span></div>
          {user?.role === "admin" && <Accordion type="single" collapsible><AccordionItem value="workspace-diagnostics" className="border-0"><AccordionTrigger className="text-left text-sm">Google Workspace · Diagnóstico das fontes</AccordionTrigger><AccordionContent>
            <p className="text-xs text-muted-foreground">Acompanhe a última coleta e os avisos de acesso de cada fonte do Google Workspace.</p>
            {securityDashboard.isLoading ? <p className="mt-4 text-xs text-muted-foreground">Carregando fontes…</p> : securityDashboard.isError ? <p className="mt-4 text-xs text-orange-700 dark:text-orange-300">Não foi possível carregar o diagnóstico das fontes.</p> : <>    <Card className="mt-6 border-0"><CardHeader><CardTitle className="text-base">Fontes de auditoria</CardTitle><p className="text-xs text-muted-foreground">Os números abaixo mostram apenas a última coleta de cada fonte, não o total armazenado.</p></CardHeader><CardContent>{securitySources.length === 0 ? <p className="text-sm text-muted-foreground">Execute uma sincronização para registrar as fontes.</p> : <div className="grid gap-3 sm:grid-cols-2">{securitySources.map((item) => <div key={item.source} className="rounded-xl border p-3"><p className="font-medium">{sourceLabels[item.source] ?? item.source}</p><p className="mt-1 text-xs text-muted-foreground">{item.status === "ok" ? "Ativa" : item.status === "empty" ? "Sem eventos no último lote" : item.status === "incomplete" ? "Mais páginas pendentes" : item.status === "failure" ? "Requer atenção" : "Aguardando"}</p><p className="mt-1 text-xs text-muted-foreground">Última coleta: {item.received} recebidos · {item.collected} aceitos · {item.persisted} salvos{item.completedAt ? ` · ${new Date(item.completedAt).toLocaleString("pt-BR")}` : ""}</p>{item.safeError && <p className="mt-1 text-xs text-orange-700 dark:text-orange-300">{item.safeError === "permission" ? "Revise a delegação de domínio e os escopos desta fonte." : item.safeError === "configuration" ? "Revise a configuração da integração." : item.safeError === "invalid_request" ? "O Google rejeitou os parâmetros desta consulta." : item.safeError === "rate_limited" ? "O limite temporário do Google foi atingido; tente novamente depois." : item.safeError === "upstream" ? "O Google apresentou uma indisponibilidade temporária." : "A fonte não respondeu como esperado; tente novamente."}{item.httpStatus ? ` (HTTP ${item.httpStatus})` : ""}</p>}</div>)}</div>}</CardContent></Card>
            </>}
          </AccordionContent></AccordionItem></Accordion>}
          <div className="grid gap-3 sm:grid-cols-3"><Button variant="outline" onClick={async () => { const r = await testN8n.refetch(); r.data?.ok ? toast.success("n8n conectado") : toast.error("n8n indisponível"); }}>Testar n8n</Button><Button variant="outline" onClick={async () => { const r = await testFirestore.refetch(); r.data?.ok ? toast.success("Firestore conectado") : toast.error("Firestore indisponível"); }}>Testar Firestore</Button><Button variant="outline" disabled={testGoogleWorkspace.isFetching} aria-busy={testGoogleWorkspace.isFetching} onClick={async () => {
            const result = await testGoogleWorkspace.refetch();
            if (result.isError) toast.error("Não foi possível testar o Google Workspace");
            else if (result.data?.ok) toast.success("Google Workspace conectado", { description: "Acesso confirmado a todas as fontes verificadas." });
            else toast.warning("Google Workspace com acesso incompleto", { description: "Consulte abaixo as fontes que não responderam ao teste." });
          }}>{testGoogleWorkspace.isFetching ? "Testando Google Workspace…" : "Testar Google Workspace"}</Button></div>
          {testGoogleWorkspace.data && !testGoogleWorkspace.isFetching && !testGoogleWorkspace.isError && <div className="rounded-lg border p-3 text-xs" role="status"><p className="font-medium">{testGoogleWorkspace.data.ok ? "Todas as fontes responderam ao teste de acesso." : "Fontes que precisam de revisão:"}</p><ul className="mt-2 space-y-1">{testGoogleWorkspace.data.checks.filter((check) => !check.ok).map((check) => <li key={check.source} className="text-orange-700 dark:text-orange-300">{check.source}: {check.message}</li>)}</ul><p className="mt-2 text-muted-foreground">Teste somente de leitura. Nenhuma coleta foi iniciada e nenhum dado foi salvo.</p></div>}
        </CardContent></Card>
      </TabsContent>

      <TabsContent value="alerts" className="mt-6 space-y-6">
        <WorkflowAlertRulesManager />
        <Card className="border-0"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Bell className="h-4 w-4" />Alertas pessoais</CardTitle><p className="text-xs text-muted-foreground">Neste navegador · Ajuste as notificações da sessão e os indicadores gerais do Monitoramento. Estas opções não alteram as regras da equipe acima.</p></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-4 sm:col-span-2"><div><Label>Alertas de falha</Label><p className="mt-1 text-xs text-muted-foreground">Notificar novas execuções com erro durante a sessão.</p></div><Switch checked={notifications} aria-label="Alertas de falha" disabled={savingSettings} aria-busy={savingSettings} onCheckedChange={setNotifications} /></div>
          <div><Label>Limiar de falha (%)</Label><p className="mb-2 mt-1 text-xs text-muted-foreground">Limite usado no resumo geral do Monitoramento neste navegador.</p><Input type="number" min="1" max="100" value={errorThreshold} onChange={(e) => setErrorThreshold(e.target.value)} /></div>
          <div><Label>Workflow sem executar (horas)</Label><p className="mb-2 mt-1 text-xs text-muted-foreground">Referência para alertas de automações inativas, até o máximo de 7 dias monitorados.</p><Input type="number" min="1" max="168" value={inactiveHours} onChange={(e) => setInactiveHours(e.target.value)} /></div>
        </CardContent></Card>
      </TabsContent>

      <TabsContent value="history" className="mt-6">
        <HistoryBackupPanel archive={archive} loading={system.isLoading || refreshingHistory} syncing={syncingHistory} activity={syncProgress} onRunCycle={synchronizeHistory} onRefresh={refreshHistoryStatus} />
      </TabsContent>

      <TabsContent value="workflows" className="mt-6 space-y-6">
        <div><h3 className="text-sm font-semibold">Confiabilidade e resposta a incidentes</h3><p className="mt-1 text-xs text-muted-foreground">Toda a equipe · As metas aparecem no Analytics; as orientações acompanham os incidentes. Cada formulário tem seu próprio botão para salvar.</p></div>
        <WorkflowSloManager />
        <WorkflowRunbookManager />

      </TabsContent>

      <TabsContent value="access" className="mt-6 space-y-6">
        <Card className="border-0"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" />Sua conta</CardTitle><p className="text-xs text-muted-foreground">O acesso utiliza Google corporativo e exige habilitação no Fluxora.</p></CardHeader><CardContent className="flex flex-wrap items-center justify-between gap-4"><div className="min-w-0"><p className="font-semibold">{user?.name}</p><p className="break-all text-sm text-muted-foreground">{user?.email}</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">Administrador</span></CardContent></Card>
        <Card className="border-0"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" />Usuários e permissões</CardTitle></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-4"><p className="max-w-xl text-sm text-muted-foreground">Toda a equipe · Gerencie usuários, bloqueios e perfis na área de controle de acesso.</p><Button asChild><Link href="/users">Gerenciar usuários</Link></Button></div>
          <Accordion type="single" collapsible><AccordionItem value="roles" className="border-0"><AccordionTrigger className="text-sm">Consultar permissões por perfil</AccordionTrigger><AccordionContent><dl className="grid gap-4 sm:grid-cols-3"><div><dt className="font-medium">Visualizador</dt><dd className="mt-1 text-xs text-muted-foreground">Consulta dashboards, workflows, execuções, erros, analytics e monitoramento.</dd></div><div><dt className="font-medium">Operador</dt><dd className="mt-1 text-xs text-muted-foreground">Acesso de visualização e ações operacionais autorizadas nos workflows.</dd></div><div><dt className="font-medium">Administrador</dt><dd className="mt-1 text-xs text-muted-foreground">Acesso completo, gerenciamento de usuários, configurações e sincronização.</dd></div></dl></AccordionContent></AccordionItem></Accordion>
        </CardContent></Card>
      </TabsContent>
      {(activeTab === "general" || activeTab === "alerts") && <div className="sticky bottom-4 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-lg">
        <div><p className="text-sm font-medium">Preferências pessoais · Neste navegador</p><p className="mt-1 text-xs text-muted-foreground">{hasChanges ? "Há alterações não salvas nas abas Preferências ou Alertas." : "Nenhuma alteração pendente."} Salvar ou descartar se aplica às duas abas.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!hasChanges || savingSettings} onClick={restoreDraft}>Descartar alterações</Button><Button disabled={!hasChanges || savingSettings} onClick={saveSettings} aria-busy={savingSettings}>{savingSettings ? "Salvando…" : "Salvar preferências pessoais"}</Button></div>
      </div>}
    </Tabs>
  </div></OperationsShell>;
}
