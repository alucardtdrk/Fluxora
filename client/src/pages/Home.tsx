import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, DatabaseZap, Play, RefreshCw, Workflow, XCircle, Zap } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import OperationsShell from "@/components/OperationsShell";
import { MetricSkeleton } from "@/components/MetricSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PREFERENCES_UPDATED_EVENT, readFocusWorkflows, readPreferredRefreshSeconds, readScopedPeriod, saveFocusWorkflows, saveScopedPeriod, type DashboardPeriod } from "@/lib/preferences";
import { trpc } from "@/lib/trpc";

type Period = DashboardPeriod;
const periods: [Period, string][] = [["today", "Hoje"], ["7d", "7 dias"], ["30d", "30 dias"], ["90d", "90 dias"], ["all", "Todas as execuções"]];

function Metric({ title, value, detail, icon: Icon, loading = false }: { title: string; value: string; detail: string; icon: any; loading?: boolean }) {
  return <Card className="border-0 bg-white shadow-sm"><CardContent className="p-5"><div className="flex justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#667085]">{title}</p>{loading ? <MetricSkeleton /> : <p className="mt-2 text-3xl font-semibold text-[#11183D]">{value}</p>}<p className="mt-1 text-xs text-[#98A2B3]">{detail}</p></div><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#EEF1FF] text-[#4355D8]"><Icon className="h-4 w-4" /></div></div></CardContent></Card>;
}

export default function Home() {
  const { user } = useAuth();
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(() => readPreferredRefreshSeconds() * 1000);
  const [period, setPeriod] = useState<Period>(() => readScopedPeriod("home"));
  const [focusIds, setFocusIds] = useState<string[]>(() => readFocusWorkflows());
  const workflows = trpc.n8n.workflows.useQuery(undefined, { enabled: Boolean(user), retry: false });
  const overview = trpc.n8n.overview.useQuery({ period, workflowIds: focusIds }, { enabled: Boolean(user), retry: false, placeholderData: (previous) => previous, refetchInterval: refreshIntervalMs });
  const m = overview.data?.metrics;
  const initialLoading = overview.isPending && !overview.data;

  useEffect(() => saveFocusWorkflows(focusIds), [focusIds]);
  useEffect(() => saveScopedPeriod("home", period), [period]);
  useEffect(() => {
    const syncPreferences = () => {
      setRefreshIntervalMs(readPreferredRefreshSeconds() * 1000);
      setPeriod(readScopedPeriod("home"));
      setFocusIds(readFocusWorkflows());
    };
    window.addEventListener(PREFERENCES_UPDATED_EVENT, syncPreferences);
    return () => window.removeEventListener(PREFERENCES_UPDATED_EVENT, syncPreferences);
  }, []);

  const focus = useMemo(() => {
    const stats = overview.data?.workflowStats ?? [];
    if (focusIds.length) return stats.filter((s: any) => focusIds.includes(s.id));
    return stats.filter((s: any) => s.errors > 0).sort((a: any, b: any) => b.errors - a.errors).slice(0, 4);
  }, [overview.data, focusIds]);

  const addFocus = (id: string) => {
    if (id === "__all__") {
      setFocusIds((workflows.data?.items ?? []).map((w: any) => w.id));
      return;
    }
    setFocusIds((value) => value.includes(id) ? value : [...value, id]);
  };
  const removeFocus = (id: string) => setFocusIds((value) => value.filter((x) => x !== id));
  const refresh = async () => { await Promise.all([overview.refetch(), workflows.refetch()]); toast.success("Dados atualizados"); };

  const total = m?.executions ?? 0;
  const success = m?.success ?? 0;
  const successPct = m?.successRate ?? 0;
  const errorCount = m?.errors ?? 0;
  const running = m?.running ?? 0;
  const waiting = m?.waiting ?? 0;
  const canceled = m?.canceled ?? 0;

  return <OperationsShell><div className="mx-auto max-w-[1480px] px-5 py-7 md:px-9">
    <div className="mb-8 flex flex-col justify-between gap-5 xl:flex-row xl:items-end"><div><span className="rounded-full bg-[#def8f7] px-3 py-1 text-[10px] font-bold uppercase tracking-[.14em] text-[#19D3C5]">Live operations</span><h2 className="mt-4 text-[42px] font-semibold tracking-[-.06em] text-[#11183D]">Tudo sob controle.</h2><p className="mt-2 text-sm text-[#667085]">Monitore o ambiente e escolha os workflows que quer manter em foco.</p></div><div className="flex flex-wrap gap-2"><div className="flex flex-wrap rounded-xl border bg-white p-1">{periods.map(([value, label]) => <button key={value} onClick={() => setPeriod(value)} className={`rounded-lg px-3 py-2 text-xs font-semibold ${period === value ? "bg-[#11183D] text-white" : "text-[#667085]"}`}>{label}</button>)}</div><Button onClick={refresh} variant="outline"><RefreshCw className={`mr-2 h-4 w-4 ${overview.isFetching ? "animate-spin" : ""}`} />Atualizar</Button></div></div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-7"><Metric title="Workflows" value={String(m?.workflows ?? 0)} detail={focusIds.length ? "em foco" : "total"} icon={Workflow} loading={initialLoading} /><Metric title="Ativos" value={String(m?.active ?? 0)} detail="em operação" icon={Zap} loading={initialLoading} /><Metric title="Execuções" value={String(total)} detail={periods.find((p) => p[0] === period)?.[1] || ""} icon={Play} loading={initialLoading} /><Metric title="Sucesso" value={m?.successRate != null ? `${m.successRate}%` : "—"} detail="taxa" icon={CheckCircle2} loading={initialLoading} /><Metric title="Erros" value={String(errorCount)} detail="falhas" icon={XCircle} loading={initialLoading} /><Metric title="Em andamento" value={String(running)} detail="agora" icon={Clock3} loading={initialLoading} /><Metric title="n8n" value={initialLoading ? "Verificando…" : overview.data?.connected ? "Online" : "Offline"} detail={initialLoading ? "conectando" : "conexão"} icon={DatabaseZap} /></div>

    <div className="mt-6 grid gap-6 xl:grid-cols-[1.5fr_1fr]"><Card className="border-0 bg-white shadow-sm"><CardHeader><CardTitle className="text-base">Execuções por período</CardTitle><p className="text-xs text-[#667085]">{focusIds.length ? `Gráfico filtrado por ${focusIds.length} workflow(s) em foco.` : "Todos os workflows consultados."}</p></CardHeader><CardContent><div className="h-[280px]">{(overview.data?.chart?.length ?? 0) > 0 ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={overview.data?.chart}><CartesianGrid vertical={false} stroke="#eef0f6" /><XAxis dataKey="day" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Area dataKey="total" stroke="#19D3C5" fill="none" /><Area dataKey="sucesso" stroke="#4355D8" fill="#E8ECFF" /><Area dataKey="erro" stroke="#f0a55d" fill="#fff2d5" /></AreaChart></ResponsiveContainer> : <div className="grid h-full place-items-center text-sm text-[#98A2B3]">{initialLoading ? "Carregando telemetria…" : "Sem telemetria."}</div>}</div></CardContent></Card><Card className="border-0 bg-[#11183D] text-white shadow-sm"><CardContent className="p-6"><p className="text-sm font-semibold">Saúde das automações</p><p className="mt-6 text-6xl font-semibold tracking-[-.07em]">{initialLoading ? "…" : m?.health != null ? `${m.health}%` : "—"}</p><p className="mt-3 text-sm text-[#B8C2E3]">Indicador consolidado das execuções consultadas.</p>{overview.data?.truncated && <div className="mt-6 rounded-xl bg-white/10 p-3 text-xs text-[#E8ECFF]">Histórico limitado por N8N_MAX_PAGES.</div>}</CardContent></Card></div>

    <div className="mt-6 grid gap-6 xl:grid-cols-2">
      <Card className="border-0 bg-white shadow-sm"><CardHeader><CardTitle className="text-base">Distribuição por status</CardTitle><p className="text-xs text-[#667085]">Composição das execuções consultadas no período.</p></CardHeader><CardContent><div className="grid gap-6 md:grid-cols-[1.2fr_.8fr] md:items-center"><div><div className="flex h-12 overflow-hidden rounded-full bg-[#edf0f7]">{total > 0 && <><div className="bg-[#4355D8]" style={{ width: `${(success / total) * 100}%` }} /><div className="bg-[#f0a55d]" style={{ width: `${(errorCount / total) * 100}%` }} /><div className="bg-[#19D3C5]" style={{ width: `${(running / total) * 100}%` }} /><div className="bg-[#98A2B3]" style={{ width: `${(waiting / total) * 100}%` }} /><div className="bg-[#c4cadc]" style={{ width: `${(canceled / total) * 100}%` }} /></>}</div><div className="mt-5 flex justify-between text-xs text-[#667085]"><span>{successPct}% sucesso</span><span>{total} execuções</span></div></div><div className="space-y-3 text-sm text-[#667085]"><div className="flex items-center justify-between"><span><i className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-[#4355D8]"/>Sucesso</span><b>{successPct}%</b></div><div className="flex items-center justify-between"><span><i className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-[#f0a55d]"/>Falhas</span><b>{errorCount}</b></div><div className="flex items-center justify-between"><span><i className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-[#19D3C5]"/>Em andamento</span><b>{running}</b></div><div className="flex items-center justify-between"><span><i className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-[#98A2B3]"/>Aguardando</span><b>{waiting}</b></div><div className="flex items-center justify-between"><span><i className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-[#c4cadc]"/>Canceladas</span><b>{canceled}</b></div></div></div></CardContent></Card>
      <Card className="border-0 bg-white shadow-sm"><CardHeader><CardTitle className="text-base">Tempo das execuções</CardTitle><p className="text-xs text-[#667085]">Compare o tempo médio, o comportamento típico e as execuções mais lentas.</p></CardHeader><CardContent><div className="flex min-h-[190px] items-center rounded-[24px] bg-[#F5F7FB] px-8"><div>{initialLoading ? <MetricSkeleton className="h-12 w-28" /> : <p className="text-5xl font-semibold tracking-[-.06em] text-[#11183D]">{m?.averageDuration != null ? `${m.averageDuration}s` : "—"}</p>}<p className="mt-3 text-sm text-[#667085]">tempo médio no período selecionado</p><div className="mt-5 flex gap-6 text-xs"><span><b className="block text-sm text-[#11183D]">{m?.p50Duration != null ? `${m.p50Duration}s` : "—"}</b><span className="text-[#667085]">tempo típico</span></span><span><b className="block text-sm text-[#11183D]">{m?.p95Duration != null ? `${m.p95Duration}s` : "—"}</b><span className="text-[#667085]">execuções lentas</span></span></div></div></div></CardContent></Card>
    </div>

    <Card className="mt-6 border-0 bg-white shadow-sm"><CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><CardTitle className="text-base">Workflows em foco</CardTitle><p className="mt-1 text-xs text-[#667085]">Escolha manualmente os fluxos que deseja acompanhar. O gráfico e os indicadores acima acompanham essa seleção.</p></div><Select onValueChange={addFocus}><SelectTrigger className="w-[300px]"><SelectValue placeholder="Adicionar workflow ao foco" /></SelectTrigger><SelectContent><SelectItem value="__all__">Todos os workflows</SelectItem>{(workflows.data?.items ?? []).filter((w: any) => !focusIds.includes(w.id)).map((w: any) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></CardHeader><CardContent className="p-0"><div className="hidden gap-4 border-t px-6 py-3 text-[10px] font-bold uppercase tracking-[.14em] text-[#a0a7bd] md:grid md:grid-cols-[minmax(300px,1.6fr)_minmax(120px,.55fr)_minmax(120px,.55fr)_minmax(110px,.5fr)_minmax(110px,.5fr)]"><span>Workflow</span><span className="text-center">Execuções</span><span className="text-center">Sucesso</span><span className="text-center">Erros</span><span className="text-right">Ação</span></div><div className="divide-y">{focus.map((w: any) => <div key={w.id} className="grid gap-3 px-6 py-4 md:grid-cols-[minmax(300px,1.6fr)_minmax(120px,.55fr)_minmax(120px,.55fr)_minmax(110px,.5fr)_minmax(110px,.5fr)] md:items-center"><div><p className="text-sm font-semibold">{w.name}</p><p className="mt-1 text-xs text-[#98A2B3]">{w.active ? "Ativo" : "Inativo"} · última: {w.lastExecutionAt ? new Date(w.lastExecutionAt).toLocaleString("pt-BR") : "—"}</p></div><span className="justify-self-center text-center text-xs">{w.executions}</span><span className="justify-self-center text-center text-xs text-[#258b57]">{w.successRate != null ? `${w.successRate}%` : "—"}</span><Badge className={w.errors ? "w-fit justify-self-center bg-[#fff0e7] text-[#bd6338]" : "w-fit justify-self-center bg-[#e3f6eb] text-[#258b57]"}>{w.errors}</Badge><div className="justify-self-end">{focusIds.length > 0 && <Button variant="ghost" size="sm" onClick={() => removeFocus(w.id)}>Remover</Button>}</div></div>)}{focus.length === 0 && <div className="py-12 text-center text-sm text-[#98A2B3]">Selecione um workflow para acompanhar aqui.</div>}</div></CardContent></Card>
  </div></OperationsShell>;
}
