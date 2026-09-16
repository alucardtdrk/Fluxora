import { useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock3, Database, DatabaseZap, RefreshCw, RotateCcw, ServerCog, ShieldCheck, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import OperationsShell from "@/components/OperationsShell";
import IncidentAttentionCenter from "@/components/IncidentAttentionCenter";
import { MetricSkeleton } from "@/components/MetricSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PREFERENCES_UPDATED_EVENT, readOperationalAlertPreferences, readPreferredRefreshSeconds } from "@/lib/preferences";
import { trpc } from "@/lib/trpc";

function MonitoringMetric({ icon: Icon, label, loading, children }: { icon: LucideIcon; label: string; loading: boolean; children: React.ReactNode }) {
  return <Card className="border-0"><CardContent className="p-6"><Icon className="h-5 w-5 text-[#4355D8]" /><p className="mt-4 text-xs uppercase tracking-[.14em] text-[#667085]">{label}</p>{loading ? <MetricSkeleton /> : <p className="mt-2 text-3xl font-semibold">{children}</p>}</CardContent></Card>;
}

function MonitoringAlerts({ loading, metrics, errorThreshold, inactiveHours }: { loading: boolean; metrics: any; errorThreshold: number; inactiveHours: number }) {
  if (loading || !metrics) return null;
  const completed = (metrics.success ?? 0) + (metrics.errors ?? 0) + (metrics.canceled ?? 0);
  const failureRate = completed ? (metrics.errors / completed) * 100 : 0;
  const alerts = [
    failureRate >= errorThreshold ? `A taxa de falhas está em ${failureRate.toFixed(1)}%, acima do limite configurado de ${errorThreshold}%.` : null,
    metrics.inactiveActiveWorkflows > 0 ? `${metrics.inactiveActiveWorkflows} workflow(s) ativo(s) está(ão) sem execução há pelo menos ${inactiveHours}h.` : null,
  ].filter((alert): alert is string => Boolean(alert));
  if (!alerts.length) return null;
  return <Card className="mt-6 border border-amber-200 bg-amber-50 dark:border-amber-400/20 dark:bg-amber-500/10"><CardContent className="flex gap-3 p-4"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300"/><div><p className="font-semibold">Atenção operacional</p><ul className="mt-1 space-y-1 text-sm text-[#667085] dark:text-slate-300">{alerts.map((alert) => <li key={alert}>{alert}</li>)}</ul></div></CardContent></Card>;
}

function ReliabilityPanel({ analytics, loading }: { analytics: any; loading: boolean }) {
  const reliability = analytics?.reliability;
  const workflowAlerts = (analytics?.workflowStats ?? []).filter((item: any) => item.alertReasons?.length);
  const anomalies = analytics?.anomalies ?? [];
  const formatRecovery = (minutes: number | null | undefined) => minutes == null ? "Sem dados" : minutes < 60 ? `${minutes.toFixed(1)} min` : `${(minutes / 60).toFixed(1)} h`;
  return <>
    <div className="mt-6 grid gap-4 md:grid-cols-3">
      <MonitoringMetric icon={RotateCcw} label="Tempo médio para recuperar" loading={loading}>{formatRecovery(reliability?.meanRecoveryMinutes)}</MonitoringMetric>
      <MonitoringMetric icon={Clock3} label="Intervalo médio entre falhas" loading={loading}>{reliability?.meanTimeBetweenFailuresHours == null ? "Sem dados" : `${reliability.meanTimeBetweenFailuresHours.toFixed(1)} h`}</MonitoringMetric>
      <MonitoringMetric icon={AlertTriangle} label="Maior sequência de falhas" loading={loading}>{reliability?.longestFailureStreak ?? 0}</MonitoringMetric>
    </div>
    {(anomalies.length > 0 || workflowAlerts.length > 0) ? <Card className="mt-6 border border-amber-200 bg-amber-50 dark:border-amber-400/20 dark:bg-amber-500/10"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-5 w-5 text-amber-600" />Sinais que merecem atenção</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">
      {anomalies.map((item: any) => <div key={`${item.type}-${item.description}`} className="rounded-xl bg-white/70 p-4 dark:bg-white/5"><p className="text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs leading-5 text-[#667085] dark:text-slate-300">{item.description}</p></div>)}
      {workflowAlerts.map((item: any) => <div key={item.id} className="rounded-xl bg-white/70 p-4 dark:bg-white/5"><p className="text-sm font-semibold">{item.name}</p><p className="mt-1 text-xs leading-5 text-[#667085] dark:text-slate-300">{item.alertReasons.join(" · ")}</p></div>)}
    </CardContent></Card> : null}
  </>;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Ainda não executada";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("pt-BR") : "Indisponível";
}

function formatDuration(milliseconds?: number | null) {
  if (milliseconds == null || !Number.isFinite(milliseconds)) return "Sem medição";
  if (milliseconds < 1000) return `${milliseconds} ms`;
  const seconds = milliseconds / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

function FluxoraHealthPanel({ archive, loading }: { archive: any; loading: boolean }) {
  const state = archive?.state;
  const lastSuccess = state?.lastSuccessfulSyncAt || (state?.lastRunStatus !== "failure" ? state?.lastSyncAt : null);
  const successAge = lastSuccess ? Date.now() - new Date(lastSuccess).getTime() : Number.POSITIVE_INFINITY;
  const runningAge = state?.lastRunStatus === "running" && state?.lastRunStartedAt ? Date.now() - new Date(state.lastRunStartedAt).getTime() : 0;
  const delayed = successAge > 36 * 60 * 60 * 1000;
  const stuck = runningAge > 10 * 60 * 1000;
  const failed = state?.lastRunStatus === "failure" || Boolean(state?.lastError);
  const healthy = archive?.configured && !failed && !stuck && !delayed;
  const status = !archive?.configured ? "Não configurado" : stuck ? "Possível travamento" : failed ? "Último ciclo falhou" : delayed ? "Rotina atrasada" : state?.lastRunStatus === "running" ? "Em execução" : "Operação normal";
  const statusClass = healthy ? "bg-emerald-50 text-emerald-700" : state?.lastRunStatus === "running" && !stuck ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700";
  const trigger = state?.lastRunTrigger === "scheduled" ? "Automático pelo Vercel" : state?.lastRunTrigger === "manual" ? "Manual" : "Sistema";

  return <Card className="mt-6 border-0">
    <CardHeader><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><CardTitle className="flex items-center gap-2 text-base"><ServerCog className="h-5 w-5 text-primary" />Saúde do Fluxora</CardTitle><p className="mt-1 text-sm text-muted-foreground">Acompanhamento da rotina que protege o histórico no Vercel.</p></div>{!loading && <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${statusClass}`}>{status}</span>}</div></CardHeader>
    <CardContent>
      {loading ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border p-4"><p className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="h-4 w-4" />Último sucesso</p><p className="mt-3 text-sm font-semibold">{formatDateTime(lastSuccess)}</p></div>
        <div className="rounded-xl border p-4"><p className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="h-4 w-4" />Duração do ciclo</p><p className="mt-3 text-lg font-semibold">{formatDuration(state?.lastRunDurationMs)}</p></div>
        <div className="rounded-xl border p-4"><p className="flex items-center gap-2 text-xs text-muted-foreground"><Activity className="h-4 w-4" />Último ciclo</p><p className="mt-3 text-lg font-semibold">{Number(state?.lastRunProcessed || 0).toLocaleString("pt-BR")} verificados</p><p className="mt-1 text-xs text-muted-foreground">{Number(state?.lastRunSaved || 0).toLocaleString("pt-BR")} novos protegidos</p></div>
        <div className="rounded-xl border p-4"><p className="flex items-center gap-2 text-xs text-muted-foreground"><Database className="h-4 w-4" />Origem do ciclo</p><p className="mt-3 text-lg font-semibold">{trigger}</p><p className="mt-1 text-xs text-muted-foreground">Firestore {archive?.configured ? "conectado" : "não configurado"}</p></div>
      </div>}
      {!loading && (failed || stuck || delayed) && <div className="mt-4 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="text-sm font-semibold">A rotina precisa de atenção</p><p className="mt-1 text-xs leading-5">{stuck ? "O ciclo está marcado como ativo há mais de 10 minutos." : failed ? state?.lastError || "O último ciclo não terminou corretamente." : "Nenhuma sincronização bem-sucedida foi registrada nas últimas 36 horas."}</p></div></div>}
    </CardContent>
  </Card>;
}

export default function Monitoring() {
  const [refreshSeconds, setRefreshSeconds] = useState(() => readPreferredRefreshSeconds());
  const [alertPreferences, setAlertPreferences] = useState(() => readOperationalAlertPreferences());
  const refreshIntervalMs = refreshSeconds * 1000;
  const overview = trpc.n8n.overview.useQuery({ period: "7d", workflowIds: [], inactiveHours: alertPreferences.inactiveHours }, { retry: false, refetchInterval: refreshIntervalMs, placeholderData: (previous) => previous });
  const workflows = trpc.n8n.workflows.useQuery(undefined, { retry: false, refetchInterval: refreshIntervalMs });
  const analytics = trpc.n8n.analytics.useQuery({ period: "7d" }, { retry: false, refetchInterval: refreshIntervalMs, placeholderData: (previous) => previous });
  const archiveStatus = trpc.n8n.archiveStatus.useQuery(undefined, { retry: false, refetchInterval: refreshIntervalMs, placeholderData: (previous) => previous });
  const metrics = overview.data?.metrics;
  const overviewLoading = overview.isPending && !overview.data;
  const workflowsLoading = workflows.isPending && !workflows.data;
  const refresh = () => Promise.all([overview.refetch(), workflows.refetch(), analytics.refetch(), archiveStatus.refetch()]);

  useEffect(() => {
    const syncPreferences = () => { setRefreshSeconds(readPreferredRefreshSeconds()); setAlertPreferences(readOperationalAlertPreferences()); };
    window.addEventListener(PREFERENCES_UPDATED_EVENT, syncPreferences);
    return () => window.removeEventListener(PREFERENCES_UPDATED_EVENT, syncPreferences);
  }, []);

  return <OperationsShell><div className="mx-auto max-w-[1280px] px-5 py-8 md:px-9">
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-[11px] font-bold uppercase tracking-[.18em] text-[#667085]">Gestão / Monitoramento</p><h2 className="mt-2 text-4xl font-semibold tracking-[-.05em]">Saúde do ambiente</h2><p className="mt-2 text-sm text-[#667085]">Acompanhe disponibilidade, falhas e estado operacional do n8n em tempo quase real.</p></div><Button variant="outline" onClick={refresh}><RefreshCw className={`mr-2 h-4 w-4 ${overview.isFetching ? "animate-spin" : ""}`}/>Atualizar</Button></div>
    <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <MonitoringMetric icon={DatabaseZap} label="Conexão n8n" loading={overviewLoading}>{overview.data?.connected ? "Online" : "Offline"}</MonitoringMetric>
      <MonitoringMetric icon={Workflow} label="Workflows ativos" loading={overviewLoading}>{metrics?.active ?? 0}<span className="text-sm font-normal text-[#98A2B3]"> / {metrics?.workflows ?? 0}</span></MonitoringMetric>
      <MonitoringMetric icon={CheckCircle2} label="Taxa de sucesso · 7 dias" loading={overviewLoading}>{metrics?.successRate != null ? `${metrics.successRate}%` : "—"}</MonitoringMetric>
      <MonitoringMetric icon={AlertTriangle} label="Falhas 7 dias" loading={overviewLoading}>{metrics?.errors ?? 0}</MonitoringMetric>
    </div>
    <MonitoringAlerts loading={overviewLoading} metrics={metrics} errorThreshold={alertPreferences.errorThreshold} inactiveHours={alertPreferences.inactiveHours} />
    <IncidentAttentionCenter incidents={(analytics.data?.incidentGroups ?? []) as any[]} loading={analytics.isPending && !analytics.data} />
    <FluxoraHealthPanel archive={archiveStatus.data} loading={archiveStatus.isPending && !archiveStatus.data} />
    <ReliabilityPanel analytics={analytics.data} loading={analytics.isPending && !analytics.data} />
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <Card className="border-0"><CardHeader><CardTitle className="text-base">Estado dos workflows</CardTitle></CardHeader><CardContent className="space-y-3">{workflowsLoading ? <div className="space-y-3">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-xl bg-[#eef0f6] dark:bg-white/10" />)}</div> : (workflows.data?.items ?? []).map((workflow: any) => <div key={workflow.id} className="flex items-center justify-between rounded-xl bg-[#F5F7FB] px-4 py-3"><div><p className="text-sm font-semibold">{workflow.name}</p><p className="mt-1 text-xs text-[#98A2B3]">{workflow.nodeCount} nodes</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${workflow.active ? "bg-[#e3f6eb] text-[#258b57]" : "bg-[#eef0f6] text-[#667085]"}`}>{workflow.active ? "Ativo" : "Inativo"}</span></div>)}</CardContent></Card>
      <Card className="border-0 bg-[#11183D] text-white"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-5 w-5 text-[#19D3C5]"/>Monitoramento automático</CardTitle></CardHeader><CardContent><p className="text-sm leading-6 text-[#C7CEE8]">O painel consulta o backend periodicamente. Novas falhas aparecem no sino de notificações e podem gerar um alerta visual.</p><div className="mt-6 rounded-xl bg-white/10 p-4"><Activity className="h-4 w-4 text-[#19D3C5]"/><p className="mt-3 text-2xl font-semibold">{refreshSeconds}s</p><p className="text-xs text-[#AAB4DA]">intervalo configurado para todas as consultas</p></div></CardContent></Card>
    </div>
  </div></OperationsShell>;
}
