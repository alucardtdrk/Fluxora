import { useEffect, useMemo, useState } from "react";
import { Gauge } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";

export default function WorkflowSloManager() {
  const utils = trpc.useUtils();
  const workflows = trpc.n8n.workflows.useQuery(undefined, { retry: false });
  const slos = trpc.n8n.slos.useQuery(undefined, { retry: false });
  const save = trpc.n8n.saveSlo.useMutation();
  const [workflowId, setWorkflowId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [successTarget, setSuccessTarget] = useState("99");
  const [p95Target, setP95Target] = useState("30");

  const items = workflows.data?.items ?? [];
  const selected = useMemo(() => items.find((item) => item.id === workflowId), [items, workflowId]);
  useEffect(() => {
    if (!workflowId && items[0]?.id) setWorkflowId(items[0].id);
  }, [items, workflowId]);
  useEffect(() => {
    if (!workflowId) return;
    const current = slos.data?.find((item) => item.workflowId === workflowId);
    setEnabled(current?.enabled ?? true);
    setSuccessTarget(String(current?.successRateTarget ?? 99));
    setP95Target(String(current?.p95TargetSeconds ?? 30));
  }, [workflowId, slos.data]);

  const submit = async () => {
    try {
      await save.mutateAsync({ workflowId, workflowName: selected?.name, enabled, successRateTarget: Number(successTarget), p95TargetSeconds: Number(p95Target) });
      await Promise.all([utils.n8n.slos.invalidate(), utils.n8n.analytics.invalidate()]);
      toast.success("Meta do workflow salva");
    } catch (error) {
      toast.error("Não foi possível salvar a meta", { description: error instanceof Error ? error.message : undefined });
    }
  };

  return <Card className="border-0 lg:col-span-2">
    <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Gauge className="h-4 w-4 text-[#4355D8]" />Metas de confiabilidade por workflow</CardTitle><p className="text-xs text-[#667085]">Defina o nível mínimo de sucesso e o tempo máximo aceitável para 95% das execuções. O Analytics sinaliza automaticamente quando a meta não é cumprida.</p></CardHeader>
    <CardContent className="grid gap-5 md:grid-cols-[1.6fr_1fr_1fr_auto] md:items-end">
      <div><Label>Workflow</Label><Select value={workflowId} onValueChange={setWorkflowId}><SelectTrigger className="mt-2"><SelectValue placeholder="Selecione um workflow" /></SelectTrigger><SelectContent>{items.map((workflow) => <SelectItem key={workflow.id} value={workflow.id}>{workflow.name}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>Sucesso mínimo (%)</Label><Input className="mt-2" type="number" min="0" max="100" step="0.1" value={successTarget} onChange={(event) => setSuccessTarget(event.target.value)} /></div>
      <div><Label>Tempo máximo para 95% (segundos)</Label><Input className="mt-2" type="number" min="0.1" step="0.1" value={p95Target} onChange={(event) => setP95Target(event.target.value)} /></div>
      <div className="flex items-center gap-3 md:pb-2"><Switch checked={enabled} onCheckedChange={setEnabled} /><Label>Ativa</Label></div>
      <Button className="bg-[#4355D8] hover:bg-[#3546C7] md:col-span-full md:w-fit" disabled={!workflowId || save.isPending} onClick={submit}>{save.isPending ? "Salvando…" : "Salvar meta"}</Button>
    </CardContent>
  </Card>;
}
