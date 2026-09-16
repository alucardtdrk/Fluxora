import { useEffect, useState } from "react";
import { BookOpen, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

type Incident = {
  fingerprint: string;
  automation: string;
  workflowName: string;
  cause: string;
  errorMessage?: string;
  count: number;
  executionId: string;
  firstAt?: string;
  runbook?: { owner?: string | null; url?: string | null; instructions?: string | null } | null;
  lifecycle: { status: "new" | "acknowledged" | "investigating" | "resolved"; severity: "critical" | "high" | "medium" | "low"; owner?: string | null; note?: string | null; silencedUntil?: string | null; timeToAcknowledgeMinutes?: number | null; timeToResolveMinutes?: number | null; history?: Array<{ at: string; actor: string; action: string; note?: string | null }> };
};

export default function IncidentLifecycleDialog({ incident, open, onOpenChange, onOpenExecution }: { incident: Incident | null; open: boolean; onOpenChange: (open: boolean) => void; onOpenExecution: (id: string) => void }) {
  const utils = trpc.useUtils();
  const mutation = trpc.n8n.updateIncident.useMutation();
  const [status, setStatus] = useState<Incident["lifecycle"]["status"]>("new");
  const [severity, setSeverity] = useState<Incident["lifecycle"]["severity"]>("medium");
  const [owner, setOwner] = useState("");
  const [note, setNote] = useState("");
  const [silencedUntil, setSilencedUntil] = useState<string | null>(null);
  useEffect(() => {
    if (!incident) return;
    setStatus(incident.lifecycle.status);
    setSeverity(incident.lifecycle.severity);
    setOwner(incident.lifecycle.owner || "");
    setNote(incident.lifecycle.note || "");
    setSilencedUntil(incident.lifecycle.silencedUntil || null);
  }, [incident]);
  if (!incident) return null;
  const elapsed = (minutes?: number | null) => minutes == null ? "Ainda não registrado" : minutes < 60 ? `${minutes.toLocaleString("pt-BR")} min` : `${(minutes / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;

  const save = async () => {
    try {
      await mutation.mutateAsync({ fingerprint: incident.fingerprint, firstOccurredAt: incident.firstAt || null, status, severity, owner: owner || null, note: note || null, silencedUntil });
      await utils.n8n.analytics.invalidate();
      toast.success("Incidente atualizado");
      onOpenChange(false);
    } catch (error) {
      toast.error("Não foi possível atualizar o incidente", { description: error instanceof Error ? error.message : undefined });
    }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-2xl">
    <DialogHeader><DialogTitle>{incident.automation}</DialogTitle><DialogDescription>{incident.count} ocorrências agrupadas pela mesma causa provável.</DialogDescription></DialogHeader>
    <div className="rounded-xl bg-[#F5F7FB] p-4"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">Causa provável</Badge><span className="text-sm font-semibold">{incident.cause}</span></div>{incident.errorMessage ? <p className="mt-2 text-xs leading-5 text-[#667085]">{incident.errorMessage}</p> : null}</div>
    {incident.runbook ? <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-400/20 dark:bg-blue-500/10"><div className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-[#4355D8]" /><p className="text-sm font-semibold">Orientação de resposta</p></div>{incident.runbook.owner ? <p className="mt-2 text-xs text-[#667085]">Responsável: {incident.runbook.owner}</p> : null}{incident.runbook.instructions ? <p className="mt-2 whitespace-pre-line text-sm leading-6">{incident.runbook.instructions}</p> : null}{incident.runbook.url ? <a className="mt-3 inline-flex items-center text-sm font-semibold text-[#4355D8] hover:underline" href={incident.runbook.url} target="_blank" rel="noreferrer">Abrir material de apoio<ExternalLink className="ml-1 h-3.5 w-3.5" /></a> : null}</div> : null}
    <div className="grid gap-4 md:grid-cols-2"><div><Label>Status</Label><Select value={status} onValueChange={(value) => setStatus(value as typeof status)}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new">Novo</SelectItem><SelectItem value="acknowledged">Reconhecido</SelectItem><SelectItem value="investigating">Em investigação</SelectItem><SelectItem value="resolved">Resolvido</SelectItem></SelectContent></Select></div><div><Label>Severidade</Label><Select value={severity} onValueChange={(value) => setSeverity(value as typeof severity)}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="critical">Crítica</SelectItem><SelectItem value="high">Alta</SelectItem><SelectItem value="medium">Média</SelectItem><SelectItem value="low">Baixa</SelectItem></SelectContent></Select></div></div>
    <div><Label>Responsável</Label><Input className="mt-2" value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Nome ou e-mail" /></div>
    <div><Label>Observação</Label><Textarea className="mt-2" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Diagnóstico, ação tomada ou próximo passo" /></div>
    <div className="flex items-center justify-between rounded-xl border p-3 text-xs"><span>{silencedUntil && new Date(silencedUntil).getTime() > Date.now() ? `Alertas silenciados até ${new Date(silencedUntil).toLocaleString("pt-BR")}` : "Alertas ativos para este incidente"}</span><Button type="button" size="sm" variant="outline" onClick={() => setSilencedUntil(silencedUntil ? null : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())}>{silencedUntil ? "Reativar" : "Silenciar por 24h"}</Button></div>
    <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border p-3"><p className="text-xs text-[#667085]">Tempo até reconhecimento</p><p className="mt-1 text-sm font-semibold">{elapsed(incident.lifecycle.timeToAcknowledgeMinutes)}</p></div><div className="rounded-xl border p-3"><p className="text-xs text-[#667085]">Tempo até resolução</p><p className="mt-1 text-sm font-semibold">{elapsed(incident.lifecycle.timeToResolveMinutes)}</p></div></div>
    {incident.lifecycle.history?.length ? <div><p className="text-sm font-semibold">Histórico recente</p><div className="mt-2 max-h-28 space-y-2 overflow-auto text-xs text-[#667085]">{incident.lifecycle.history.slice(-5).reverse().map((item) => <div key={`${item.at}-${item.action}`} className="rounded-lg border p-2"><span className="font-medium text-[#11183D]">{item.action}</span> · {item.actor} · {new Date(item.at).toLocaleString("pt-BR")}{item.note ? <p className="mt-1">{item.note}</p> : null}</div>)}</div></div> : null}
    <DialogFooter className="sm:justify-between"><Button variant="outline" onClick={() => onOpenExecution(incident.executionId)}><ExternalLink className="mr-2 h-4 w-4" />Abrir execução</Button><Button onClick={save} disabled={mutation.isPending}>{mutation.isPending ? "Salvando..." : "Salvar incidente"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
