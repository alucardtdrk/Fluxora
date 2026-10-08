import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ShieldAlert, ShieldCheck, UserRoundX } from "lucide-react";
import OperationsShell from "@/components/OperationsShell";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { shouldRefreshCurrentSecurity } from "@/lib/workspaceSecurityRefresh";

const sourceLabels: Record<string, string> = {
  alert_center: "Alert Center",
  login: "Login",
  admin: "Administração",
  oauth_token: "OAuth",
  drive: "Drive",
  groups: "Grupos",
  mobile: "Dispositivos",
  rules: "Regras",
  gmail: "Gmail",
  user_accounts: "Contas de usuário",
  saml: "SAML",
  calendar: "Agenda",
  chat: "Chat",
  meet: "Meet",
};

const severityLabels: Record<string, string> = {
  critical: "Crítica",
  high: "Alta",
  medium: "Média",
  low: "Baixa",
  informational: "Informativa",
};

function severityClass(severity: string) {
  if (severity === "critical" || severity === "high") return "bg-orange-100 text-orange-900 dark:bg-orange-400/20 dark:text-orange-200";
  if (severity === "medium") return "bg-amber-100 text-amber-900 dark:bg-amber-400/20 dark:text-amber-200";
  return "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/20 dark:text-emerald-200";
}

function MetricCard({ icon: Icon, label, value, description }: { icon: typeof ShieldCheck; label: string; value: number; description: string }) {
  return <Card className="border-0"><CardContent className="p-5"><div className="flex items-start justify-between"><div><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-semibold tracking-[-.05em]">{value.toLocaleString("pt-BR")}</p></div><div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Icon className="h-5 w-5" /></div></div><p className="mt-3 text-xs text-muted-foreground">{description}</p></CardContent></Card>;
}

function EventDetail({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return <div><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm text-foreground">{value}</dd></div>;
}

function eventName(source: string, type: string, fallback: string) {
  const names: Record<string, string> = {
    login_success: "Login realizado", login_failure: "Falha de login", login_verification: "Verificação de login", suspicious_login: "Login suspeito",
    authorize: "Aplicativo autorizado a acessar a conta", activity: "Atividade de acesso por aplicativo", change_event: "Evento da agenda alterado", ALERT_CENTER_VIEW: "Alerta consultado no Admin Console",
  };
  return names[type] ?? (source === "alert_center" ? fallback : type.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()));
}

function eventExplanation(source: string, type: string) {
  if (source === "admin" && type === "ALERT_CENTER_VIEW") return "Um administrador consultou um alerta no Admin Console. Este registro não indica que o alerta foi alterado.";
  if (source === "admin" && type === "SECURITY_INVESTIGATION_QUERY") return "Um administrador executou uma consulta na ferramenta de investigação de segurança. O registro não informa o conteúdo da consulta.";
  if (source === "login" && type === "login_success") return "A conta concluiu uma autenticação. Confira o ator, horário, método e endereço IP para entender o contexto.";
  if (source === "login" && type === "login_failure") return "Houve uma tentativa de autenticação sem sucesso. Confira o motivo, a conta e o endereço IP quando disponíveis.";
  return "O Google registrou esta atividade. Confira abaixo quem participou, quando ocorreu e os dados adicionais fornecidos pela fonte.";
}

export default function WorkspaceSecurity() {
  const { user } = useAuth();
  const dashboard = trpc.workspaceSecurity.overview.useQuery(undefined, { retry: false, refetchInterval: 300_000, staleTime: 300_000 });
  const automaticRefreshStarted = useRef(false);
  const refreshCurrent = trpc.workspaceSecurity.refreshCurrent.useMutation({
    onSuccess: async (result) => {
      await Promise.all([dashboard.refetch(), page.refetch()]);
      const statuses = Object.values(result.sources);
      const saved = statuses.reduce((total, item) => total + item.persisted, 0);
      const failures = statuses.filter((item) => item.status === "failure").length;
      const pending = statuses.filter((item) => item.status === "incomplete").length;
      if (failures > 0) toast.warning("Segurança atualizada parcialmente", { description: `${saved.toLocaleString("pt-BR")} eventos salvos; ${failures} fonte${failures === 1 ? "" : "s"} requer${failures === 1 ? "" : "em"} atenção.` });
      else if (pending > 0) toast.message("Lote de segurança concluído", { description: `${saved.toLocaleString("pt-BR")} eventos processados; há mais páginas em ${pending} fonte${pending === 1 ? "" : "s"}. Clique novamente para continuar.` });
      else toast.success("Segurança atualizada", { description: `${saved.toLocaleString("pt-BR")} eventos salvos a partir dos sinais atuais.` });
    },
    onError: (error) => toast.error("A segurança não foi atualizada", { description: error.message || "Tente novamente em instantes." }),
  });
  const continueBackfill = trpc.workspaceSecurity.continueBackfill.useMutation({
    onSuccess: async (result) => {
      await Promise.all([dashboard.refetch(), page.refetch()]);
      if (result.windowsProcessed > 0) {
        toast.success("Lote histórico processado", { description: `${result.eventsCollected.toLocaleString("pt-BR")} eventos coletados; ${result.sourcesCompleted} fonte${result.sourcesCompleted === 1 ? "" : "s"} concluiu${result.sourcesCompleted === 1 ? "" : "íram"} a cobertura.` });
      } else {
        toast.warning("Nenhum lote conseguiu avançar", { description: result.failedSources.length ? "Algumas fontes do Google Workspace não responderam. Consulte os avisos nas fontes de auditoria." : "A cobertura disponível já foi processada." });
      }
    },
    onError: (error) => toast.error("O histórico não avançou", { description: error.message || "Tente novamente em instantes." }),
  });
  const fullSync = trpc.admin.syncGoogleWorkspace.useMutation();
  const [fullSyncIndex, setFullSyncIndex] = useState(0);
  const [collectingAll, setCollectingAll] = useState(false);
  const collectAll = async () => {
    setCollectingAll(true);
    let index: number | null = fullSyncIndex;
    let failures = 0;
    let pending = 0;
    try {
      while (index !== null) {
        const result = await fullSync.mutateAsync({ startIndex: index });
        failures += Object.values(result.sources).filter((item) => item.status === "failure").length;
        pending += Object.values(result.sources).filter((item) => item.status === "incomplete").length;
        index = result.nextIndex;
        setFullSyncIndex(index ?? 0);
        await dashboard.refetch();
      }
      await page.refetch();
      if (failures) toast.warning("Coleta parcial: verifique as fontes com aviso");
      else if (pending) toast.message("Todas as fontes consultadas", { description: `${pending} fonte(s) ainda têm páginas pendentes. Clique novamente para continuar.` });
      else toast.success("Coleta completa finalizada");
    } catch (error) {
      toast.error("A coleta foi interrompida", { description: error instanceof Error && !/Unexpected token|not valid JSON/i.test(error.message) ? error.message : "Uma chamada falhou ou excedeu o tempo. Clique novamente para retomar do lote interrompido." });
    } finally {
      setCollectingAll(false);
    }
  };
  const [source, setSource] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [period, setPeriod] = useState("90d");
  const [category, setCategory] = useState("all");
  const [pageOffsets, setPageOffsets] = useState([0]);
  const page = trpc.workspaceSecurity.eventsPage.useQuery({ offset: pageOffsets[pageOffsets.length - 1], source: source === "all" ? undefined : source, severity: severity === "all" ? undefined : severity, category: category === "all" ? undefined : category, periodDays: Number.parseInt(period, 10) }, { retry: false });
  const events = page.data?.events ?? [];
  useEffect(() => { setPageOffsets([0]); }, [source, severity, category, period]);
  const categories = useMemo(() => [...new Set((dashboard.data?.events ?? []).map((event) => event.category))].sort(), [dashboard.data?.events]);
  const summary = dashboard.data?.summary ?? { recentEvents: 0, highOrCriticalEvents: 0, coveragePercent: 0, backfillPagesProcessed: 0 };
  const posture = dashboard.data?.posture;
  const findings = dashboard.data?.findings ?? [];
  const sources = dashboard.data?.sources ?? [];
  const [selectedEvent, setSelectedEvent] = useState<(typeof events)[number] | null>(null);

  useEffect(() => {
    if (automaticRefreshStarted.current || user?.role !== "admin" || !dashboard.data) return;
    automaticRefreshStarted.current = true;
    if (shouldRefreshCurrentSecurity(dashboard.data.sources)) refreshCurrent.mutate();
  }, [dashboard.data, refreshCurrent, user?.role]);

  return <OperationsShell><div className="mx-auto max-w-[1180px] px-5 py-8 md:px-9">
    <p className="text-[11px] font-bold uppercase tracking-[.18em] text-muted-foreground">Operação / Workspace Security</p>
    <h2 className="mt-2 text-4xl font-semibold tracking-[-.05em]">Segurança do Google Workspace</h2>
    <p className="mt-2 text-sm text-muted-foreground">Eventos de segurança e postura do domínio coletados pelo Fluxora.</p>
    {user?.role === "admin" && <div className="mt-4"><Button disabled={refreshCurrent.isPending} onClick={() => refreshCurrent.mutate()}>{refreshCurrent.isPending ? "Atualizando…" : "Atualizar segurança agora"}</Button></div>}

    <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard icon={ShieldCheck} label="Eventos na amostra" value={summary.recentEvents} description="Até 250 registros mais recentes; use a lista paginada para ver os anteriores." />
      <MetricCard icon={ShieldAlert} label="Alta ou crítica na amostra" value={summary.highOrCriticalEvents} description="Eventos prioritários entre os 250 mais recentes." />
      <MetricCard icon={AlertTriangle} label="Sem 2SV" value={posture?.usersWithoutTwoStepVerification ?? 0} description="Usuários sem verificação em duas etapas." />
      <MetricCard icon={UserRoundX} label="Usuários suspensos" value={posture?.suspendedUsers ?? 0} description="Contas suspensas no diretório." />
    </div>

    <Accordion type="single" collapsible className="mt-6 rounded-xl bg-card p-5 shadow-sm"><AccordionItem value="history"><AccordionTrigger className="py-0 text-sm font-semibold hover:no-underline">Coleta completa e histórico (opcional)</AccordionTrigger><AccordionContent className="pb-0"><p className="mt-3 text-sm text-muted-foreground">A coleta completa atualiza todas as fontes e a postura do domínio em lotes menores. É mais demorada que a atualização rápida.</p>{user?.role === "admin" && <Button className="mt-3" variant="outline" disabled={collectingAll} onClick={() => { void collectAll(); }}>{collectingAll ? "Coletando…" : "Coletar todas as fontes"}</Button>}<p className="mt-4 text-sm text-muted-foreground">{summary.coveragePercent}% dos 90 dias cobertos · {summary.backfillPagesProcessed ?? 0} páginas históricas processadas. A porcentagem só avança quando uma fonte termina suas páginas.</p><div className="mt-3 h-2 max-w-md overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${summary.coveragePercent}%` }} /></div>{user?.role === "admin" && <Button className="mt-4" variant="outline" disabled={continueBackfill.isPending} onClick={() => continueBackfill.mutate()}>{continueBackfill.isPending ? "Avançando…" : "Continuar histórico"}</Button>}</AccordionContent></AccordionItem></Accordion>

    <Card className="mt-6 border-0"><CardHeader><CardTitle className="text-base">Fontes de auditoria</CardTitle><p className="text-xs text-muted-foreground">Os números abaixo mostram apenas a última coleta de cada fonte, não o total armazenado.</p></CardHeader><CardContent>{sources.length === 0 ? <p className="text-sm text-muted-foreground">Execute uma sincronização para registrar as fontes.</p> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{sources.map((item) => <div key={item.source} className="rounded-xl border p-3"><p className="font-medium">{sourceLabels[item.source] ?? item.source}</p><p className="mt-1 text-xs text-muted-foreground">{item.status === "ok" ? "Ativa" : item.status === "empty" ? "Sem eventos no último lote" : item.status === "incomplete" ? "Mais páginas pendentes" : item.status === "failure" ? "Requer atenção" : "Aguardando"}</p><p className="mt-1 text-xs text-muted-foreground">Última coleta: {item.received} recebidos · {item.collected} aceitos · {item.persisted} salvos{item.completedAt ? ` · ${new Date(item.completedAt).toLocaleString("pt-BR")}` : ""}</p>{item.safeError && <p className="mt-1 text-xs text-orange-700 dark:text-orange-300">{item.safeError === "permission" ? "Revise a delegação de domínio e os escopos desta fonte." : item.safeError === "configuration" ? "Revise a configuração da integração." : item.safeError === "invalid_request" ? "O Google rejeitou os parâmetros desta consulta." : item.safeError === "rate_limited" ? "O limite temporário do Google foi atingido; tente novamente depois." : item.safeError === "upstream" ? "O Google apresentou uma indisponibilidade temporária." : "A fonte não respondeu como esperado; tente novamente."}{item.httpStatus ? ` (HTTP ${item.httpStatus})` : ""}</p>}</div>)}</div>}</CardContent></Card>

    {posture && <Card className="mt-6 border-0"><CardHeader><CardTitle className="text-base">Postura acionável</CardTitle></CardHeader><CardContent className="grid gap-5 md:grid-cols-2"><div><p className="font-medium">Sem verificação em duas etapas</p><div className="mt-3 max-h-52 space-y-2 overflow-y-auto">{posture.usersWithoutTwoStepVerificationDetails.map((person) => <div key={person.id} className="rounded-lg bg-muted/50 p-3 text-sm"><p className="font-medium">{person.displayName ?? person.email ?? person.id}</p><p className="text-xs text-muted-foreground">{person.email}{person.orgUnitPath ? ` · ${person.orgUnitPath}` : ""}</p></div>)}</div></div><div><p className="font-medium">Contas suspensas</p><div className="mt-3 max-h-52 space-y-2 overflow-y-auto">{posture.suspendedUserDetails.map((person) => <div key={person.id} className="rounded-lg bg-muted/50 p-3 text-sm"><p className="font-medium">{person.displayName ?? person.email ?? person.id}</p><p className="text-xs text-muted-foreground">{person.email}{person.orgUnitPath ? ` · ${person.orgUnitPath}` : ""}</p></div>)}</div></div></CardContent></Card>}

    <Card className="mt-6 border-0"><CardHeader><CardTitle className="text-base">Requer atenção</CardTitle><p className="mt-1 text-xs text-muted-foreground">Achados correlacionados a partir de sinais do Google Workspace.</p></CardHeader><CardContent>
      {findings.length === 0 ? <p className="py-3 text-sm text-muted-foreground">Nenhum padrão de risco correlacionado nas últimas 24 horas. Eventos individuais de alta severidade aparecem na lista abaixo e não geram necessariamente um achado.</p> : <div className="space-y-3">{findings.map((finding) => <div key={finding.id} className="rounded-xl border border-border p-4"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${severityClass(finding.severity)}`}>{severityLabels[finding.severity] ?? finding.severity}</span><p className="font-medium">{finding.title}</p></div><p className="mt-2 text-sm text-muted-foreground">{finding.description}</p><p className="mt-3 text-xs text-muted-foreground">{finding.evidenceCount} evidências · {finding.subjects.join(", ") || "Usuário não disponibilizado pelo Google"}</p></div>)}</div>}
    </CardContent></Card>

    <Card className="mt-6 border-0"><CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="text-base">Eventos recentes</CardTitle><p className="mt-1 text-xs text-muted-foreground">Dados somente de leitura sincronizados do Google Workspace.</p></div><div className="flex flex-wrap gap-2"><Select value={period} onValueChange={setPeriod}><SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1d">24 horas</SelectItem><SelectItem value="7d">7 dias</SelectItem><SelectItem value="30d">30 dias</SelectItem><SelectItem value="90d">90 dias</SelectItem></SelectContent></Select><Select value={source} onValueChange={setSource}><SelectTrigger className="w-[145px]"><SelectValue placeholder="Origem" /></SelectTrigger><SelectContent><SelectItem value="all">Todas as origens</SelectItem>{Object.entries(sourceLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Select value={category} onValueChange={setCategory}><SelectTrigger className="w-[145px]"><SelectValue placeholder="Categoria" /></SelectTrigger><SelectContent><SelectItem value="all">Todas categorias</SelectItem>{categories.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select><Select value={severity} onValueChange={setSeverity}><SelectTrigger className="w-[135px]"><SelectValue placeholder="Severidade" /></SelectTrigger><SelectContent><SelectItem value="all">Todas</SelectItem>{Object.entries(severityLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div></CardHeader><CardContent>
      {page.isLoading ? <p className="py-10 text-center text-sm text-muted-foreground">Carregando eventos de segurança…</p> : page.isError ? <p className="py-10 text-center text-sm text-orange-700 dark:text-orange-300">Não foi possível carregar os eventos. Tente novamente em instantes.</p> : events.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">Nenhum evento encontrado nesta página.</p> : <div className="overflow-x-auto"><table className="security-events w-full md:min-w-[760px] text-left text-sm"><thead className="border-b text-xs text-muted-foreground"><tr><th className="pb-3 font-medium">Data</th><th className="pb-3 font-medium">Origem</th><th className="pb-3 font-medium">Severidade</th><th className="pb-3 font-medium">Evento</th><th className="pb-3 font-medium">Ator</th></tr></thead><tbody>{events.map((event) => <tr key={event.id} tabIndex={0} role="button" aria-label={`Ver detalhes de ${eventName(event.source, event.type, event.title)}`} className="cursor-pointer border-b outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 last:border-0" onClick={() => setSelectedEvent(event)} onKeyDown={(key) => { if (key.key === "Enter" || key.key === " ") { key.preventDefault(); setSelectedEvent(event); } }}><td data-label="Data" className="py-4 text-muted-foreground">{new Date(event.occurredAt).toLocaleString("pt-BR")}</td><td data-label="Origem" className="py-4">{sourceLabels[event.source] ?? event.source}</td><td data-label="Severidade" className="py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${severityClass(event.severity)}`}>{severityLabels[event.severity] ?? event.severity}</span></td><td data-label="Evento" className="py-4"><p className="font-medium">{eventName(event.source, event.type, event.title)}</p><p className="mt-1 max-w-md text-xs text-muted-foreground">{event.target ? `Alvo: ${event.target}` : event.details?.[0] ? `${event.details[0].label}: ${event.details[0].value}` : event.ipAddress ? `IP: ${event.ipAddress}` : event.description}</p></td><td data-label="Ator" className="py-4 text-muted-foreground">{event.actor ?? "—"}</td></tr>)}</tbody></table></div>}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-3"><span className="text-xs text-muted-foreground">Página {pageOffsets.length} · até 25 eventos</span><Button variant="outline" disabled={pageOffsets.length === 1 || page.isFetching} onClick={() => setPageOffsets((current) => current.slice(0, -1))}>Anterior</Button><Button variant="outline" disabled={page.data?.nextOffset == null || page.isFetching} onClick={() => { if (page.data?.nextOffset != null) setPageOffsets((current) => [...current, page.data!.nextOffset!]); }}>Próxima</Button></div>
    </CardContent></Card>

    <Dialog open={Boolean(selectedEvent)} onOpenChange={(open) => { if (!open) setSelectedEvent(null); }}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{selectedEvent ? eventName(selectedEvent.source, selectedEvent.type, selectedEvent.title) : "Evento"}</DialogTitle>
          <DialogDescription>Detalhes seguros sincronizados do Google Workspace.</DialogDescription>
        </DialogHeader>
        {selectedEvent && <div className="space-y-5">
          <div className="rounded-lg bg-muted/50 p-4"><p className="text-sm font-medium">O que aconteceu</p><p className="mt-1 text-sm leading-6 text-foreground">{eventExplanation(selectedEvent.source, selectedEvent.type)}</p></div>
          <p className="text-sm leading-6 text-muted-foreground">Registro original: {selectedEvent.description}</p>
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
            {selectedEvent.details?.map((detail) => <EventDetail key={detail.label} label={detail.label} value={detail.value} />)}
            <EventDetail label="Usuários afetados" value={selectedEvent.safeDetails?.affectedUsers?.join(", ")} />
            <EventDetail label="Remetente suspeito" value={selectedEvent.safeDetails?.suspectedSender} />
            <EventDetail label="Assunto" value={selectedEvent.safeDetails?.subject} />
            <EventDetail label="Indicadores" value={selectedEvent.safeDetails?.indicatorUrls?.join(", ")} />
            <EventDetail label="Anexos" value={selectedEvent.safeDetails?.attachmentNames?.join(", ")} />
          </dl>
          {(!selectedEvent.details?.length && !selectedEvent.safeDetails) && <p className="text-xs text-muted-foreground">O Google não forneceu mais detalhes utilizáveis para este registro.</p>}
          <div className="rounded-lg bg-muted/50 p-4 text-sm text-foreground">{selectedEvent.source === "oauth_token" ? "Confirme com o usuário se reconhece o aplicativo e as permissões solicitadas. Se não reconhecer, investigue o acesso no Google Admin Console antes de revogar." : selectedEvent.source === "login" ? "Confirme o resultado, IP e conta afetada no Google Admin Console. Se houver atividade não reconhecida, siga o procedimento de resposta a incidentes." : "Revise o evento no Google Admin Console antes de realizar qualquer ação."}</div>
        </div>}
      </DialogContent>
    </Dialog>
  </div></OperationsShell>;
}
