import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, Eye, UserRound } from "lucide-react";
import ExecutionDetailDialog from "@/components/ExecutionDetailDialog";
import IncidentLifecycleDialog from "@/components/IncidentLifecycleDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { triageIncidents, type IncidentFilter, type TriageIncident } from "@/lib/incidentTriage";

const filterLabels: Record<IncidentFilter, string> = { attention: "Requer atenção", open: "Em aberto", resolved: "Resolvidos" };
const severityLabels = { critical: "Crítica", high: "Alta", medium: "Média", low: "Baixa" } as const;
const statusLabels = { new: "Novo", acknowledged: "Reconhecido", investigating: "Em investigação", resolved: "Resolvido" } as const;
const severityClasses = {
  critical: "border-red-200 bg-red-50 text-red-700",
  high: "border-orange-200 bg-orange-50 text-orange-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-slate-200 bg-slate-50 text-slate-700",
} as const;

type Incident = TriageIncident & {
  automation: string;
  workflowName: string;
  cause: string;
  errorMessage?: string;
  executionId: string;
  runbook?: { owner?: string | null; url?: string | null; instructions?: string | null } | null;
};

function ageLabel(minutes: number | null) {
  if (minutes == null) return "Tempo indisponível";
  if (minutes < 60) return `Aberto há ${minutes} min`;
  if (minutes < 1440) return `Aberto há ${Math.floor(minutes / 60)} h`;
  return `Aberto há ${Math.floor(minutes / 1440)} dia(s)`;
}

export default function IncidentAttentionCenter({ incidents, loading }: { incidents: Incident[]; loading: boolean }) {
  const [filter, setFilter] = useState<IncidentFilter>("attention");
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [selectedExecution, setSelectedExecution] = useState<string | null>(null);
  const triage = useMemo(() => triageIncidents(incidents, filter), [incidents, filter]);

  return <>
    <Card className="mt-6 border-0">
      <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
        <div><CardTitle className="flex items-center gap-2 text-base"><AlertCircle className="h-5 w-5 text-[#BD6338]" />Centro de atenção</CardTitle><p className="mt-1 text-sm text-muted-foreground">Incidentes priorizados pelo impacto e pelo tempo aguardando atuação.</p></div>
        <div className="flex flex-wrap gap-2">{(Object.keys(filterLabels) as IncidentFilter[]).map((value) => <Button key={value} type="button" size="sm" variant={filter === value ? "default" : "outline"} onClick={() => setFilter(value)}>{filterLabels[value]} ({triage.counts[value]})</Button>)}</div>
      </CardHeader>
      <CardContent>
        {loading ? <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-36 animate-pulse rounded-xl bg-muted" />)}</div> : triage.items.length ? <div className="grid gap-3 md:grid-cols-2">{triage.items.slice(0, 8).map((incident) => <div key={incident.fingerprint} className="rounded-xl border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold">{incident.automation}</p><p className="mt-1 text-xs text-muted-foreground">{incident.cause}</p></div><Badge variant="outline" className={severityClasses[incident.lifecycle.severity]}>{severityLabels[incident.lifecycle.severity]}</Badge></div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{ageLabel(incident.ageMinutes)}{incident.overdue ? " · atrasado" : ""}</span><span className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" />{incident.lifecycle.owner || "Sem responsável"}</span><span>{incident.count} ocorrência(s)</span></div>
          <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">Próxima ação</p><p className="mt-1 text-xs font-medium">{incident.nextAction}</p></div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><Badge variant="outline">{statusLabels[incident.lifecycle.status]}{incident.silenced ? " · silenciado" : ""}</Badge><div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setSelectedExecution(incident.executionId)}><Eye className="mr-2 h-3.5 w-3.5" />Abrir execução</Button><Button type="button" size="sm" onClick={() => setSelectedIncident(incident as Incident)}>Tratar incidente</Button></div></div>
        </div>)}</div> : <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed text-center"><CheckCircle2 className="h-7 w-7 text-emerald-600" /><p className="mt-3 text-sm font-semibold">Nenhum incidente nesta visão</p><p className="mt-1 text-xs text-muted-foreground">Os novos casos aparecerão aqui automaticamente.</p></div>}
      </CardContent>
    </Card>
    <ExecutionDetailDialog executionId={selectedExecution} open={Boolean(selectedExecution)} onOpenChange={(open) => !open && setSelectedExecution(null)} />
    <IncidentLifecycleDialog incident={selectedIncident as any} open={Boolean(selectedIncident)} onOpenChange={(open) => !open && setSelectedIncident(null)} onOpenExecution={(id) => { setSelectedIncident(null); setSelectedExecution(id); }} />
  </>;
}
