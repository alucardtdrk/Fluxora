import { useEffect, useMemo, useState } from "react";
import { BookOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

export default function WorkflowRunbookManager() {
  const utils = trpc.useUtils();
  const workflows = trpc.n8n.workflows.useQuery(undefined, { retry: false });
  const runbooks = trpc.n8n.runbooks.useQuery(undefined, { retry: false });
  const save = trpc.n8n.saveRunbook.useMutation();
  const [workflowId, setWorkflowId] = useState("");
  const [owner, setOwner] = useState("");
  const [url, setUrl] = useState("");
  const [instructions, setInstructions] = useState("");
  const items = workflows.data?.items ?? [];
  const selected = useMemo(() => items.find((item) => item.id === workflowId), [items, workflowId]);

  useEffect(() => { if (!workflowId && items[0]?.id) setWorkflowId(items[0].id); }, [items, workflowId]);
  useEffect(() => {
    const current = runbooks.data?.find((item) => item.workflowId === workflowId);
    setOwner(current?.owner || "");
    setUrl(current?.url || "");
    setInstructions(current?.instructions || "");
  }, [workflowId, runbooks.data]);

  const submit = async () => {
    try {
      await save.mutateAsync({ workflowId, workflowName: selected?.name, owner: owner || null, url: url || null, instructions: instructions || null });
      await Promise.all([utils.n8n.runbooks.invalidate(), utils.n8n.analytics.invalidate()]);
      toast.success("Runbook salvo");
    } catch (error) {
      toast.error("Não foi possível salvar o runbook", { description: error instanceof Error ? error.message : undefined });
    }
  };

  return <Card className="border-0 lg:col-span-2">
    <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BookOpen className="h-4 w-4 text-[#4355D8]" />Orientações de resposta por workflow</CardTitle><p className="text-xs text-[#667085]">Registre quem deve atuar e o passo a passo que aparecerá junto aos incidentes desse workflow.</p></CardHeader>
    <CardContent className="grid gap-5 md:grid-cols-2">
      <div className="md:col-span-2"><Label>Workflow</Label><Select value={workflowId} onValueChange={setWorkflowId}><SelectTrigger className="mt-2"><SelectValue placeholder="Selecione um workflow" /></SelectTrigger><SelectContent>{items.map((workflow) => <SelectItem key={workflow.id} value={workflow.id}>{workflow.name}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>Responsável ou equipe</Label><Input className="mt-2" value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Ex.: Facilities" /></div>
      <div><Label>Link de apoio</Label><Input className="mt-2" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." /></div>
      <div className="md:col-span-2"><Label>Como responder</Label><Textarea className="mt-2 min-h-28" value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Passos de diagnóstico, contatos e ação segura..." /></div>
      <Button className="w-fit bg-[#4355D8] hover:bg-[#3546C7]" disabled={!workflowId || save.isPending} onClick={submit}>{save.isPending ? "Salvando..." : "Salvar orientações"}</Button>
    </CardContent>
  </Card>;
}
