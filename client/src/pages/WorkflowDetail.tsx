import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, Code2, ExternalLink, Eye, Play, RefreshCw, ShieldCheck, Workflow } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import ExecutionDetailDialog from "@/components/ExecutionDetailDialog";
import OperationsShell from "@/components/OperationsShell";
import WorkflowChangeHistory from "@/components/WorkflowChangeHistory";
import WorkflowDiagram from "@/components/WorkflowDiagram";
import WorkflowNodePanel from "@/components/WorkflowNodePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PREFERENCES_UPDATED_EVENT, readPreferredPageSize } from "@/lib/preferences";
import { trpc } from "@/lib/trpc";

function statusBadge(status?: string) {
  if (status === "success") return "bg-[#e3f6eb] text-[#258b57]";
  if (["error", "failed", "crashed"].includes(String(status || ""))) return "bg-[#fff0e7] text-[#bd6338]";
  if (["running", "new"].includes(String(status || ""))) return "bg-[#EEF1FF] text-[#4355D8]";
  return "bg-[#f1f2f6] text-[#667085]";
}

function statusLabel(status?: string) {
  if (status === "success") return "Sucesso";
  if (["error", "failed", "crashed"].includes(String(status || ""))) return "Erro";
  if (["running", "new"].includes(String(status || ""))) return "Em andamento";
  if (status === "waiting") return "Aguardando";
  return status || "Desconhecido";
}

function JsonBlock({ value }: { value: unknown }) {
  if (value == null) return <p className="text-xs text-[#98A2B3]">Sem dados registrados.</p>;
  return <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-[#11183D] p-4 text-[11px] leading-5 text-[#E8ECFF]">{JSON.stringify(value, null, 2)}</pre>;
}

export default function WorkflowDetail() {
  const { user } = useAuth();
  const [, params] = useRoute<{ id: string }>("/workflows/:id");
  const id = params?.id ?? "";
  const [pageSize, setPageSize] = useState(() => readPreferredPageSize());
  const [page, setPage] = useState(1);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [executionDiagramId, setExecutionDiagramId] = useState<string | null>(null);
  const [selectedNodeName, setSelectedNodeName] = useState<string | null>(null);

  const workflowDetail = trpc.n8n.workflowDetail.useQuery({ id }, { enabled: Boolean(user && id), retry: false });
  const workflows = trpc.n8n.workflows.useQuery(undefined, { enabled: Boolean(user), retry: false });
  const executions = trpc.n8n.executions.useQuery(undefined, { enabled: Boolean(user), retry: false });
  const executionDetail = trpc.n8n.executionDetail.useQuery({ id: executionDiagramId || "" }, { enabled: Boolean(user && executionDiagramId), retry: false });
  const toggleWorkflow = trpc.n8n.toggleWorkflow.useMutation();
  const updateWorkflowNode = trpc.n8n.updateWorkflowNode.useMutation();
  const restoreWorkflowVersion = trpc.n8n.restoreWorkflowVersion.useMutation();

  const fallbackWorkflow = workflows.data?.items?.find((item: any) => item.id === id) ?? null;
  const workflow = workflowDetail.data?.workflow ?? (fallbackWorkflow ? {
    ...fallbackWorkflow,
    connections: {},
    nodes: Array.isArray(fallbackWorkflow.nodes) ? fallbackWorkflow.nodes.map((node: any) => ({
      id: String(node.id || node.name || ""),
      name: String(node.name || "Node sem nome"),
      type: String(node.type || "desconhecido"),
      position: Array.isArray(node.position) ? node.position : [0, 0],
      disabled: Boolean(node.disabled),
      parameters: {},
      editableParameters: {},
      blockedFields: [],
      editBlocked: true,
      editBlockedReason: "O carregamento detalhado deste workflow falhou. A visao antiga continua disponivel abaixo.",
      incoming: [],
      outgoing: [],
    })) : [],
  } : null);
  const historyConfigured = Boolean(workflowDetail.data?.historyConfigured);
  const changes = workflowDetail.data?.changes ?? [];
  const advancedDetailAvailable = workflowDetail.data?.status === "ok";
  const history = useMemo(() => (executions.data?.items ?? []).filter((item) => item.workflowId === id), [executions.data, id]);
  const success = history.filter((item) => item.status === "success").length;
  const errors = history.filter((item) => ["error", "failed", "crashed"].includes(String(item.status))).length;
  const totalPages = Math.max(1, Math.ceil(history.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = history.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    if (!workflow?.nodes?.length) return;
    if (!selectedNodeName || !workflow.nodes.some((node: any) => node.name === selectedNodeName)) {
      setSelectedNodeName(workflow.nodes[0].name);
    }
  }, [workflow?.nodes, selectedNodeName]);

  useEffect(() => {
    if (!history.length) return;
    if (!executionDiagramId) setExecutionDiagramId(history[0].id);
  }, [history, executionDiagramId]);

  useEffect(() => {
    const syncPreferences = () => {
      setPage(1);
      setPageSize(readPreferredPageSize());
    };
    window.addEventListener(PREFERENCES_UPDATED_EVENT, syncPreferences);
    return () => window.removeEventListener(PREFERENCES_UPDATED_EVENT, syncPreferences);
  }, []);

  const selectedNode = useMemo(() => workflow?.nodes?.find((node: any) => node.name === selectedNodeName) ?? null, [workflow?.nodes, selectedNodeName]);
  const executionNodeStatuses = useMemo(() => {
    const nodes = executionDetail.data?.execution?.nodes ?? [];
    const map: Record<string, string> = {};
    nodes.forEach((node: any) => {
      const name = String(node.nodeName || "");
      if (!name) return;
      const next = ["error", "failed", "crashed"].includes(String(node.status || "")) ? "error" : node.status === "success" ? "success" : ["running", "new"].includes(String(node.status || "")) ? "running" : "idle";
      if (map[name] === "error") return;
      if (map[name] === "success" && next === "running") return;
      map[name] = next;
    });
    return map;
  }, [executionDetail.data]);
  const selectedExecutionNodeRuns = useMemo(() => {
    const nodes = executionDetail.data?.execution?.nodes ?? [];
    return nodes.filter((node: any) => node.nodeName === selectedNodeName);
  }, [executionDetail.data, selectedNodeName]);

  useEffect(() => {
    const executedNodes = executionDetail.data?.execution?.nodes ?? [];
    if (!executedNodes.length) return;
    if (!selectedNodeName || !executedNodes.some((node: any) => node.nodeName === selectedNodeName)) {
      setSelectedNodeName(executedNodes[0].nodeName);
    }
  }, [executionDetail.data, selectedNodeName]);

  const canOperate = user?.role === "admin" || user?.role === "operator";
  const canRestore = user?.role === "admin";

  const refreshAll = async () => {
    await Promise.all([workflowDetail.refetch(), executions.refetch(), executionDiagramId ? executionDetail.refetch() : Promise.resolve()]);
    toast.success("Workflow atualizado");
  };

  const toggle = () => {
    if (!workflow) return;
    toggleWorkflow.mutate({ id: workflow.id, active: !workflow.active }, {
      onSuccess: (result) => {
        if (result.status === "ok") {
          toast.success(result.active ? "Workflow ativado" : "Workflow desativado");
          workflowDetail.refetch();
        } else {
          toast.error(("message" in result && result.message) ? result.message : "Nao foi possivel alterar o workflow");
        }
      },
      onError: () => toast.error("Nao foi possivel alterar o workflow"),
    });
  };

  if (workflows.isLoading || executions.isLoading) return <OperationsShell><State title="Carregando workflow" /></OperationsShell>;
  if (!workflow) return <OperationsShell><State title="Workflow nao encontrado" /></OperationsShell>;

  return (
    <OperationsShell>
      <div className="min-h-[calc(100vh-86px)] bg-[#F5F7FB] px-5 py-7 md:px-9">
        <div className="mx-auto max-w-[1540px]">
          <Link href="/workflows" className="mb-6 inline-flex items-center gap-2 text-xs font-semibold text-[#667085]"><ArrowLeft className="h-3.5 w-3.5" />Voltar para workflows</Link>
          <div className="mb-7 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[.18em] text-[#667085]">Operação / Workflow</p>
              <h2 className="mt-3 text-4xl font-semibold tracking-[-.06em] text-[#11183D]">{workflow.name}</h2>
              <p className="mt-2 text-sm text-[#667085]">ID {id} · {workflow.nodeCount} nodes · {workflow.active ? "ativo" : "inativo"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {workflowDetail.data?.editorUrl ? <Button variant="outline" onClick={() => window.open(workflowDetail.data?.editorUrl || "", "_blank", "noopener,noreferrer")}><ExternalLink className="mr-2 h-4 w-4" />Abrir no n8n</Button> : null}
              {canOperate ? <Button variant="outline" onClick={toggle}><Play className="mr-2 h-4 w-4" />{workflow.active ? "Desativar" : "Ativar"}</Button> : null}
              <Button onClick={refreshAll} className="bg-[#4355D8] text-white"><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <Metric title="Execuções" value={String(history.length)} subtitle="histórico carregado" />
            <Metric title="Sucessos" value={String(success)} subtitle="concluídas" />
            <Metric title="Erros" value={String(errors)} subtitle="falhas" />
            <Metric title="Status" value={workflow.active ? "Ativo" : "Inativo"} subtitle="estado no n8n" />
          </div>

          <Tabs defaultValue="overview" className="mt-6">
            <TabsList className="h-auto flex-wrap rounded-2xl bg-white p-1.5">
              <TabsTrigger value="overview" className="rounded-xl px-4 py-2 text-xs">Visão geral</TabsTrigger>
              <TabsTrigger value="diagram" className="rounded-xl px-4 py-2 text-xs">Diagrama</TabsTrigger>
              <TabsTrigger value="executions" className="rounded-xl px-4 py-2 text-xs">Execuções</TabsTrigger>
              <TabsTrigger value="changes" className="rounded-xl px-4 py-2 text-xs">Alterações</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-6 space-y-6">
              <div className="grid gap-6 xl:grid-cols-[1.55fr_.75fr]">
                <Card className="border-0 bg-white shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><Workflow className="h-4 w-4 text-[#4355D8]" />Últimas execuções</CardTitle>
                    <p className="text-xs text-[#667085]">As 12 execuções mais recentes continuam em destaque com acesso ao detalhe técnico.</p>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {history.slice(0, 12).map((item) => (
                        <div key={item.id} className="grid gap-3 px-6 py-4 md:grid-cols-[1.2fr_.7fr_.5fr_auto] md:items-center">
                          <div>
                            <p className="truncate text-sm font-semibold text-[#11183D]">{item.sectionName || "Fluxo principal"}</p>
                            <p className="mt-1 text-[11px] text-[#98A2B3]">#{item.id} · {item.startedAt ? new Date(item.startedAt).toLocaleString("pt-BR") : "-"}</p>
                          </div>
                          <Badge className={`w-fit ${statusBadge(item.status)}`}>{statusLabel(item.status)}</Badge>
                          <span className="text-xs text-[#667085]">{item.duration != null ? `${item.duration}s` : "-"}</span>
                          <Button variant="outline" size="sm" onClick={() => setSelectedExecutionId(item.id)}><Eye className="mr-2 h-3.5 w-3.5" />Ver detalhes</Button>
                        </div>
                      ))}
                      {history.length === 0 ? <Empty /> : null}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-0 bg-[#F0FBFA] shadow-none">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base text-[#286A4A]"><ShieldCheck className="h-4 w-4" />Ações e estrutura</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {canOperate ? <Button variant="outline" onClick={toggle} className="w-full justify-start"><Play className="mr-2 h-4 w-4" />{workflow.active ? "Desativar workflow" : "Ativar workflow"}</Button> : <div className="rounded-xl border border-[#DDE2EE] bg-white p-3 text-xs text-[#667085]">Perfil visualizador: ações operacionais e edições ficam bloqueadas.</div>}
                    <Button variant="outline" onClick={() => navigator.clipboard?.writeText(id).then(() => toast.success("ID copiado"))} className="w-full justify-start"><CheckCircle2 className="mr-2 h-4 w-4" />Copiar ID</Button>
                    <div className="rounded-xl bg-white p-4 text-xs text-[#5A9275]">
                      <p className="font-semibold">Nodes configurados</p>
                      <div className="mt-3 max-h-56 space-y-2 overflow-auto">
                        {workflow.nodes?.map((node: any, index: number) => <div key={`${node.name}-${index}`} className="flex justify-between gap-3"><span>{node.name}</span><span className="truncate text-[#667085]">{node.type}</span></div>)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="diagram" className="mt-6">
              {!advancedDetailAvailable ? null : <div className="grid items-start gap-6 xl:grid-cols-[1.4fr_.8fr]">
                <WorkflowDiagram nodes={workflow.nodes} connections={workflow.connections} selectedNodeName={selectedNodeName} onSelectNode={setSelectedNodeName} />
                <WorkflowNodePanel
                  node={selectedNode}
                  canEdit={canOperate}
                  canUseAdvanced={canRestore}
                  onSave={async ({ nodeName, changes, parameters, summary }) => {
                    const result = await updateWorkflowNode.mutateAsync({ workflowId: id, nodeName, changes, parameters, summary });
                    if (result.status !== "ok") throw new Error(("message" in result && result.message) ? result.message : "Nao foi possivel salvar este node.");
                    toast.success("Alteração enviada ao n8n com snapshot salvo no Firestore.");
                    await workflowDetail.refetch();
                    setSelectedNodeName(nodeName);
                  }}
                />
              </div>}
            </TabsContent>

            <TabsContent value="executions" className="mt-6 space-y-6">
              {advancedDetailAvailable ? <div className="grid items-start gap-6 xl:grid-cols-[1.4fr_.8fr]">
                <WorkflowDiagram nodes={workflow.nodes} connections={workflow.connections} selectedNodeName={selectedNodeName} onSelectNode={setSelectedNodeName} executionNodeStatuses={executionNodeStatuses} />
                <div className="space-y-6">
                <Card className="border-0 bg-white shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base">Execução em destaque</CardTitle>
                    <p className="text-xs text-[#667085]">Selecione uma execução e clique em um node do diagrama para inspecionar suas respostas.</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {history.slice(0, 12).map((item) => (
                      <button key={item.id} type="button" onClick={() => setExecutionDiagramId(item.id)} className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left ${executionDiagramId === item.id ? "border-[#4355D8] bg-[#EEF1FF]" : "border-[#E8EBF4] bg-[#FBFCFE]"}`}>
                        <div>
                          <p className="text-sm font-semibold text-[#11183D]">{item.sectionName || "Fluxo principal"}</p>
                          <p className="mt-1 text-xs text-[#667085]">#{item.id} · {item.startedAt ? new Date(item.startedAt).toLocaleString("pt-BR") : "-"}</p>
                        </div>
                        <Badge className={statusBadge(item.status)}>{statusLabel(item.status)}</Badge>
                      </button>
                    ))}
                    {history.length === 0 ? <div className="rounded-xl border border-dashed border-[#DDE2EE] px-4 py-8 text-center text-sm text-[#98A2B3]">Nenhuma execução encontrada para destacar o diagrama.</div> : null}
                  </CardContent>
                </Card>
                <Card className="border-0 bg-white shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><Code2 className="h-4 w-4 text-[#4355D8]" />Dados do node</CardTitle>
                    <p className="text-xs text-[#667085]">{selectedNodeName ? `${selectedNodeName} na execução #${executionDiagramId}` : "Selecione um node executado no diagrama."}</p>
                  </CardHeader>
                  <CardContent>
                    {executionDetail.isLoading ? <div className="py-10 text-center text-sm text-[#667085]">Carregando dados da execução…</div> : selectedExecutionNodeRuns.length === 0 ? <div className="rounded-xl border border-dashed border-[#DDE2EE] px-4 py-8 text-center text-sm text-[#98A2B3]">Este node não foi executado ou não possui dados disponíveis nesta execução.</div> : <div className="space-y-4">
                      {selectedExecutionNodeRuns.map((run: any, index: number) => <details key={`${run.nodeName}-${run.runIndex}-${index}`} open={index === 0} className="group rounded-2xl border border-[#E8EBF4] bg-[#FBFCFE] open:bg-white">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                          <div className="flex items-center gap-3"><div className={`grid h-8 w-8 place-items-center rounded-xl ${run.status === "error" ? "bg-[#fff0e7] text-[#bd6338]" : "bg-[#e3f6eb] text-[#258b57]"}`}>{run.status === "error" ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}</div><div><p className="text-xs font-semibold text-[#11183D]">Execução {run.runIndex + 1}</p><p className="mt-0.5 text-[11px] text-[#98A2B3]">{run.outputItems} item(ns) · {run.executionTimeMs != null ? `${run.executionTimeMs}ms` : "sem duração"}</p></div></div>
                          <Badge className={statusBadge(run.status)}>{statusLabel(run.status)}</Badge>
                        </summary>
                        <div className="space-y-4 border-t border-[#EEF0F6] px-4 py-4">
                          <div><p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#667085]">Entrada / origem</p><JsonBlock value={run.input ?? run.source} /></div>
                          <div><p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#667085]">Saída / resposta</p><JsonBlock value={run.output} /></div>
                          {run.error ? <div><p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#BD6338]">Erro do node</p><JsonBlock value={run.error} /></div> : null}
                        </div>
                      </details>)}
                    </div>}
                  </CardContent>
                </Card>
                </div>
              </div> : null}

              <Card className="border-0 bg-white shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base">Todas as execuções deste workflow</CardTitle>
                  <p className="text-xs text-[#667085]">Histórico paginado com acesso ao detalhe completo.</p>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="hidden grid-cols-[1.2fr_.5fr_.7fr_.8fr_.5fr_auto] gap-4 border-t px-6 py-3 text-[10px] font-bold uppercase tracking-[.14em] text-[#A0A7BD] md:grid">
                    <span>Automação / área</span><span>ID</span><span>Status</span><span>Início</span><span>Duração</span><span>Ação</span>
                  </div>
                  <div className="divide-y">
                    {pageItems.map((item) => (
                      <div key={item.id} className="grid gap-3 px-6 py-4 md:grid-cols-[1.2fr_.5fr_.7fr_.8fr_.5fr_auto] md:items-center">
                        <span className="truncate text-sm font-semibold text-[#11183D]">{item.sectionName || "Fluxo principal"}</span>
                        <span className="font-mono text-xs">#{item.id}</span>
                        <Badge className={`w-fit ${statusBadge(item.status)}`}>{statusLabel(item.status)}</Badge>
                        <span className="text-xs text-[#667085]">{item.startedAt ? new Date(item.startedAt).toLocaleString("pt-BR") : "-"}</span>
                        <span className="text-xs text-[#667085]">{item.duration != null ? `${item.duration}s` : "-"}</span>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setExecutionDiagramId(item.id)}>Destacar</Button>
                          <Button variant="outline" size="sm" onClick={() => setSelectedExecutionId(item.id)}><Eye className="mr-2 h-3.5 w-3.5" />Ver detalhes</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between border-t px-6 py-4 text-xs text-[#667085]">
                    <span>{history.length} execuções</span>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</Button>
                      <span>{safePage}/{totalPages}</span>
                      <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage((value) => value + 1)}>Próxima</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="changes" className="mt-6">
              {!advancedDetailAvailable ? null : <WorkflowChangeHistory
                changes={changes}
                canRestore={canRestore}
                historyConfigured={historyConfigured}
                onRestore={async (snapshotId) => {
                  const result = await restoreWorkflowVersion.mutateAsync({ workflowId: id, snapshotId });
                  if (result.status !== "ok") throw new Error(("message" in result && result.message) ? result.message : "Não foi possível restaurar esta versão.");
                  toast.success("Workflow restaurado no n8n a partir do snapshot selecionado.");
                  await workflowDetail.refetch();
                }}
              />}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <ExecutionDetailDialog executionId={selectedExecutionId} open={Boolean(selectedExecutionId)} onOpenChange={(open) => !open && setSelectedExecutionId(null)} />
    </OperationsShell>
  );
}

function Metric({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return <Card className="border-0 bg-white shadow-sm"><CardContent className="p-5"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#667085]">{title}</p><p className="mt-2 text-3xl font-semibold text-[#11183D]">{value}</p><p className="mt-1 text-xs text-[#98A2B3]">{subtitle}</p></CardContent></Card>;
}

function State({ title }: { title: string }) {
  return <div className="grid min-h-[calc(100vh-86px)] place-items-center bg-[#F5F7FB]"><Card><CardContent className="p-8 text-sm text-[#667085]">{title}</CardContent></Card></div>;
}

function Empty() {
  return <div className="flex flex-col items-center py-12 text-sm text-[#98A2B3]"><Clock3 className="mb-3 h-6 w-6" />Nenhuma execução vinculada.</div>;
}
