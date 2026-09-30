import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Code2, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";

function statusLabel(status?: string) {
  if (status === "success") return "Sucesso";
  if (["error", "failed", "crashed"].includes(status || "")) return "Erro";
  if (["running", "new"].includes(status || "")) return "Em andamento";
  if (status === "waiting") return "Aguardando";
  return status || "Desconhecido";
}

function statusClass(status?: string) {
  if (status === "success") return "bg-feedback-success-surface text-feedback-success";
  if (["error", "failed", "crashed"].includes(status || "")) return "bg-feedback-error-surface text-feedback-error";
  return "bg-feedback-info-surface text-feedback-info";
}

function JsonBlock({ value }: { value: unknown }) {
  if (value == null) return <p className="text-xs text-muted-foreground">Sem dados registrados.</p>;
  return <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-code-background p-4 text-[11px] leading-5 text-code-foreground">{JSON.stringify(value, null, 2)}</pre>;
}

function NodeDiagnostics({ nodes }: { nodes: Array<{ nodeName?: string; status?: string; executionTimeMs?: number | null }> }) {
  let failedCount = 0;
  let slowest: { nodeName?: string; executionTimeMs?: number | null } | null = null;
  for (const node of nodes) {
    if (["error", "failed", "crashed"].includes(node.status || "")) failedCount += 1;
    if (node.executionTimeMs != null && (!slowest || node.executionTimeMs > (slowest.executionTimeMs ?? 0))) slowest = node;
  }
  if (!slowest && !failedCount) return null;
  return <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-2xl border border-border bg-muted p-4"><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.12em] text-muted-foreground"><Clock3 className="h-3.5 w-3.5 text-feedback-info" />Node mais lento</p><p className="mt-2 truncate text-sm font-semibold text-foreground">{slowest?.nodeName || "Sem duração registrada"}</p><p className="mt-1 text-xs text-muted-foreground">{slowest?.executionTimeMs != null ? `${slowest.executionTimeMs}ms nesta execução` : "O n8n não informou o tempo dos nodes."}</p></div><div className={`rounded-2xl border p-4 ${failedCount ? "border-feedback-error-border bg-feedback-error-surface" : "border-border bg-muted"}`}><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.12em] text-muted-foreground"><AlertTriangle className={`h-3.5 w-3.5 ${failedCount ? "text-feedback-error" : "text-feedback-success"}`} />Nodes com falha</p><p className="mt-2 text-sm font-semibold text-foreground">{failedCount}</p><p className="mt-1 text-xs text-muted-foreground">{failedCount ? "Abra a etapa com erro para ver o detalhe técnico." : "Nenhuma falha registrada nos nodes."}</p></div></div>;
}

export default function ExecutionDetailDialog({ executionId, open, onOpenChange }: { executionId: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [advanced, setAdvanced] = useState(false);
  const detail = trpc.n8n.executionDetail.useQuery({ id: executionId || "" }, { enabled: open && Boolean(executionId), retry: false });
  const execution = detail.data?.execution;
  const nodes = useMemo(() => execution?.nodes ?? [], [execution]);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-5xl">
      <div className="border-b border-border px-6 py-5">
        <DialogHeader>
          <DialogTitle className="text-xl text-foreground">Detalhes da execução {executionId ? `#${executionId}` : ""}</DialogTitle>
          <DialogDescription>{(execution as any)?.archived ? "Resumo preservado no arquivo histórico do Firestore. Campos sensíveis são mascarados no backend." : "Dados técnicos retornados diretamente pela execução do n8n. Campos sensíveis são mascarados no backend."}</DialogDescription>
        </DialogHeader>
      </div>
      <div className="max-h-[calc(92vh-110px)] overflow-y-auto px-6 py-5">
        {detail.isLoading ? <div className="py-16 text-center text-sm text-muted-foreground">Carregando detalhes da execução…</div> : detail.isError || detail.data?.status !== "ok" || !execution ? <div className="flex items-start gap-3 rounded-2xl border border-feedback-error-border bg-feedback-error-surface p-4 text-sm text-feedback-error"><AlertTriangle className="mt-0.5 h-5 w-5" /><div><p className="font-semibold">Não foi possível abrir esta execução.</p><p className="mt-1 text-xs">O n8n não retornou os dados detalhados desta execução.</p></div></div> : <div className="space-y-6">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl bg-background p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Automação / área</p><p className="mt-2 text-sm font-semibold text-foreground">{execution.sectionName || "Fluxo principal"}</p><p className="mt-1 text-xs text-muted-foreground">Workflow: {execution.workflowName}</p></div>
            <div className="rounded-2xl bg-background p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Status</p><Badge className={`mt-2 ${statusClass(execution.status)}`}>{statusLabel(execution.status)}</Badge></div>
            <div className="rounded-2xl bg-background p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Duração</p><p className="mt-2 text-sm font-semibold text-foreground">{execution.duration != null ? `${execution.duration}s` : "—"}</p></div>
            <div className="rounded-2xl bg-background p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Último node</p><p className="mt-2 text-sm font-semibold text-foreground">{execution.lastNodeExecuted || "—"}</p></div>
          </div>

          {execution.error && <div className="rounded-2xl border border-feedback-error-border bg-feedback-error-surface p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-feedback-error"><AlertTriangle className="h-4 w-4" />Erro da execução</div><JsonBlock value={execution.error} /></div>}

          {(execution as any).archived && !(execution as any).detailsAvailable && <div className="rounded-2xl border border-border bg-muted p-4 text-sm text-muted-foreground">Esta execução foi preservada no arquivo histórico. O resumo operacional está disponível, mas o payload técnico completo não foi armazenado ou já não está disponível no n8n.</div>}

          <NodeDiagnostics nodes={nodes} />
          <section>
            <div className="mb-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h3 className="flex items-center gap-2 text-base font-semibold text-foreground"><Workflow className="h-4 w-4 text-feedback-info" />Etapas executadas</h3><p className="mt-1 text-xs text-muted-foreground">Acompanhe o caminho percorrido pela automação em linguagem simples.</p></div><div className="flex items-center gap-3"><span className="text-xs font-semibold text-muted-foreground">{nodes.length} etapa(s)</span><button type="button" onClick={() => setAdvanced((value) => !value)} className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-feedback-info hover:bg-background">{advanced ? "Ocultar dados técnicos" : "Ver dados técnicos"}</button></div></div>
            {nodes.length === 0 ? <div className="rounded-2xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">O n8n não disponibilizou runData para esta execução.</div> : <div className="space-y-3">{nodes.map((node: any, index: number) => <details key={`${node.nodeName}-${node.runIndex}-${index}`} className="group rounded-2xl border border-border bg-card open:shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4"><div className="flex min-w-0 items-center gap-3"><div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${node.status === "error" ? "bg-feedback-error-surface text-feedback-error" : "bg-feedback-success-surface text-feedback-success"}`}>{node.status === "error" ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}</div><div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{node.nodeName}</p><p className="mt-1 text-xs text-muted-foreground">Run {node.runIndex + 1} · {node.outputItems} item(ns) de saída</p></div></div><div className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{node.executionTimeMs != null ? `${node.executionTimeMs}ms` : "—"}</span><Badge className={statusClass(node.status)}>{statusLabel(node.status)}</Badge></div></summary>
              {advanced && <div className="grid gap-4 border-t border-border px-4 py-4 lg:grid-cols-2"><div><p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground"><Code2 className="h-3.5 w-3.5" />Entrada / origem</p><JsonBlock value={node.input ?? node.source} /></div><div><p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground"><Code2 className="h-3.5 w-3.5" />Saída</p><JsonBlock value={node.output} /></div>{node.error && <div className="lg:col-span-2"><p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-feedback-error">Erro do node</p><JsonBlock value={node.error} /></div>}</div>}
            </details>)}</div>}
          </section>
        </div>}
      </div>
    </DialogContent>
  </Dialog>;
}
