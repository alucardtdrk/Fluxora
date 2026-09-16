import { useDeferredValue, useEffect, useState } from "react";
import { ArrowLeft, Eye, GitCompareArrows, RefreshCw, Search, Timer, X } from "lucide-react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import OperationsShell from "@/components/OperationsShell";
import ExecutionDetailDialog from "@/components/ExecutionDetailDialog";
import ExecutionComparisonDialog from "@/components/ExecutionComparisonDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PREFERENCES_UPDATED_EVENT, readPreferredPageSize, readScopedPeriod, saveScopedPeriod } from "@/lib/preferences";
import { trpc } from "@/lib/trpc";

type Period = "today" | "7d" | "30d" | "90d" | "all";

const periods: Array<[Period, string]> = [
  ["today", "Hoje"],
  ["7d", "7 dias"],
  ["30d", "30 dias"],
  ["90d", "90 dias"],
  ["all", "Todo o histórico"],
];

function label(status: string) {
  if (status === "success") return "Sucesso";
  if (["error", "failed", "crashed"].includes(status)) return "Erro";
  if (["running", "new"].includes(status)) return "Em andamento";
  if (status === "waiting") return "Aguardando";
  return status || "Desconhecido";
}

function badgeClass(status: string) {
  if (status === "success") return "bg-[#e3f6eb] text-[#258b57]";
  if (["error", "failed", "crashed"].includes(status)) return "bg-[#fff0e7] text-[#bd6338]";
  return "bg-[#E8ECFF] text-[#4355D8]";
}

export default function Executions() {
  const { user } = useAuth();
  const [location] = useLocation();
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get("search") || "");
  const search = useDeferredValue(query);
  const [status, setStatus] = useState("all");
  const [workflowId, setWorkflowId] = useState("all");
  const [period, setPeriod] = useState<Period>(() => readScopedPeriod("executions", "30d"));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => readPreferredPageSize(50));
  const [selected, setSelected] = useState<string | null>(() => new URLSearchParams(window.location.search).get("execution"));
  const [comparisonSelection, setComparisonSelection] = useState<Array<{ id: string; workflowId?: string; workflowName?: string }>>([]);
  const [comparisonOpen, setComparisonOpen] = useState(false);

  useEffect(() => {
    const syncPageSize = () => {
      setPageSize(readPreferredPageSize(50));
      setPeriod(readScopedPeriod("executions", "30d"));
      setPage(1);
    };
    window.addEventListener(PREFERENCES_UPDATED_EVENT, syncPageSize);
    return () => window.removeEventListener(PREFERENCES_UPDATED_EVENT, syncPageSize);
  }, []);

  useEffect(() => saveScopedPeriod("executions", period), [period]);

  useEffect(() => {
    const executionId = new URLSearchParams(location.split("?")[1] || "").get("execution");
    if (executionId) setSelected(executionId);
  }, [location]);

  const executions = trpc.n8n.executionsPage.useQuery(
    { page, pageSize, period, search, status, workflowId },
    { enabled: Boolean(user), retry: false, placeholderData: (previous) => previous },
  );
  const workflows = trpc.n8n.workflows.useQuery(undefined, { enabled: Boolean(user), retry: false });
  const items = executions.data?.items ?? [];
  const total = executions.data?.total ?? 0;
  const currentPage = executions.data?.page ?? page;
  const totalPages = executions.data?.totalPages ?? 1;

  const change = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };
  const refresh = async () => {
    await Promise.all([executions.refetch(), workflows.refetch()]);
    toast.success("Histórico atualizado");
  };
  const toggleComparison = (item: { id: string; workflowId?: string; workflowName?: string }) => {
    setComparisonSelection((current) => {
      if (current.some((selectedItem) => selectedItem.id === item.id)) return current.filter((selectedItem) => selectedItem.id !== item.id);
      if (current.length >= 2) { toast.error("Selecione apenas duas execuções"); return current; }
      if (current[0]?.workflowId && item.workflowId && current[0].workflowId !== item.workflowId) { toast.error("As execuções precisam pertencer ao mesmo workflow"); return current; }
      return [...current, item];
    });
  };

  return (
    <OperationsShell>
      <div className="min-h-[calc(100vh-86px)] bg-[#F5F7FB] px-5 py-7 md:px-9">
        <div className="mx-auto max-w-[1450px]">
          <Link href="/" className="mb-6 inline-flex items-center gap-2 text-xs font-semibold text-[#667085]">
            <ArrowLeft className="h-3.5 w-3.5" />Voltar para visão geral
          </Link>

          <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[.18em] text-[#667085]">Operação / Execuções</p>
              <h2 className="mt-3 text-4xl font-semibold tracking-[-.06em]">Execuções</h2>
              <p className="mt-2 text-sm text-[#667085]">Histórico consolidado do n8n e Firestore, sem duplicar IDs.</p>
            </div>
            <Button onClick={refresh} className="rounded-xl bg-[#4355D8] text-white">
              <RefreshCw className={`mr-2 h-4 w-4 ${executions.isFetching ? "animate-spin" : ""}`} />Atualizar
            </Button>
          </div>

          <div className="mb-4 flex flex-wrap rounded-xl border bg-white p-1">
            {periods.map(([value, text]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setPeriod(value);
                  setPage(1);
                }}
                className={`rounded-lg px-3 py-2 text-xs font-semibold ${period === value ? "bg-[#11183D] text-white" : "text-[#667085]"}`}
              >
                {text}
              </button>
            ))}
          </div>

          {executions.data?.truncated && (
            <div className="mb-4 rounded-xl border border-[#f3d5bf] bg-[#fff8f2] p-3 text-xs text-[#89542c]">
              O histórico atingiu o limite configurado no servidor.
            </div>
          )}

          {comparisonSelection.length > 0 ? <div className="mb-4 flex flex-col justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-center"><div><p className="text-sm font-semibold">Comparação de execuções</p><p className="mt-1 text-xs text-[#667085]">{comparisonSelection.length === 1 ? "Selecione mais uma execução do mesmo workflow." : `Pronto para comparar #${comparisonSelection[0].id} e #${comparisonSelection[1].id}.`}</p></div><div className="flex gap-2"><Button variant="ghost" size="sm" onClick={() => setComparisonSelection([])}><X className="mr-1 h-4 w-4" />Limpar</Button><Button size="sm" className="bg-[#4355D8] hover:bg-[#3546C7]" disabled={comparisonSelection.length !== 2} onClick={() => setComparisonOpen(true)}><GitCompareArrows className="mr-2 h-4 w-4" />Comparar</Button></div></div> : null}

          <Card className="border-0 bg-white shadow-[0_10px_30px_rgba(41,54,115,.06)]">
            <CardHeader>
              <CardTitle className="text-base">Histórico completo</CardTitle>
              <p className="text-xs text-[#667085]">A consulta é paginada no servidor para continuar rápida com grandes volumes.</p>
              <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:flex-nowrap xl:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#a4abc2]" />
                  <Input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
                    placeholder="Buscar automação, workflow ou ID"
                    className="h-11 pl-9"
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row xl:flex-none">
                  <div className="min-w-0 sm:w-[320px]">
                    <Select value={workflowId} onValueChange={change(setWorkflowId)}>
                      <SelectTrigger className="h-11 w-full min-w-0 max-w-full overflow-hidden text-left [&>span]:block [&>span]:min-w-0 [&>span]:truncate"><SelectValue placeholder="Todos os workflows" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os workflows</SelectItem>
                        {(workflows.data?.items ?? []).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-0 sm:w-[180px]">
                    <Select value={status} onValueChange={change(setStatus)}>
                      <SelectTrigger className="h-11 w-full min-w-0 max-w-full overflow-hidden text-left [&>span]:block [&>span]:min-w-0 [&>span]:truncate"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os status</SelectItem>
                        <SelectItem value="success">Sucesso</SelectItem>
                        <SelectItem value="error">Erro</SelectItem>
                        <SelectItem value="running">Em andamento</SelectItem>
                        <SelectItem value="waiting">Aguardando</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {executions.isLoading ? (
                <div className="p-8 text-sm text-[#667085]">Carregando execuções...</div>
              ) : executions.isError ? (
                <div className="p-8 text-sm text-[#bd6338]">Falha ao consultar execuções.</div>
              ) : (
                <>
                  <div className="hidden gap-4 border-t px-6 py-3 text-[10px] font-bold uppercase tracking-[.14em] text-[#a0a7bd] md:grid md:grid-cols-[32px_minmax(300px,1.7fr)_minmax(105px,.55fr)_minmax(160px,.9fr)_minmax(90px,.5fr)_minmax(105px,.55fr)_minmax(85px,.4fr)_minmax(130px,.65fr)]">
                    <span /><span>Automação / área</span><span className="text-center">Status</span><span className="text-center">Início</span><span className="text-center">Duração</span><span className="text-center">Origem</span><span className="text-center">ID</span><span className="text-right">Ação</span>
                  </div>
                  <div className="divide-y divide-[#f1f2f7]">
                    {items.map((item) => (
                      <div key={item.id} className="grid gap-3 px-6 py-4 md:grid-cols-[32px_minmax(300px,1.7fr)_minmax(105px,.55fr)_minmax(160px,.9fr)_minmax(90px,.5fr)_minmax(105px,.55fr)_minmax(85px,.4fr)_minmax(130px,.65fr)] md:items-center">
                        <Checkbox aria-label={`Selecionar execução ${item.id} para comparação`} checked={comparisonSelection.some((selectedItem) => selectedItem.id === item.id)} onCheckedChange={() => toggleComparison(item)} />
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#EEF1FF] text-[#4355D8] dark:bg-[#34205F] dark:text-[#75A5FF]"><Timer className="h-4 w-4" /></div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{item.sectionName || item.workflowName}</p>
                            <p className="mt-1 truncate text-xs text-[#98A2B3]">Workflow: {item.workflowName} | Modo: {item.mode || "não informado"}</p>
                          </div>
                        </div>
                        <Badge className={`w-fit justify-self-center ${badgeClass(item.status)}`}>{label(item.status)}</Badge>
                        <span className="justify-self-center text-center text-xs text-[#667085]">{item.startedAt ? new Date(item.startedAt).toLocaleString("pt-BR") : "-"}</span>
                        <span className="justify-self-center text-center text-xs text-[#667085]">{item.duration != null ? `${item.duration}s` : "-"}</span>
                        <Badge className={`w-fit justify-self-center ${item.source === "firestore" ? "bg-[#EEF1FF] text-[#4355D8]" : "bg-[#e3f6eb] text-[#258b57]"}`}>{item.source === "firestore" ? "Arquivo" : "n8n"}</Badge>
                        <span className="justify-self-center font-mono text-[11px] text-[#98A2B3]">#{item.id}</span>
                        <Button variant="outline" size="sm" onClick={() => setSelected(item.id)} className="w-fit justify-self-end rounded-lg text-xs"><Eye className="mr-2 h-3.5 w-3.5" />Ver detalhes</Button>
                      </div>
                    ))}
                    {items.length === 0 && <div className="py-16 text-center text-sm text-[#667085]">Nenhuma execução encontrada com estes filtros.</div>}
                  </div>
                  <div className="flex flex-col gap-3 border-t px-6 py-4 text-xs text-[#667085] md:flex-row md:items-center md:justify-between">
                    <span>Mostrando {items.length ? (currentPage - 1) * pageSize + 1 : 0}-{Math.min(currentPage * pageSize, total)} de {total.toLocaleString("pt-BR")}</span>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Anterior</Button>
                      <span>Página {currentPage} de {totalPages}</span>
                      <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Próxima</Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <ExecutionDetailDialog executionId={selected} open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)} />
      <ExecutionComparisonDialog executionIds={comparisonSelection.map((item) => item.id)} open={comparisonOpen} onOpenChange={setComparisonOpen} />
    </OperationsShell>
  );
}
