import { useMemo, useState } from "react";
import { AlertTriangle, ShieldAlert, ShieldCheck, UserRoundX } from "lucide-react";
import OperationsShell from "@/components/OperationsShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";

const sourceLabels: Record<string, string> = {
  alert_center: "Alert Center",
  login: "Login",
  admin: "Administração",
  oauth_token: "OAuth",
  drive: "Drive",
};

const severityLabels: Record<string, string> = {
  critical: "Crítica",
  high: "Alta",
  medium: "Média",
  low: "Baixa",
  informational: "Informativa",
};

function severityClass(severity: string) {
  if (severity === "critical" || severity === "high") return "bg-[#fff0e7] text-[#bd6338]";
  if (severity === "medium") return "bg-[#fff7d6] text-[#8b6a18]";
  return "bg-[#e3f6eb] text-[#258b57]";
}

function MetricCard({ icon: Icon, label, value, description }: { icon: typeof ShieldCheck; label: string; value: number; description: string }) {
  return <Card className="border-0"><CardContent className="p-5"><div className="flex items-start justify-between"><div><p className="text-xs font-medium text-[#667085]">{label}</p><p className="mt-2 text-3xl font-semibold tracking-[-.05em]">{value.toLocaleString("pt-BR")}</p></div><div className="rounded-xl bg-[#EEF1FF] p-2.5 text-[#4355D8]"><Icon className="h-5 w-5" /></div></div><p className="mt-3 text-xs text-[#667085]">{description}</p></CardContent></Card>;
}

function EventDetail({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return <div><dt className="text-xs font-medium text-[#667085]">{label}</dt><dd className="mt-1 break-words text-sm text-[#1d2939]">{value}</dd></div>;
}

export default function WorkspaceSecurity() {
  const dashboard = trpc.workspaceSecurity.overview.useQuery(undefined, { retry: false, refetchInterval: 30_000 });
  const [source, setSource] = useState("all");
  const [severity, setSeverity] = useState("all");
  const events = useMemo(() => (dashboard.data?.events ?? []).filter((event) =>
    (source === "all" || event.source === source) && (severity === "all" || event.severity === severity),
  ), [dashboard.data?.events, severity, source]);
  const summary = dashboard.data?.summary ?? { recentEvents: 0, highOrCriticalEvents: 0 };
  const posture = dashboard.data?.posture;
  const findings = dashboard.data?.findings ?? [];
  const [selectedEvent, setSelectedEvent] = useState<(typeof events)[number] | null>(null);

  return <OperationsShell><div className="mx-auto max-w-[1180px] px-5 py-8 md:px-9">
    <p className="text-[11px] font-bold uppercase tracking-[.18em] text-[#667085]">Operação / Workspace Security</p>
    <h2 className="mt-2 text-4xl font-semibold tracking-[-.05em]">Segurança do Google Workspace</h2>
    <p className="mt-2 text-sm text-[#667085]">Eventos de segurança e postura do domínio coletados pelo Fluxora.</p>

    <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard icon={ShieldCheck} label="Eventos recentes" value={summary.recentEvents} description="Registros disponíveis para análise." />
      <MetricCard icon={ShieldAlert} label="Alta ou crítica" value={summary.highOrCriticalEvents} description="Eventos que exigem atenção prioritária." />
      <MetricCard icon={AlertTriangle} label="Sem 2SV" value={posture?.usersWithoutTwoStepVerification ?? 0} description="Usuários sem verificação em duas etapas." />
      <MetricCard icon={UserRoundX} label="Usuários suspensos" value={posture?.suspendedUsers ?? 0} description="Contas suspensas no diretório." />
    </div>

    <Card className="mt-6 border-0"><CardHeader><CardTitle className="text-base">Requer atenção</CardTitle><p className="mt-1 text-xs text-[#667085]">Achados correlacionados a partir de sinais do Google Workspace.</p></CardHeader><CardContent>
      {findings.length === 0 ? <p className="py-3 text-sm text-[#667085]">Nenhum achado correlacionado no período.</p> : <div className="space-y-3">{findings.map((finding) => <div key={finding.id} className="rounded-xl border border-[#ececf3] p-4"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${severityClass(finding.severity)}`}>{severityLabels[finding.severity] ?? finding.severity}</span><p className="font-medium">{finding.title}</p></div><p className="mt-2 text-sm text-[#667085]">{finding.description}</p><p className="mt-3 text-xs text-[#667085]">{finding.evidenceCount} evidências · {finding.subjects.join(", ") || "Usuário não disponibilizado pelo Google"}</p></div>)}</div>}
    </CardContent></Card>

    <Card className="mt-6 border-0"><CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="text-base">Eventos recentes</CardTitle><p className="mt-1 text-xs text-[#667085]">Dados somente de leitura sincronizados do Google Workspace.</p></div><div className="flex gap-2"><Select value={source} onValueChange={setSource}><SelectTrigger className="w-[145px]"><SelectValue placeholder="Origem" /></SelectTrigger><SelectContent><SelectItem value="all">Todas as origens</SelectItem>{Object.entries(sourceLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Select value={severity} onValueChange={setSeverity}><SelectTrigger className="w-[135px]"><SelectValue placeholder="Severidade" /></SelectTrigger><SelectContent><SelectItem value="all">Todas</SelectItem>{Object.entries(severityLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div></CardHeader><CardContent>
      {dashboard.isLoading ? <p className="py-10 text-center text-sm text-[#667085]">Carregando eventos de segurança…</p> : dashboard.isError ? <p className="py-10 text-center text-sm text-[#bd6338]">Não foi possível carregar os dados de segurança. Tente novamente em instantes.</p> : events.length === 0 ? <p className="py-10 text-center text-sm text-[#667085]">Nenhum evento encontrado para os filtros selecionados.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b text-xs text-[#667085]"><tr><th className="pb-3 font-medium">Data</th><th className="pb-3 font-medium">Origem</th><th className="pb-3 font-medium">Severidade</th><th className="pb-3 font-medium">Evento</th><th className="pb-3 font-medium">Ator</th></tr></thead><tbody>{events.map((event) => <tr key={event.id} tabIndex={0} role="button" aria-label={`Ver detalhes de ${event.title}`} className="cursor-pointer border-b outline-none transition-colors hover:bg-[#f7f8ff] focus-visible:bg-[#f7f8ff] last:border-0" onClick={() => setSelectedEvent(event)} onKeyDown={(key) => { if (key.key === "Enter" || key.key === " ") { key.preventDefault(); setSelectedEvent(event); } }}><td className="py-4 text-[#667085]">{new Date(event.occurredAt).toLocaleString("pt-BR")}</td><td className="py-4">{sourceLabels[event.source] ?? event.source}</td><td className="py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${severityClass(event.severity)}`}>{severityLabels[event.severity] ?? event.severity}</span></td><td className="py-4"><p className="font-medium">{event.title}</p><p className="mt-1 max-w-md text-xs text-[#667085]">{event.description}</p></td><td className="py-4 text-[#667085]">{event.actor ?? "—"}</td></tr>)}</tbody></table></div>}
    </CardContent></Card>

    <Dialog open={Boolean(selectedEvent)} onOpenChange={(open) => { if (!open) setSelectedEvent(null); }}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{selectedEvent?.title}</DialogTitle>
          <DialogDescription>Detalhes seguros sincronizados do Google Workspace.</DialogDescription>
        </DialogHeader>
        {selectedEvent && <div className="space-y-5">
          <p className="text-sm leading-6 text-[#475467]">{selectedEvent.description}</p>
          <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <EventDetail label="Data" value={new Date(selectedEvent.occurredAt).toLocaleString("pt-BR")} />
            <EventDetail label="Severidade" value={severityLabels[selectedEvent.severity] ?? selectedEvent.severity} />
            <EventDetail label="Origem" value={sourceLabels[selectedEvent.source] ?? selectedEvent.source} />
            <EventDetail label="Categoria" value={selectedEvent.category} />
            <EventDetail label="Tipo" value={selectedEvent.type} />
            <EventDetail label="Identificador do evento" value={selectedEvent.externalId ?? selectedEvent.id} />
            <EventDetail label="Ator" value={selectedEvent.actor} />
            <EventDetail label="Alvo" value={selectedEvent.target} />
            <EventDetail label="Endereço IP" value={selectedEvent.ipAddress} />
            <EventDetail label="País" value={selectedEvent.country} />
          </dl>
          <div className="rounded-lg bg-[#f8f9fc] p-4 text-sm text-[#475467]">Revise o evento no Google Admin Console antes de realizar qualquer ação.</div>
        </div>}
      </DialogContent>
    </Dialog>
  </div></OperationsShell>;
}
