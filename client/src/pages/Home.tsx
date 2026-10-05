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
  return <Card className="border-0 bg-card shadow-sm"><CardContent className="p-5"><div className="flex justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">{title}</p>{loading ? <MetricSkeleton /> : <p className="mt-2 text-3xl font-semibold text-foreground">{value}</p>}<p className="mt-1 text-xs text-muted-foreground">{detail}</p></div><div className="grid h-10 w-10 place-items-center rounded-xl bg-feedback-info-surface text-feedback-info"><Icon className="h-4 w-4" /></div></div></CardContent></Card>;
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
    <div className="mb-8 flex flex-col justify-between gap-5 xl:flex-row xl:items-end"><div><span className="rounded-full bg-feedback-info-surface px-3 py-1 text-[10px] font-bold uppercase tracking-[.14em] text-feedback-info">Live operations</span><h2 className="mt-4 text-[42px] font-semibold tracking-[-.06em] text-foreground">Tudo sob controle.</h2><p className="mt-2 text-sm text-muted-foreground">Monitore o ambiente e escolha os workflows que quer manter em foco.</p></div><div className="flex flex-wrap gap-2"><div className="flex flex-wrap rounded-xl border bg-card p-1">{periods.map(([value, label]) => <button key={value} onClick={() => setPeriod(value)} className={`rounded-lg px-3 py-2 text-xs font-semibold ${period === value ? "bg-foreground text-background" : "text-muted-foreground"}`}>{label}</button>)}</div><Button onClick={refresh} variant="outline" disabled={overview.isFetching || workflows.isFetching} aria-busy={overview.isFetching || workflows.isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${overview.isFetching || workflows.isFetching ? "animate-spin" : ""}`} />{overview.isFetching || workflows.isFetching ? "Atualizando…" : "Atualizar"}</Button></div></div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-7"><Metric title="Workflows" value={String(m?.workflows ?? 0)} detail={focusIds.length ? "em foco" : "total"} icon={Workflow} loading={initialLoading} /><Metric title="Ativos" value={String(m?.active ?? 0)} detail="em operação" icon={Zap} loading={initialLoading} /><Metric title="Execuções" value={String(total)} detail={periods.find((p) => p[0] === period)?.[1] || ""} icon={Play} loading={initialLoading} /><Metric title="Sucesso" value={m?.successRate != null ? `${m.successRate}%` : "—"} detail="taxa" icon={CheckCircle2} loading={initialLoading} /><Metric title="Erros" value={String(errorCount)} detail="falhas" icon={XCircle} loading={initialLoading} /><Metric title="Em andamento" value={String(running)} detail="agora" icon={Clock3} loading={initialLoading} /><Metric title="n8n" value={initialLoading ? "Verificando…" : overview.data?.connected ? "Online" : "Offline"} detail={initialLoading ? "conectando" : "conexão"} icon={DatabaseZap} /></div>

    <div className="mt-6 grid gap-6 xl:grid-cols-[1.5fr_1fr]"><Card className="border-0 bg-card shadow-sm"><CardHeader><CardTitle className="text-base">Execuções por período</CardTitle><p className="text-xs text-muted-foreground">{focusIds.length ? `Gráfico filtrado por ${focusIds.length} workflow(s) em foco.` : "Todos os workflows consultados."}</p></CardHeader><CardContent><div className="h-[280px]">{(overview.data?.chart?.length ?? 0) > 0 ? <ResponsiveContainer width="100%" height="100%"><AreaChart accessibilityLayer data={overview.data?.chart} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="executions-total-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--feedback-info)" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="var(--feedback-info)" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="executions-success-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--feedback-success)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--feedback-success)" stopOpacity={0.04} />
                </linearGradient>
                <linearGradient id="executions-error-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--feedback-error)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--feedback-error)" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" strokeOpacity={0.6} />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
              <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip cursor={false} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--foreground)", padding: "12px 16px", boxShadow: "0 8px 24px rgb(0 0 0 / 0.15)" }} labelStyle={{ color: "var(--foreground)", fontWeight: 600, borderBottom: "1px solid var(--border)", paddingBottom: 8, marginBottom: 8 }} itemStyle={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }} formatter={(value, name) => [Number(value).toLocaleString("pt-BR"), name]} />
              <Area name="Total" dataKey="total" type="monotone" stroke="var(--feedback-info)" strokeWidth={2} fill="url(#executions-total-gradient)" />
              <Area name="Sucesso" dataKey="sucesso" type="monotone" stroke="var(--feedback-success)" strokeWidth={2} fill="url(#executions-success-gradient)" />
              <Area name="Erros" dataKey="erro" type="monotone" stroke="var(--feedback-error)" strokeWidth={2} fill="url(#executions-error-gradient)" />
            </AreaChart></ResponsiveContainer> : <div className="grid h-full place-items-center text-sm text-muted-foreground">{initialLoading ? "Carregando telemetria…" : "Sem telemetria."}</div>}</div></CardContent></Card><Card className="border-0 bg-code-background text-code-foreground shadow-sm"><CardContent className="p-6"><p className="text-sm font-semibold">Saúde das automações</p><p className="mt-6 text-6xl font-semibold tracking-[-.07em]">{initialLoading ? "…" : m?.health != null ? `${m.health}%` : "—"}</p><p className="mt-3 text-sm text-code-foreground/80">Indicador consolidado das execuções consultadas.</p>{overview.data?.truncated && <div className="mt-6 rounded-xl bg-card/10 p-3 text-xs text-code-foreground">Histórico limitado por N8N_MAX_PAGES.</div>}</CardContent></Card></div>

    <div className="mt-6 grid gap-6 xl:grid-cols-2">
      <Card className="border-0 bg-card shadow-sm"><CardHeader><CardTitle className="text-base">Distribuição por status</CardTitle><p className="text-xs text-muted-foreground">Composição das execuções consultadas no período.</p></CardHeader><CardContent><div className="grid gap-6 md:grid-cols-[1.2fr_.8fr] md:items-center"><div><div className="flex h-12 overflow-hidden rounded-full bg-muted">{total > 0 && <><div className="bg-primary" style={{ width: `${(success / total) * 100}%` }} /><div className="bg-feedback-error" style={{ width: `${(errorCount / total) * 100}%` }} /><div className="bg-feedback-info" style={{ width: `${(running / total) * 100}%` }} /><div className="bg-muted-foreground" style={{ width: `${(waiting / total) * 100}%` }} /><div className="bg-secondary-foreground" style={{ width: `${(canceled / total) * 100}%` }} /></>}</div><div className="mt-5 flex justify-between text-xs text-muted-foreground"><span>{successPct}% sucesso</span><span>{total} execuções</span></div></div><div className="space-y-3 text-sm text-muted-foreground"><div className="flex items-center justify-between"><span><i className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-primary"/>Sucesso</span><b>{successPct}%</b></div><div className="flex items-center justify-between"><span><i className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-feedback-error"/>Falhas</span><b>{errorCount}</b></div><div className="flex items-center justify-between"><span><i className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-feedback-info"/>Em andamento</span><b>{running}</b></div><div className="flex items-center justify-between"><span><i className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-muted-foreground"/>Aguardando</span><b>{waiting}</b></div><div className="flex items-center justify-between"><span><i className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-secondary-foreground"/>Canceladas</span><b>{canceled}</b></div></div></div></CardContent></Card>
      <Card className="border-0 bg-card shadow-sm"><CardHeader><CardTitle className="text-base">Tempo das execuções</CardTitle><p className="text-xs text-muted-foreground">Compare o tempo médio, o comportamento típico e as execuções mais lentas.</p></CardHeader><CardContent><div className="flex min-h-[190px] items-center rounded-[24px] bg-background px-8"><div>{initialLoading ? <MetricSkeleton className="h-12 w-28" /> : <p className="text-5xl font-semibold tracking-[-.06em] text-foreground">{m?.averageDuration != null ? `${m.averageDuration}s` : "—"}</p>}<p className="mt-3 text-sm text-muted-foreground">tempo médio no período selecionado</p><div className="mt-5 flex gap-6 text-xs"><span><b className="block text-sm text-foreground">{m?.p50Duration != null ? `${m.p50Duration}s` : "—"}</b><span className="text-muted-foreground">tempo típico</span></span><span><b className="block text-sm text-foreground">{m?.p95Duration != null ? `${m.p95Duration}s` : "—"}</b><span className="text-muted-foreground">execuções lentas</span></span></div></div></div></CardContent></Card>
    </div>

    <Card className="mt-6 border-0 bg-card shadow-sm"><CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><CardTitle className="text-base">Workflows em foco</CardTitle><p className="mt-1 text-xs text-muted-foreground">Escolha manualmente os fluxos que deseja acompanhar. O gráfico e os indicadores acima acompanham essa seleção.</p></div><Select onValueChange={addFocus}><SelectTrigger className="w-[300px]"><SelectValue placeholder="Adicionar workflow ao foco" /></SelectTrigger><SelectContent><SelectItem value="__all__">Todos os workflows</SelectItem>{(workflows.data?.items ?? []).filter((w: any) => !focusIds.includes(w.id)).map((w: any) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></CardHeader><CardContent className="p-0"><div className="hidden gap-4 border-t px-6 py-3 text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground md:grid md:grid-cols-[minmax(300px,1.6fr)_minmax(120px,.55fr)_minmax(120px,.55fr)_minmax(110px,.5fr)_minmax(110px,.5fr)]"><span>Workflow</span><span className="text-center">Execuções</span><span className="text-center">Sucesso</span><span className="text-center">Erros</span><span className="text-right">Ação</span></div><div className="divide-y">{focus.map((w: any) => <div key={w.id} className="grid gap-3 px-6 py-4 md:grid-cols-[minmax(300px,1.6fr)_minmax(120px,.55fr)_minmax(120px,.55fr)_minmax(110px,.5fr)_minmax(110px,.5fr)] md:items-center"><div><p className="text-sm font-semibold">{w.name}</p><p className="mt-1 text-xs text-muted-foreground">{w.active ? "Ativo" : "Inativo"} · última: {w.lastExecutionAt ? new Date(w.lastExecutionAt).toLocaleString("pt-BR") : "—"}</p></div><span className="justify-self-center text-center text-xs">{w.executions}</span><span className="justify-self-center text-center text-xs text-feedback-success">{w.successRate != null ? `${w.successRate}%` : "—"}</span><Badge className={w.errors ? "w-fit justify-self-center bg-feedback-error-surface text-feedback-error" : "w-fit justify-self-center bg-feedback-success-surface text-feedback-success"}>{w.errors}</Badge><div className="justify-self-end">{focusIds.length > 0 && <Button variant="ghost" size="sm" onClick={() => removeFocus(w.id)}>Remover</Button>}</div></div>)}{focus.length === 0 && <div className="py-12 text-center text-sm text-muted-foreground">Selecione um workflow para acompanhar aqui.</div>}</div></CardContent></Card>
  </div></OperationsShell>;
}
