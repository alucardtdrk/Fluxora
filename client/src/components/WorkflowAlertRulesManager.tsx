import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";

export default function WorkflowAlertRulesManager() {
  const utils = trpc.useUtils();
  const workflows = trpc.n8n.workflows.useQuery(undefined, { retry: false });
  const rules = trpc.n8n.alertRules.useQuery(undefined, { retry: false });
  const save = trpc.n8n.saveAlertRule.useMutation();
  const [workflowId, setWorkflowId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [failureRate, setFailureRate] = useState("5");
  const [consecutiveFailures, setConsecutiveFailures] = useState("3");
  const [inactivityHours, setInactivityHours] = useState("24");
  const [severity, setSeverity] = useState<"critical" | "high" | "medium" | "low">("high");
  const items = workflows.data?.items ?? [];
  const selected = useMemo(() => items.find((item) => item.id === workflowId), [items, workflowId]);
  const selectedRule = useMemo(() => rules.data?.find((item) => item.workflowId === workflowId), [rules.data, workflowId]);

  useEffect(() => { if (!workflowId && items[0]?.id) setWorkflowId(items[0].id); }, [items, workflowId]);
  useEffect(() => {
    const current = rules.data?.find((item) => item.workflowId === workflowId);
    setEnabled(current?.enabled ?? true);
    setFailureRate(String(current?.failureRateThreshold ?? 5));
    setConsecutiveFailures(String(current?.consecutiveFailures ?? 3));
    setInactivityHours(String(current?.inactivityHours ?? 24));
    setSeverity(current?.severity ?? "high");
  }, [workflowId, rules.data]);

  const submit = async () => {
    try {
      await save.mutateAsync({ workflowId, workflowName: selected?.name, enabled, failureRateThreshold: Number(failureRate), consecutiveFailures: Number(consecutiveFailures), inactivityHours: Number(inactivityHours), severity });
      await Promise.all([utils.n8n.alertRules.invalidate(), utils.n8n.analytics.invalidate()]);
      toast.success("Regra de alerta salva");
    } catch (error) {
      toast.error("Não foi possível salvar a regra", { description: error instanceof Error ? error.message : undefined });
    }
  };

  return <Card className="border-0 lg:col-span-2">
    <CardHeader className="space-y-2 px-6 pb-5 pt-6 md:px-7 md:pt-7">
      <div className="flex flex-wrap items-center gap-2"><CardTitle className="flex items-center gap-2 text-base"><SlidersHorizontal className="h-4 w-4 text-[#4355D8]" />Regras específicas por workflow</CardTitle>{workflowId ? <Badge variant="outline" className={selectedRule ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-blue-200 bg-blue-50 text-blue-700"}>{selectedRule ? "Regra salva" : "Nova regra"}</Badge> : null}</div>
      <p className="max-w-3xl text-sm leading-5 text-[#667085]">Defina quando um workflow precisa aparecer no Monitoramento. Os limites são compartilhados com toda a equipe.</p>
    </CardHeader>
    <CardContent className="space-y-6 px-6 pb-6 md:px-7 md:pb-7">
      <div className="grid gap-4 rounded-xl border bg-[#F8F9FC] p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:p-5">
        <div><Label>Workflow monitorado</Label><Select value={workflowId} onValueChange={setWorkflowId}><SelectTrigger className="mt-2 bg-white"><SelectValue placeholder="Selecione um workflow" /></SelectTrigger><SelectContent>{items.map((workflow) => <SelectItem key={workflow.id} value={workflow.id}>{workflow.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="flex min-h-10 items-center gap-3 rounded-lg bg-white px-4 py-2 ring-1 ring-border"><Switch id="workflow-alert-enabled" checked={enabled} onCheckedChange={setEnabled} /><Label htmlFor="workflow-alert-enabled" className="cursor-pointer whitespace-nowrap">Regra ativa</Label></div>
      </div>

      <div>
        <div className="mb-4"><p className="text-sm font-semibold">Condições para gerar o alerta</p><p className="mt-1 text-xs text-[#667085]">O alerta será aberto quando qualquer uma das condições abaixo for atingida.</p></div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border p-4"><Label htmlFor="workflow-failure-rate">Taxa de falha</Label><p className="mt-1 min-h-9 text-xs leading-4 text-[#667085]">Percentual de execuções concluídas com erro.</p><div className="relative mt-3"><Input id="workflow-failure-rate" className="pr-10" type="number" min="0" max="100" step="0.1" value={failureRate} onChange={(event) => setFailureRate(event.target.value)} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#667085]">%</span></div></div>
          <div className="rounded-xl border p-4"><Label htmlFor="workflow-consecutive-failures">Falhas consecutivas</Label><p className="mt-1 min-h-9 text-xs leading-4 text-[#667085]">Quantidade de erros seguidos sem uma execução bem-sucedida.</p><Input id="workflow-consecutive-failures" className="mt-3" type="number" min="1" max="100" value={consecutiveFailures} onChange={(event) => setConsecutiveFailures(event.target.value)} /></div>
          <div className="rounded-xl border p-4"><Label htmlFor="workflow-inactivity-hours">Tempo sem executar</Label><p className="mt-1 min-h-9 text-xs leading-4 text-[#667085]">Horas sem nenhuma nova execução do workflow.</p><div className="relative mt-3"><Input id="workflow-inactivity-hours" className="pr-16" type="number" min="1" value={inactivityHours} onChange={(event) => setInactivityHours(event.target.value)} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#667085]">horas</span></div></div>
        </div>
      </div>

      <div className="flex flex-col gap-4 border-t pt-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full sm:max-w-[220px]"><Label>Prioridade do alerta</Label><Select value={severity} onValueChange={(value) => setSeverity(value as typeof severity)}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="critical">Crítica</SelectItem><SelectItem value="high">Alta</SelectItem><SelectItem value="medium">Média</SelectItem><SelectItem value="low">Baixa</SelectItem></SelectContent></Select><p className="mt-2 text-xs text-[#667085]">Usada para ordenar os itens que exigem atuação.</p></div>
        <Button className="w-full bg-[#4355D8] px-6 hover:bg-[#3546C7] sm:w-auto" disabled={!workflowId || save.isPending} onClick={submit}>{save.isPending ? "Salvando..." : selectedRule ? "Atualizar regra" : "Salvar regra"}</Button>
      </div>
    </CardContent>
  </Card>;
}
