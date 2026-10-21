import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, UserRound } from "lucide-react";
import ExecutionDetailDialog from "@/components/ExecutionDetailDialog";
import IncidentLifecycleDialog from "@/components/IncidentLifecycleDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { triageIncidents, type IncidentFilter, type TriageIncident } from "@/lib/incidentTriage";

const filterLabels: Record<IncidentFilter, string> = { attention: "Pendentes", investigating: "Investigação", resolved: "Resolvidos" };
const severityLabels = { critical: "Crítica", high: "Alta", medium: "Média", low: "Baixa" } as const;
const severityClasses = {
  critical: "border-feedback-error-border bg-feedback-error-surface text-feedback-error",
  high: "border-feedback-error-border bg-feedback-error-surface text-feedback-error",
  medium: "border-feedback-error-border bg-feedback-error-surface text-feedback-error",
  low: "border-border bg-muted text-muted-foreground",
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
  const [showAllResolved, setShowAllResolved] = useState(false);
  const columns = useMemo(() => (Object.keys(filterLabels) as IncidentFilter[]).map((value) => ({ value, label: filterLabels[value], items: triageIncidents(incidents, value).items })), [incidents]);

  return <>
    <Card className="mt-6 border-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><AlertCircle className="h-5 w-5 text-feedback-error" />Centro de atenção</CardTitle>
        <p className="text-sm text-muted-foreground">Acompanhe o atendimento de cada incidente. Abra um cartão para assumir, investigar ou registrar a resolução.</p>
        <div className="flex flex-wrap gap-2 pt-2 lg:hidden" aria-label="Etapas dos incidentes">{columns.map(({ value, label, items }) => <Button key={value} type="button" size="sm" aria-pressed={filter === value} variant={filter === value ? "default" : "outline"} onClick={() => setFilter(value)}>{label} ({loading ? "…" : items.length})</Button>)}</div>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-3">
        {columns.map(({ value, label, items }) => <section key={value} aria-label={label} className={`${filter === value ? "block" : "hidden"} min-w-0 rounded-xl bg-muted/40 p-3 lg:block`}>
          <div className="mb-3 flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold"><span className={`size-2 rounded-full ${value === "attention" ? "bg-amber-500" : value === "investigating" ? "bg-primary" : "bg-emerald-500"}`} aria-hidden="true" />{label}</h3><Badge variant="secondary" className="tabular-nums">{loading ? "…" : items.length}</Badge></div>
          <ScrollArea className="h-[400px] lg:h-[460px]">
            <div className="space-y-3 pr-3">
              {loading ? Array.from({ length: 2 }, (_, index) => <div key={index} className="h-36 animate-pulse rounded-lg bg-muted" />) : items.length ? (value === "resolved" && !showAllResolved ? items.slice(0, 5) : items).map((incident) => <button key={incident.fingerprint} type="button" onClick={() => setSelectedIncident(incident)} aria-label={`Abrir atendimento de ${incident.automation}`} className="block w-full rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex items-start justify-between gap-2"><span className="min-w-0 break-words text-sm font-semibold">{incident.automation}</span><Badge variant="outline" className={severityClasses[incident.lifecycle.severity]}>{severityLabels[incident.lifecycle.severity]}</Badge></span>
                <span className="mt-1 block break-words text-xs leading-5 text-muted-foreground">{incident.cause}</span>
                <span className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><UserRound className="size-3.5 shrink-0" /><span className="min-w-0 break-all">{incident.lifecycle.owner || "Sem responsável"}</span></span>
                <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"><span className="flex items-center gap-1"><Clock3 className="size-3 shrink-0" />{value === "resolved" ? incident.lifecycle.resolvedAt ? `Resolvido em ${new Date(incident.lifecycle.resolvedAt).toLocaleDateString("pt-BR")}` : "Resolvido" : ageLabel(incident.ageMinutes)}{incident.overdue ? " · atrasado" : ""}</span><span>{incident.count} ocorrência(s)</span></span>
                {incident.silenced && <span className="mt-2 block text-[11px] text-muted-foreground">Notificações silenciadas</span>}
                <span className="mt-3 block border-t pt-2 text-xs font-medium text-primary">{incident.nextAction}</span>
              </button>) : <div className="flex min-h-32 flex-col items-center justify-center px-2 text-center"><CheckCircle2 className="size-5 text-muted-foreground" /><p className="mt-2 text-xs text-muted-foreground">{value === "attention" ? "Nenhum incidente pendente." : value === "investigating" ? "Nenhum incidente em investigação." : "Nenhuma resolução registrada."}</p></div>}
              {value === "resolved" && !loading && items.length > 5 && <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => setShowAllResolved((current) => !current)}>{showAllResolved ? "Mostrar apenas os 5 mais recentes" : `Ver mais ${items.length - 5} resolvidos`}</Button>}
            </div>
          </ScrollArea>
        </section>)}
      </CardContent>    </Card>
    <ExecutionDetailDialog executionId={selectedExecution} open={Boolean(selectedExecution)} onOpenChange={(open) => !open && setSelectedExecution(null)} />
    <IncidentLifecycleDialog incident={selectedIncident as any} open={Boolean(selectedIncident)} onOpenChange={(open) => !open && setSelectedIncident(null)} onOpenExecution={(id) => { setSelectedIncident(null); setSelectedExecution(id); }} />
  </>;
}
