import { useMemo, useState } from "react";
import { Bell, DatabaseZap, Settings2, ShieldCheck, Users, Workflow } from "lucide-react";
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
  const overview = trpc.n8n.overview.useQuery({ period: "7d", workflowIds: [] }, { retry: false });
  const system = trpc.admin.systemStatus.useQuery(undefined, { retry: false, refetchInterval: 300_000, staleTime: 300_000 });
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

  const sync = trpc.n8n.syncArchive.useMutation();
  const preserveDetails = trpc.n8n.preserveExecutionDetails.useMutation();
  const testN8n = trpc.admin.testN8n.useQuery(undefined, { enabled: false, retry: false });
  const testFirestore = trpc.admin.testFirestore.useQuery(undefined, { enabled: false, retry: false });

  const securityDashboard = trpc.workspaceSecurity.overview.useQuery(undefined, { enabled: user?.role === "admin", retry: false, staleTime: 300_000 });
  const securitySources = securityDashboard.data?.sources ?? [];
  const continueBackfill = trpc.workspaceSecurity.continueBackfill.useMutation({
    onSuccess: async (result) => {
      await Promise.all([utils.workspaceSecurity.overview.invalidate(), utils.workspaceSecurity.eventsPage.invalidate()]);
      if (result.windowsProcessed > 0) {
        toast.success("Lote histórico processado", { description: `${result.eventsCollected.toLocaleString("pt-BR")} eventos coletados; ${result.sourcesCompleted} fonte${result.sourcesCompleted === 1 ? "" : "s"} concluiu${result.sourcesCompleted === 1 ? "" : "íram"} a cobertura.` });
      } else {
        toast.warning("Nenhum lote conseguiu avançar", { description: result.failedSources.length ? "Algumas fontes do Google Workspace não responderam. Consulte os avisos nas fontes abaixo." : "A cobertura disponível já foi processada." });
      }
    },
    onError: (error) => toast.error("O histórico não avançou", { description: error.message || "Tente novamente em instantes." }),
  });

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

    <Tabs defaultValue="general" className="mt-7">
      <TabsList className="h-auto flex-wrap bg-card p-1.5 shadow-sm">
        <TabsTrigger value="general">Geral</TabsTrigger><TabsTrigger value="alerts">Alertas</TabsTrigger><TabsTrigger value="history">Histórico</TabsTrigger><TabsTrigger value="workflows">Workflows</TabsTrigger><TabsTrigger value="security">Segurança</TabsTrigger>
      </TabsList>

      <TabsContent value="general" className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="border-0">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Settings2 className="h-4 w-4" />Preferências do painel</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div><Label>Período padrão</Label><p className="mb-2 mt-1 text-xs text-muted-foreground">Período selecionado ao abrir dashboards e análises.</p><Select value={defaultPeriod} onValueChange={(value) => setDefaultPeriod(value as DashboardPeriod)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="today">Hoje</SelectItem><SelectItem value="7d">7 dias</SelectItem><SelectItem value="30d">30 dias</SelectItem><SelectItem value="90d">90 dias</SelectItem><SelectItem value="all">Todas as execuções</SelectItem></SelectContent></Select></div>
            <div><Label>Atualização preferida</Label><p className="mb-2 mt-1 text-xs text-muted-foreground">Intervalo sugerido para consultas automáticas.</p><Select value={refreshInterval} onValueChange={setRefreshInterval}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="15">15 segundos</SelectItem><SelectItem value="30">30 segundos</SelectItem><SelectItem value="60">1 minuto</SelectItem><SelectItem value="300">5 minutos</SelectItem></SelectContent></Select></div>
            <div><Label>Execuções por página</Label><Select value={pageSize} onValueChange={setPageSize}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="25">25</SelectItem><SelectItem value="50">50</SelectItem><SelectItem value="100">100</SelectItem></SelectContent></Select></div>
            <div className="flex items-center justify-between"><div><Label>Lembrar filtros</Label><p className="mt-1 text-xs text-muted-foreground">Mantém filtros e preferências entre sessões.</p></div><Switch checked={rememberFilters} aria-label="Lembrar filtros" disabled={savingSettings} aria-busy={savingSettings} onCheckedChange={setRememberFilters} /></div>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90" disabled={!hasChanges || savingSettings} onClick={saveSettings} aria-busy={savingSettings}>{savingSettings ? "Salvando…" : "Salvar alterações"}</Button>
              <Button variant="outline" disabled={!hasChanges || savingSettings} onClick={restoreDraft}>Descartar</Button>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><DatabaseZap className="h-4 w-4" />Integrações</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-xl bg-background p-4"><div><p className="text-sm font-semibold">n8n</p><p className="mt-1 text-xs text-muted-foreground">Fonte operacional das automações.</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${overview.data?.connected ? "bg-feedback-success-surface text-feedback-success" : "bg-feedback-error-surface text-feedback-error"}`}>{overview.isLoading ? "Verificando" : overview.data?.connected ? "Online" : "Indisponível"}</span></div>
          <div className="flex items-center justify-between rounded-xl bg-background p-4"><div><p className="text-sm font-semibold">Firestore</p><p className="mt-1 text-xs text-muted-foreground">Histórico permanente das execuções.</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${system.data?.firestoreConfigured ? "bg-feedback-success-surface text-feedback-success" : "bg-feedback-error-surface text-feedback-error"}`}>{system.isLoading ? "Verificando" : system.data?.firestoreConfigured ? "Conectado" : "Indisponível"}</span></div>
          <div className="flex items-center justify-between rounded-xl bg-background p-4"><div><p className="text-sm font-semibold">Google Workspace Security</p><p className="mt-1 text-xs text-muted-foreground">Alertas, login, OAuth, Drive e postura do domínio.</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${system.data?.googleWorkspaceSecurity?.configured ? "bg-feedback-success-surface text-feedback-success" : "bg-feedback-error-surface text-feedback-error"}`}>{system.isLoading ? "Verificando" : system.data?.googleWorkspaceSecurity?.configured ? "Pronto para sincronizar" : "Configuração pendente"}</span></div>
          {user?.role === "admin" && <Accordion type="single" collapsible><AccordionItem value="workspace-diagnostics" className="border-0"><AccordionTrigger className="text-left text-sm">Google Workspace · Diagnóstico e histórico</AccordionTrigger><AccordionContent>
            <p className="text-xs text-muted-foreground">Área administrativa. A cobertura histórica pode estar incompleta; cada ação processa apenas um lote e não garante a coleta de todo o histórico.</p>
            <p className="mt-3 text-xs text-muted-foreground">{securityDashboard.data?.summary.coveragePercent ?? 0}% dos 90 dias cobertos · {securityDashboard.data?.summary.backfillPagesProcessed ?? 0} páginas históricas processadas.</p>
            <Button className="mt-3" size="sm" variant="outline" disabled={continueBackfill.isPending || !system.data?.googleWorkspaceSecurity?.configured} onClick={() => continueBackfill.mutate()}>{continueBackfill.isPending ? "Processando lote…" : "Processar próximo lote histórico"}</Button>
            {securityDashboard.isLoading ? <p className="mt-4 text-xs text-muted-foreground">Carregando fontes…</p> : securityDashboard.isError ? <p className="mt-4 text-xs text-orange-700 dark:text-orange-300">Não foi possível carregar o diagnóstico das fontes.</p> : <>    <Card className="mt-6 border-0"><CardHeader><CardTitle className="text-base">Fontes de auditoria</CardTitle><p className="text-xs text-muted-foreground">Os números abaixo mostram apenas a última coleta de cada fonte, não o total armazenado.</p></CardHeader><CardContent>{securitySources.length === 0 ? <p className="text-sm text-muted-foreground">Execute uma sincronização para registrar as fontes.</p> : <div className="grid gap-3 sm:grid-cols-2">{securitySources.map((item) => <div key={item.source} className="rounded-xl border p-3"><p className="font-medium">{sourceLabels[item.source] ?? item.source}</p><p className="mt-1 text-xs text-muted-foreground">{item.status === "ok" ? "Ativa" : item.status === "empty" ? "Sem eventos no último lote" : item.status === "incomplete" ? "Mais páginas pendentes" : item.status === "failure" ? "Requer atenção" : "Aguardando"}</p><p className="mt-1 text-xs text-muted-foreground">Última coleta: {item.received} recebidos · {item.collected} aceitos · {item.persisted} salvos{item.completedAt ? ` · ${new Date(item.completedAt).toLocaleString("pt-BR")}` : ""}</p>{item.safeError && <p className="mt-1 text-xs text-orange-700 dark:text-orange-300">{item.safeError === "permission" ? "Revise a delegação de domínio e os escopos desta fonte." : item.safeError === "configuration" ? "Revise a configuração da integração." : item.safeError === "invalid_request" ? "O Google rejeitou os parâmetros desta consulta." : item.safeError === "rate_limited" ? "O limite temporário do Google foi atingido; tente novamente depois." : item.safeError === "upstream" ? "O Google apresentou uma indisponibilidade temporária." : "A fonte não respondeu como esperado; tente novamente."}{item.httpStatus ? ` (HTTP ${item.httpStatus})` : ""}</p>}</div>)}</div>}</CardContent></Card>
            </>}
          </AccordionContent></AccordionItem></Accordion>}
          <div className="grid grid-cols-2 gap-3"><Button variant="outline" onClick={async () => { const r = await testN8n.refetch(); r.data?.ok ? toast.success("n8n conectado") : toast.error("n8n indisponível"); }}>Testar n8n</Button><Button variant="outline" onClick={async () => { const r = await testFirestore.refetch(); r.data?.ok ? toast.success("Firestore conectado") : toast.error("Firestore indisponível"); }}>Testar Firestore</Button></div>
        </CardContent></Card>
      </TabsContent>

      <TabsContent value="alerts" className="mt-6 grid gap-6 lg:grid-cols-2">
        <WorkflowAlertRulesManager />
        <Card className="border-0"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Bell className="h-4 w-4" />Notificações</CardTitle></CardHeader><CardContent className="space-y-5">
          <div className="flex items-center justify-between"><div><Label>Alertas de falha</Label><p className="mt-1 text-xs text-muted-foreground">Notificar novas execuções com erro durante a sessão.</p></div><Switch checked={notifications} aria-label="Alertas de falha" disabled={savingSettings} aria-busy={savingSettings} onCheckedChange={setNotifications} /></div>
          <div><Label>Limiar de falha (%)</Label><p className="mb-2 mt-1 text-xs text-muted-foreground">Referência para destacar workflows com taxa de erro elevada.</p><Input type="number" min="1" max="100" value={errorThreshold} onChange={(e) => setErrorThreshold(e.target.value)} /></div>
          <div><Label>Workflow sem executar (horas)</Label><p className="mb-2 mt-1 text-xs text-muted-foreground">Referência para alertas de automações inativas, até o máximo de 7 dias monitorados.</p><Input type="number" min="1" max="168" value={inactiveHours} onChange={(e) => setInactiveHours(e.target.value)} /></div>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90" disabled={!hasChanges || savingSettings} onClick={saveSettings} aria-busy={savingSettings}>{savingSettings ? "Salvando…" : "Salvar alterações"}</Button>
            <Button variant="outline" disabled={!hasChanges || savingSettings} onClick={restoreDraft}>Descartar</Button>
          </div>
        </CardContent></Card>
        <Card className="border-0"><CardHeader><CardTitle className="text-base">Política de alertas</CardTitle></CardHeader><CardContent className="space-y-3 text-sm text-muted-foreground"><p>Os alertas do cabeçalho continuam baseados nas falhas reais consultadas pelo Fluxora.</p><p>As preferências gerais ficam neste navegador. As regras por workflow são centralizadas no Firestore e valem para toda a equipe.</p></CardContent></Card>
      </TabsContent>

      <TabsContent value="history" className="mt-6">
        <HistoryBackupPanel archive={archive} loading={system.isLoading} syncing={syncingHistory} activity={syncProgress} onRunCycle={synchronizeHistory} onRefresh={() => { void system.refetch(); }} />
      </TabsContent>

      <TabsContent value="workflows" className="mt-6 grid gap-6 lg:grid-cols-2">
        <WorkflowSloManager />
        <WorkflowRunbookManager />
        <Card className="border-0"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Workflow className="h-4 w-4" />Comportamento dos workflows</CardTitle></CardHeader><CardContent className="space-y-4"><div className="rounded-xl bg-background p-4"><p className="text-sm font-semibold">Workflows em foco</p><p className="mt-1 text-xs leading-5 text-muted-foreground">A seleção feita na Visão geral continua salva no navegador e define os indicadores em destaque.</p></div><div className="rounded-xl bg-background p-4"><p className="text-sm font-semibold">Ações operacionais</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Administradores e Operadores podem executar ações autorizadas. Visualizadores têm acesso somente leitura.</p></div></CardContent></Card>
        <Card className="border-0"><CardHeader><CardTitle className="text-base">Permissões por perfil</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><div className="rounded-xl border p-4"><b>Visualizador</b><p className="mt-1 text-xs text-muted-foreground">Dashboards, workflows, execuções, erros, analytics e monitoramento.</p></div><div className="rounded-xl border p-4"><b>Operador</b><p className="mt-1 text-xs text-muted-foreground">Tudo do Visualizador + ações operacionais de workflows.</p></div><div className="rounded-xl border p-4"><b>Administrador</b><p className="mt-1 text-xs text-muted-foreground">Acesso completo, usuários, configurações e sincronização.</p></div></CardContent></Card>
      </TabsContent>

      <TabsContent value="security" className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="border-0"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" />Sessão e acesso</CardTitle></CardHeader><CardContent className="space-y-4"><div className="rounded-xl bg-background p-4"><p className="text-xs text-muted-foreground">Usuário atual</p><p className="mt-1 font-semibold">{user?.name}</p><p className="text-xs text-muted-foreground">{user?.email}</p></div><div className="rounded-xl bg-background p-4"><p className="text-xs text-muted-foreground">Perfil</p><p className="mt-1 font-semibold">Administrador</p></div><p className="text-xs leading-5 text-muted-foreground">O login utiliza Google corporativo e o acesso só é concedido a pessoas habilitadas no Fluxora.</p></CardContent></Card>
        <Card className="border-0"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" />Controle de acesso</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">Gerencie usuários, bloqueios e perfis em uma área administrativa dedicada.</p><Link href="/users"><Button className="mt-5 bg-primary text-primary-foreground hover:bg-primary/90">Gerenciar usuários</Button></Link></CardContent></Card>
        <Card className="border-0 lg:col-span-2"><CardHeader><CardTitle className="text-base">Manutenção</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-3"><Button variant="outline" onClick={clearLocalCache}>Limpar cache local</Button><Button variant="outline" onClick={() => overview.refetch()}>Atualizar conexão n8n</Button><Button variant="outline" onClick={() => system.refetch()}>Atualizar status do histórico</Button></CardContent></Card>
      </TabsContent>
    </Tabs>
  </div></OperationsShell>;
}
