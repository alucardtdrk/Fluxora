import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, BarChart3, Eye, RefreshCw, Timer, TrendingUp, Workflow } from "lucide-react";
import { Link } from "wouter";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import OperationsShell from "@/components/OperationsShell";
import { MetricSkeleton } from "@/components/MetricSkeleton";
import ExecutionDetailDialog from "@/components/ExecutionDetailDialog";
import IncidentLifecycleDialog from "@/components/IncidentLifecycleDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PREFERENCES_UPDATED_EVENT, readPreferredPageSize, readPreferredRefreshSeconds, readScopedPeriod, saveScopedPeriod, type DashboardPeriod } from "@/lib/preferences";
import { trpc } from "@/lib/trpc";

type Period = DashboardPeriod;
const periodLabels: Record<Period, string> = { today: "Hoje", "7d": "7 dias", "30d": "30 dias", "90d": "90 dias", all: "Todo o histórico" };

export default function Insights() {
  return <AnalyticsPage />;
}

export function ErrorsInsights() {
  return <ErrorsPage />;
}

function Header({ title, description, period, setPeriod, refresh, loading }: { title: string; description: string; period: Period; setPeriod: (period: Period) => void; refresh: () => void; loading: boolean }) {
  return (
    <>
      <Link href="/" className="mb-6 inline-flex items-center gap-2 text-xs font-semibold text-[#667085]"><ArrowLeft className="h-3.5 w-3.5" />Voltar para visão geral</Link>
      <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[.18em] text-[#667085]">Monitoramento</p>
          <h2 className="mt-3 text-4xl font-semibold tracking-[-.06em]">{title}</h2>
          <p className="mt-2 text-sm text-[#667085]">{description}</p>
        </div>
        <div className="flex gap-2">
          <Select value={period} onValueChange={(value) => setPeriod(value as Period)}>
            <SelectTrigger className="w-[160px] bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(periodLabels) as Period[]).map((value) => <SelectItem key={value} value={value}>{periodLabels[value]}</SelectItem>)}</SelectContent>
          </Select>
          <Button onClick={refresh} className="rounded-xl bg-[#4355D8] text-white"><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
        </div>
      </div>
    </>
  );
}

type PeriodComparison = {
  executionsDelta: number | null;
  errorsDelta: number | null;
  successRateDelta: number | null;
};

function AnalyticsAlerts({ comparison }: { comparison?: PeriodComparison | null }) {
  if (!comparison) return null;
  const alerts = [
    comparison.errorsDelta !== null && comparison.errorsDelta >= 50 ? "As falhas cresceram 50% ou mais na metade mais recente do período." : null,
    comparison.successRateDelta !== null && comparison.successRateDelta <= -5 ? "A taxa de sucesso caiu 5 pontos percentuais ou mais na metade mais recente." : null,
  ].filter((alert): alert is string => Boolean(alert));
  if (!alerts.length) return null;
  return <Card className="mb-6 border border-[#F3D5BF] bg-[#FFF8F2] shadow-sm"><CardContent className="flex gap-3 p-5"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#BD6338]" /><div><p className="text-sm font-semibold text-[#472C1A]">Atenção operacional</p><ul className="mt-2 space-y-1 text-xs leading-5 text-[#89542C]">{alerts.map((alert) => <li key={alert}>{alert}</li>)}</ul></div></CardContent></Card>;
}

function ComparisonStrip({ comparison, loading }: { comparison?: PeriodComparison | null; loading: boolean }) {
  if (!loading && !comparison) return null;
  const value = (amount: number | null | undefined, suffix = "%") => amount == null ? "Sem base" : `${amount > 0 ? "+" : ""}${amount.toLocaleString("pt-BR")}${suffix}`;
  const percentagePoints = (amount: number | null | undefined) => amount == null ? "Sem base" : `${amount > 0 ? "+" : ""}${amount.toLocaleString("pt-BR")} ${Math.abs(amount) === 1 ? "ponto percentual" : "pontos percentuais"}`;
  const tone = (amount: number | null | undefined, inverse = false) => amount == null ? "text-[#667085]" : (amount > 0) !== inverse ? "text-[#BD6338]" : "text-[#258B57]";
  return <Card className="mb-6 border-0 bg-[#EEF3FF] shadow-sm"><CardContent className="grid gap-4 p-5 md:grid-cols-[1.4fr_repeat(3,1fr)] md:items-center"><div><p className="text-sm font-semibold text-[#11183D]">Comparação dentro do período</p><p className="mt-1 text-xs text-[#667085]">Metade mais recente versus a metade anterior.</p></div><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#667085]">Execuções</p><p className={`mt-1 text-lg font-semibold ${tone(comparison?.executionsDelta)}`}>{loading ? "…" : value(comparison?.executionsDelta)}</p></div><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#667085]">Falhas</p><p className={`mt-1 text-lg font-semibold ${tone(comparison?.errorsDelta)}`}>{loading ? "…" : value(comparison?.errorsDelta)}</p></div><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#667085]">Taxa de sucesso</p><p className={`mt-1 text-lg font-semibold ${tone(comparison?.successRateDelta, true)}`}>{loading ? "…" : percentagePoints(comparison?.successRateDelta)}</p></div></CardContent></Card>;
}

function AnalyticsPage() {
  const { user } = useAuth();
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(() => readPreferredRefreshSeconds() * 1000);
  const [period, setPeriod] = useState<Period>(() => readScopedPeriod("analytics"));
  const data = trpc.n8n.analytics.useQuery({ period }, { enabled: Boolean(user), retry: false, placeholderData: (previous) => previous, refetchInterval: refreshIntervalMs });
  const dashboard = data.data;
  const initialLoading = data.isPending && !data.data;

  const refresh = () => data.refetch().then(() => toast.success("Analytics atualizado"));
  useEffect(() => saveScopedPeriod("analytics", period), [period]);
  useEffect(() => {
    const syncPreferences = () => {
      setRefreshIntervalMs(readPreferredRefreshSeconds() * 1000);
      setPeriod(readScopedPeriod("analytics"));
    };
    window.addEventListener(PREFERENCES_UPDATED_EVENT, syncPreferences);
    return () => window.removeEventListener(PREFERENCES_UPDATED_EVENT, syncPreferences);
  }, []);

  return (
    <OperationsShell>
      <div className="min-h-[calc(100vh-86px)] bg-[#F5F7FB] px-5 py-7 md:px-9">
        <div className="mx-auto max-w-[1450px]">
          <AnalyticsAlerts comparison={dashboard?.comparison} />
          <Header title="Analytics" description="Tendências reais de volume, sucesso, duração e desempenho por workflow." period={period} setPeriod={setPeriod} refresh={refresh} loading={data.isFetching} />
          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <Metric title="Execuções" value={String(dashboard?.summary?.executions ?? 0)} loading={initialLoading} />
            <Metric title="Taxa de sucesso" value={dashboard?.summary?.successRate != null ? `${dashboard.summary.successRate}%` : "—"} loading={initialLoading} />
            <Metric title="Falhas" value={String(dashboard?.summary?.errors ?? 0)} loading={initialLoading} />
            <Metric title="Tempo médio" value={dashboard?.summary?.averageDuration != null ? `${dashboard.summary.averageDuration}s` : "—"} loading={initialLoading} />
            <Metric title="Tempo típico" value={dashboard?.summary?.p50Duration != null ? `${dashboard.summary.p50Duration}s` : "—"} loading={initialLoading} />
            <Metric title="Tempo em execuções lentas" value={dashboard?.summary?.p95Duration != null ? `${dashboard.summary.p95Duration}s` : "—"} loading={initialLoading} />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
            <Card className="border-0 bg-white shadow-sm">
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4 text-[#4355D8]" />Tendência de execuções</CardTitle></CardHeader>
              <CardContent><div className="h-[300px]">{(dashboard?.trend?.length ?? 0) > 0 ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={[...(dashboard?.trend ?? [])].reverse()}><CartesianGrid vertical={false} stroke="#eef0f6" /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Area dataKey="total" stroke="#19D3C5" fill="none" /><Area dataKey="success" stroke="#4355D8" fill="#E8ECFF" /><Area dataKey="errors" stroke="#f0a55d" fill="#fff2d5" /></AreaChart></ResponsiveContainer> : <Empty text={initialLoading ? "Carregando telemetria..." : "Sem dados no período"} />}</div></CardContent>
            </Card>
            <Card className="border-0 bg-white shadow-sm">
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Workflow className="h-4 w-4 text-[#19D3C5]" />Top workflows por volume</CardTitle></CardHeader>
              <CardContent><div className="h-[300px]">{(dashboard?.workflowStats?.length ?? 0) > 0 ? <ResponsiveContainer width="100%" height="100%"><BarChart data={(dashboard?.workflowStats ?? []).slice(0, 8)} layout="vertical" margin={{ left: 20 }}><CartesianGrid horizontal={false} stroke="#eef0f6" /><XAxis type="number" tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="executions" fill="#4355D8" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer> : <Empty text={initialLoading ? "Carregando workflows..." : "Nenhum workflow com execuções"} />}</div></CardContent>
            </Card>
          </div>

          <div className="mt-6"><ComparisonStrip comparison={dashboard?.comparison} loading={initialLoading} /></div>

          <div className="mb-6 grid gap-4 md:grid-cols-3">
            <Metric title="Workflows com meta" value={String(dashboard?.sloSummary?.configured ?? 0)} loading={initialLoading} />
            <Metric title="Dentro da meta" value={String(dashboard?.sloSummary?.met ?? 0)} loading={initialLoading} />
            <Metric title="Fora da meta" value={String(dashboard?.sloSummary?.breached ?? 0)} loading={initialLoading} />
          </div>
          <SloBudgetPanel workflows={dashboard?.workflowStats ?? []} loading={initialLoading} />

          <Card className="border-0 bg-white shadow-sm">
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4 text-[#4355D8]" />Desempenho por workflow</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="hidden gap-4 border-t px-6 py-3 text-[10px] font-bold uppercase tracking-[.14em] text-[#a0a7bd] md:grid md:grid-cols-[minmax(250px,1.6fr)_repeat(6,minmax(85px,.45fr))]"><span>Workflow</span><span className="text-center">Execuções</span><span className="text-center">Erros</span><span className="text-center">Sucesso</span><span className="text-center">Tempo médio</span><span className="text-center">Tempo típico</span><span className="text-center">Tempo em execuções lentas</span></div>
              <div className="divide-y">{(dashboard?.workflowStats ?? []).map((workflow) => <div key={workflow.id} className="grid gap-3 px-6 py-4 md:grid-cols-[minmax(250px,1.6fr)_repeat(6,minmax(85px,.45fr))] md:items-center"><span className="text-sm font-semibold">{workflow.name}</span><span className="justify-self-center text-center text-xs text-[#667085]">{workflow.executions}</span><span className="justify-self-center text-center text-xs text-[#bd6338]">{workflow.errors}</span><span className="justify-self-center text-center text-xs text-[#258b57]">{workflow.successRate != null ? `${workflow.successRate}%` : "—"}</span><span className="justify-self-center text-center text-xs text-[#667085]">{workflow.averageDuration != null ? `${workflow.averageDuration}s` : "—"}</span><span className="justify-self-center text-center text-xs text-[#667085]">{workflow.p50Duration != null ? `${workflow.p50Duration}s` : "—"}</span><span className="justify-self-center text-center text-xs text-[#667085]">{workflow.p95Duration != null ? `${workflow.p95Duration}s` : "—"}</span></div>)}</div>
            </CardContent>
          </Card>
          <NodeAnalytics dashboard={dashboard} loading={initialLoading} />
        </div>
      </div>
    </OperationsShell>
  );
}

function NodeAnalytics({ dashboard, loading }: { dashboard: any; loading: boolean }) {
  return <Card className="mt-6 border-0 bg-white shadow-sm">
    <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Timer className="h-4 w-4 text-[#4355D8]" />Desempenho por node</CardTitle><p className="text-xs text-[#667085]">Baseado em {Number(dashboard?.nodeAnalyticsCoverage ?? 0).toLocaleString("pt-BR")} execuções com detalhes preservados.</p></CardHeader>
    <CardContent className="overflow-x-auto p-0">
      <div className="hidden min-w-[1180px] border-t px-6 py-3 text-[10px] font-bold uppercase tracking-[.14em] text-[#a0a7bd] md:grid md:grid-cols-[1.4fr_1.1fr_repeat(8,.55fr)]"><span>Node</span><span>Workflow</span><span className="text-center">Execuções</span><span className="text-center">Falhas</span><span className="text-center">Taxa de falha</span><span className="text-center">Tempo médio</span><span className="text-center">Tempo típico</span><span className="text-center">Execuções lentas</span><span className="text-center">Tempo do workflow</span><span className="text-center">Itens</span></div>
      <div className="divide-y">
        {(dashboard?.nodeStats ?? []).slice(0, 20).map((node: any) => (
          <div key={`${node.workflowId}-${node.nodeName}`} className="grid gap-2 px-6 py-4 text-xs md:min-w-[1180px] md:grid-cols-[1.4fr_1.1fr_repeat(8,.55fr)] md:items-center">
            <span className="font-semibold text-[#11183D]">{node.nodeName}</span>
            <span className="truncate text-[#667085]">{node.workflowName}</span>
            <span className="text-center">{node.runs}</span>
            <span className="text-center text-[#BD6338]">{node.errors}</span>
            <span className="text-center">{node.errorRate}%</span>
            <span className="text-center">{node.averageMs != null ? `${node.averageMs}ms` : "—"}</span>
            <span className="text-center">{node.p50Ms != null ? `${node.p50Ms}ms` : "—"}</span>
            <span className="text-center">{node.p95Ms != null ? `${node.p95Ms}ms` : "—"}</span>
            <span className="text-center">{node.workflowTimeShare}%</span>
            <span className="text-center">{Number(node.outputItems ?? 0).toLocaleString("pt-BR")}</span>
          </div>
        ))}
        {(dashboard?.nodeStats?.length ?? 0) === 0 ? <Empty text={loading ? "Calculando nodes..." : "Os dados aparecerão conforme os detalhes forem preservados"} /> : null}
      </div>
    </CardContent>
  </Card>;
}

function SloBudgetPanel({ workflows, loading }: { workflows: any[]; loading: boolean }) {
  const configured = workflows.filter((workflow) => workflow.slo?.enabled);
  if (!loading && configured.length === 0) return null;
  return <Card className="mb-6 border-0 bg-white shadow-sm"><CardHeader><CardTitle className="text-base">Margem de falhas por workflow</CardTitle><p className="text-xs text-[#667085]">Mostra quantas falhas a meta ainda tolera no período selecionado.</p></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">{configured.map((workflow) => {
    const consumed = Number(workflow.errorBudget?.consumedPercent ?? 0);
    const breached = workflow.sloStatus === "breached";
    return <div key={workflow.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{workflow.name}</p><p className="mt-1 text-xs text-[#667085]">Meta de {workflow.slo.successRateTarget}% de sucesso</p></div><Badge variant="outline" className={breached ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}>{breached ? "Fora da meta" : "Dentro da meta"}</Badge></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[#E8ECF5]"><div className={`h-full rounded-full ${breached ? "bg-red-500" : consumed >= 75 ? "bg-amber-500" : "bg-[#4355D8]"}`} style={{ width: `${Math.min(100, consumed)}%` }} /></div><div className="mt-3 flex justify-between text-xs text-[#667085]"><span>{consumed.toLocaleString("pt-BR")}% da margem utilizada</span><span>{workflow.errorBudget?.remainingFailures ?? 0} falha(s) ainda tolerada(s)</span></div></div>;
  })}{loading ? <div className="h-28 animate-pulse rounded-xl bg-[#eef0f6]" /> : null}</CardContent></Card>;
}

function ErrorsPage() {
  const { user } = useAuth();
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(() => readPreferredRefreshSeconds() * 1000);
  const [period, setPeriod] = useState<Period>(() => readScopedPeriod("errors"));
  const [errorPage, setErrorPage] = useState(1);
  const [errorPageSize, setErrorPageSize] = useState(() => readPreferredPageSize(50));
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<any | null>(null);
  const data = trpc.n8n.analytics.useQuery({ period }, { enabled: Boolean(user), retry: false, placeholderData: (previous) => previous, refetchInterval: refreshIntervalMs });
  const dashboard = data.data;
  const initialLoading = data.isPending && !data.data;
  const recentErrors = dashboard?.recentErrors ?? [];
  const totalErrorPages = Math.max(1, Math.ceil(recentErrors.length / errorPageSize));
  const currentErrorPage = Math.min(errorPage, totalErrorPages);
  const visibleErrors = recentErrors.slice((currentErrorPage - 1) * errorPageSize, currentErrorPage * errorPageSize);
  const refresh = () => data.refetch().then(() => toast.success("Erros atualizados"));

  useEffect(() => saveScopedPeriod("errors", period), [period]);
  useEffect(() => {
    const syncPreferences = () => {
      setRefreshIntervalMs(readPreferredRefreshSeconds() * 1000);
      setPeriod(readScopedPeriod("errors"));
      setErrorPageSize(readPreferredPageSize(50));
      setErrorPage(1);
    };
    window.addEventListener(PREFERENCES_UPDATED_EVENT, syncPreferences);
    return () => window.removeEventListener(PREFERENCES_UPDATED_EVENT, syncPreferences);
  }, []);

  return (
    <OperationsShell>
      <div className="min-h-[calc(100vh-86px)] bg-[#F5F7FB] px-5 py-7 md:px-9">
        <div className="mx-auto max-w-[1450px]">
          <Header title="Erros" description="Falhas reais, workflows críticos e acesso direto ao detalhe técnico da execução." period={period} setPeriod={(value) => { setPeriod(value); setErrorPage(1); }} refresh={refresh} loading={data.isFetching} />
          <div className="grid gap-4 md:grid-cols-3"><Metric title="Falhas no período" value={String(dashboard?.summary?.errors ?? 0)} loading={initialLoading} /><Metric title="Taxa de sucesso" value={dashboard?.summary?.successRate != null ? `${dashboard.summary.successRate}%` : "—"} loading={initialLoading} /><Metric title="Workflows com falha" value={String((dashboard?.workflowStats ?? []).filter((workflow) => workflow.errors > 0).length)} loading={initialLoading} /></div>
          <Card className="mt-6 border-0 bg-white shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-[#bd6338]" />Incidentes agrupados por causa provável</CardTitle><p className="text-xs text-[#667085]">Clique em um grupo para reconhecer, atribuir, investigar ou resolver o incidente.</p></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{(dashboard?.incidentGroups ?? []).slice(0, 9).map((incident: any) => <button key={incident.fingerprint} type="button" onClick={() => setSelectedIncident(incident)} className="rounded-xl border border-[#F3D5BF] bg-[#FFF8F2] p-4 text-left transition hover:border-[#BD6338]"><div className="flex items-start justify-between gap-3"><p className="text-sm font-semibold text-[#472C1A]">{incident.automation}</p><Badge className="shrink-0 bg-[#FFF0E7] text-[#bd6338]">{incident.count} falha(s)</Badge></div><p className="mt-2 truncate text-xs font-medium text-[#89542C]">Causa provável: {incident.cause}</p><p className="mt-1 text-xs text-[#667085]">Status: {incident.lifecycle?.status || "new"} · Última ocorrência: {incident.lastAt ? new Date(incident.lastAt).toLocaleString("pt-BR") : "-"}</p></button>)}{(dashboard?.incidentGroups?.length ?? 0) === 0 && <Empty text={initialLoading ? "Carregando incidentes..." : "Nenhum incidente neste período"} />}</CardContent></Card>
          <div className="mt-6 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
            <Card className="border-0 bg-white shadow-sm">
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-[#bd6338]" />Falhas recentes</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">{visibleErrors.map((error) => <div key={error.id} className="grid gap-3 px-6 py-4 md:grid-cols-[1.5fr_.8fr_.5fr_auto] md:items-center"><div><p className="text-sm font-semibold">{error.sectionName || error.workflowName}</p><p className="mt-1 text-xs text-[#98A2B3]">Workflow: {error.workflowName} · #{error.id} · {error.startedAt ? new Date(error.startedAt).toLocaleString("pt-BR") : "—"}</p></div><Badge className="w-fit bg-[#fff0e7] text-[#bd6338]">Erro</Badge><span className="text-xs text-[#667085]">{error.duration != null ? `${error.duration}s` : "—"}</span><Button variant="outline" size="sm" onClick={() => setSelected(error.id)}><Eye className="mr-2 h-3.5 w-3.5" />Ver detalhes</Button></div>)}{recentErrors.length === 0 && <Empty text={initialLoading ? "Carregando falhas..." : "Nenhuma falha neste período"} />}</div>
                {recentErrors.length > 0 ? <div className="flex flex-col gap-3 border-t px-6 py-4 text-xs text-[#667085] md:flex-row md:items-center md:justify-between"><span>Mostrando {(currentErrorPage - 1) * errorPageSize + 1}-{Math.min(currentErrorPage * errorPageSize, recentErrors.length)} de {recentErrors.length} falhas</span><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={currentErrorPage <= 1} onClick={() => setErrorPage((value) => Math.max(1, value - 1))}>Anterior</Button><span>Página {currentErrorPage} de {totalErrorPages}</span><Button variant="outline" size="sm" disabled={currentErrorPage >= totalErrorPages} onClick={() => setErrorPage((value) => Math.min(totalErrorPages, value + 1))}>Próxima</Button></div></div> : null}
              </CardContent>
            </Card>
            <Card className="border-0 bg-white shadow-sm"><CardHeader><CardTitle className="text-base">Workflows críticos</CardTitle></CardHeader><CardContent className="space-y-3">{(dashboard?.workflowStats ?? []).filter((workflow) => workflow.errors > 0).sort((a, b) => b.errors - a.errors).slice(0, 10).map((workflow, index) => <div key={workflow.id} className="rounded-xl bg-[#F5F7FB] p-4"><div className="flex items-center justify-between"><p className="text-sm font-semibold">{index + 1}. {workflow.name}</p><Badge className="bg-[#fff0e7] text-[#bd6338]">{workflow.errors} erros</Badge></div><div className="mt-2 flex gap-4 text-xs text-[#667085]"><span>{workflow.executions} execuções</span><span>{workflow.successRate ?? 0}% sucesso</span></div></div>)}</CardContent></Card>
          </div>
        </div>
      </div>
      <ExecutionDetailDialog executionId={selected} open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)} />
      <IncidentLifecycleDialog incident={selectedIncident} open={Boolean(selectedIncident)} onOpenChange={(open) => !open && setSelectedIncident(null)} onOpenExecution={(id) => { setSelectedIncident(null); setSelected(id); }} />
    </OperationsShell>
  );
}

function Metric({ title, value, loading = false }: { title: string; value: string; loading?: boolean }) {
  return <Card className="border-0 bg-white shadow-sm"><CardContent className="p-5"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#667085]">{title}</p>{loading ? <MetricSkeleton /> : <p className="mt-2 text-3xl font-semibold text-[#11183D]">{value}</p>}</CardContent></Card>;
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full min-h-40 items-center justify-center text-sm text-[#98A2B3]">{text}</div>;
}
