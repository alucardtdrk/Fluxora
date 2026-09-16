import { useMemo } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, GitCompareArrows } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";

function statusLabel(status?: string) {
  if (status === "success") return "Sucesso";
  if (["error", "failed", "crashed"].includes(status || "")) return "Erro";
  if (["running", "new"].includes(status || "")) return "Em andamento";
  return status || "Desconhecido";
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]));
  return value ?? null;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

export default function ExecutionComparisonDialog({ executionIds, open, onOpenChange }: { executionIds: string[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const first = trpc.n8n.executionDetail.useQuery({ id: executionIds[0] || "" }, { enabled: open && Boolean(executionIds[0]), retry: false });
  const second = trpc.n8n.executionDetail.useQuery({ id: executionIds[1] || "" }, { enabled: open && Boolean(executionIds[1]), retry: false });
  const left = first.data?.execution;
  const right = second.data?.execution;
  const comparison = useMemo(() => {
    if (!left || !right) return null;
    const leftNodes = left.nodes ?? [];
    const rightNodes = right.nodes ?? [];
    const key = (node: any) => `${node.nodeName || "Node"}:${node.runIndex ?? 0}`;
    const leftMap = new Map<string, any>(leftNodes.map((node: any) => [key(node), node] as [string, any]));
    const rightMap = new Map<string, any>(rightNodes.map((node: any) => [key(node), node] as [string, any]));
    const keys = Array.from(new Set([...leftMap.keys(), ...rightMap.keys()]));
    const divergenceIndex = Array.from({ length: Math.max(leftNodes.length, rightNodes.length) }).findIndex((_, index) => key(leftNodes[index] || {}) !== key(rightNodes[index] || {}));
    return {
      divergence: divergenceIndex >= 0 ? { index: divergenceIndex, left: leftNodes[divergenceIndex]?.nodeName, right: rightNodes[divergenceIndex]?.nodeName } : null,
      rows: keys.map((nodeKey) => {
        const a: any = leftMap.get(nodeKey);
        const b: any = rightMap.get(nodeKey);
        return { key: nodeKey, name: a?.nodeName || b?.nodeName, left: a, right: b, durationDelta: a?.executionTimeMs != null && b?.executionTimeMs != null ? b.executionTimeMs - a.executionTimeMs : null, inputChanged: Boolean(a && b && !sameValue(a.input ?? a.source, b.input ?? b.source)), outputChanged: Boolean(a && b && !sameValue(a.output, b.output)) };
      }),
    };
  }, [left, right]);
  const loading = first.isLoading || second.isLoading;
  const invalid = first.isError || second.isError || (left && right && left.workflowId !== right.workflowId);

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-6xl">
    <div className="border-b px-6 py-5"><DialogHeader><DialogTitle className="flex items-center gap-2"><GitCompareArrows className="h-5 w-5 text-[#4355D8]" />Comparar execuções</DialogTitle><DialogDescription>Diferenças no caminho executado, duração e dados de cada etapa.</DialogDescription></DialogHeader></div>
    <div className="max-h-[calc(92vh-105px)] overflow-y-auto px-6 py-5">
      {loading ? <div className="py-16 text-center text-sm text-[#667085]">Preparando comparação...</div> : invalid || !left || !right ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertTriangle className="mr-2 inline h-4 w-4" />Só é possível comparar duas execuções disponíveis do mesmo workflow.</div> : <div className="space-y-6">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr]"><ExecutionSummary execution={left} /><div className="hidden items-center md:flex"><ArrowRight className="h-5 w-5 text-[#98A2B3]" /></div><ExecutionSummary execution={right} /></div>
        {!(left.nodes?.length) || !(right.nodes?.length) ? <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">Uma das execuções não possui detalhes de nodes preservados. A comparação de status e duração continua disponível, mas o caminho pode ficar incompleto.</div> : null}
        <div className={`rounded-xl border p-4 ${comparison?.divergence ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>{comparison?.divergence ? <><p className="text-sm font-semibold text-amber-900">Primeiro ponto de divergência: etapa {comparison.divergence.index + 1}</p><p className="mt-1 text-xs text-amber-800">#{left.id}: {comparison.divergence.left || "etapa ausente"} · #{right.id}: {comparison.divergence.right || "etapa ausente"}</p></> : <p className="text-sm font-semibold text-emerald-800"><CheckCircle2 className="mr-2 inline h-4 w-4" />As duas execuções percorreram o mesmo caminho.</p>}</div>
        <div className="overflow-x-auto rounded-xl border"><div className="min-w-[900px]"><div className="grid grid-cols-[1.3fr_.55fr_.7fr_.7fr_.8fr] gap-3 bg-[#F5F7FB] px-4 py-3 text-[10px] font-bold uppercase tracking-[.12em] text-[#667085]"><span>Node</span><span>Presença</span><span>Tempo na primeira</span><span>Tempo na segunda</span><span>Diferenças</span></div>{comparison?.rows.map((row) => <div key={row.key} className="grid grid-cols-[1.3fr_.55fr_.7fr_.7fr_.8fr] gap-3 border-t px-4 py-3 text-xs"><span className="font-semibold">{row.name}</span><span>{row.left && row.right ? "Ambas" : row.left ? `Somente #${left.id}` : `Somente #${right.id}`}</span><span>{row.left?.executionTimeMs != null ? `${row.left.executionTimeMs}ms` : "—"}</span><span>{row.right?.executionTimeMs != null ? `${row.right.executionTimeMs}ms` : "—"}{row.durationDelta != null ? <small className={`ml-2 ${row.durationDelta > 0 ? "text-red-600" : "text-emerald-600"}`}>{row.durationDelta > 0 ? "+" : ""}{row.durationDelta}ms</small> : null}</span><span className="flex flex-wrap gap-1">{row.inputChanged ? <Badge variant="outline">Entrada alterada</Badge> : null}{row.outputChanged ? <Badge variant="outline">Saída alterada</Badge> : null}{row.left?.status !== row.right?.status && row.left && row.right ? <Badge variant="outline">Status alterado</Badge> : null}{!row.inputChanged && !row.outputChanged && row.left && row.right && row.left?.status === row.right?.status ? "Sem diferença relevante" : null}</span></div>)}</div></div>
        <ChangedData rows={comparison?.rows ?? []} leftId={String(left.id)} rightId={String(right.id)} />
      </div>}
    </div>
  </DialogContent></Dialog>;
}

function ExecutionSummary({ execution }: { execution: any }) {
  return <div className="rounded-xl bg-[#F5F7FB] p-4"><div className="flex items-center justify-between gap-3"><p className="font-semibold">Execução #{execution.id}</p><Badge variant="outline">{statusLabel(execution.status)}</Badge></div><p className="mt-2 text-xs text-[#667085]">{execution.startedAt ? new Date(execution.startedAt).toLocaleString("pt-BR") : "Data indisponível"}</p><p className="mt-3 flex items-center gap-1 text-sm"><Clock3 className="h-4 w-4 text-[#4355D8]" />{execution.duration != null ? `${execution.duration}s` : "Duração indisponível"} · {(execution.nodes ?? []).length} etapas</p></div>;
}

function ChangedData({ rows, leftId, rightId }: { rows: any[]; leftId: string; rightId: string }) {
  const changed = rows.filter((row) => row.inputChanged || row.outputChanged);
  if (!changed.length) return null;
  return <section><h3 className="text-sm font-semibold">Dados alterados nas etapas</h3><p className="mt-1 text-xs text-[#667085]">Abra uma etapa para consultar os valores preservados de cada execução.</p><div className="mt-3 space-y-2">{changed.map((row) => <details key={row.key} className="rounded-xl border bg-white"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold">{row.name}</summary><div className="grid gap-4 border-t p-4 lg:grid-cols-2"><DataColumn title={`Execução #${leftId}`} node={row.left} /><DataColumn title={`Execução #${rightId}`} node={row.right} /></div></details>)}</div></section>;
}

function DataColumn({ title, node }: { title: string; node: any }) {
  if (!node) return <div><p className="text-xs font-semibold">{title}</p><p className="mt-2 text-xs text-[#98A2B3]">Etapa não executada.</p></div>;
  return <div className="min-w-0"><p className="text-xs font-semibold">{title}</p><p className="mb-1 mt-3 text-[10px] font-bold uppercase tracking-[.12em] text-[#667085]">Entrada</p><pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[#11183D] p-3 text-[10px] leading-4 text-[#E8ECFF]">{JSON.stringify(node.input ?? node.source ?? null, null, 2)}</pre><p className="mb-1 mt-3 text-[10px] font-bold uppercase tracking-[.12em] text-[#667085]">Saída</p><pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[#11183D] p-3 text-[10px] leading-4 text-[#E8ECFF]">{JSON.stringify(node.output ?? null, null, 2)}</pre></div>;
}
