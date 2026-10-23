import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ShieldAlert, ShieldCheck, UserRoundX } from "lucide-react";
import OperationsShell from "@/components/OperationsShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { sourceLabels, shouldRefreshCurrentSecurity, summarizeSecurityCollection } from "@/lib/workspaceSecurityRefresh";



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
    content_matched: "Conteúdo correspondente à regra", content_unmatched: "Conteúdo deixou de corresponder à regra", action_complete: "Ação da regra concluída",
    access_item_content: "Conteúdo do arquivo acessado", download: "Arquivo baixado", upload: "Arquivo enviado", view: "Recurso visualizado", edit: "Recurso editado", delete: "Recurso excluído",
  };
  return names[type] ?? (source === "alert_center" ? fallback : type.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()));
}

function eventExplanation(source: string, type: string) {
  if (source === "rules" && type === "content_matched") return "Uma verificação encontrou conteúdo correspondente a uma regra. Confira o documento, o proprietário, os detectores e as ações da regra abaixo. O proprietário não é necessariamente quem realizou a ação.";
  if (source === "rules" && type === "content_unmatched") return "O conteúdo verificado deixou de corresponder à regra. Confira o recurso e a regra abaixo.";
  if (source === "rules" && type === "action_complete") return "O Google registrou a conclusão de uma ação da regra. Confira as ações e o recurso abaixo para identificar o que foi executado.";
  if (source === "drive" && type === "access_item_content") return "O Google registrou um acesso ao conteúdo de um arquivo. Confira o ator, documento, proprietário e aplicativo quando informados.";
  if (source === "drive" && type === "download") return "O Google registrou o download de um arquivo. Confira quem realizou o download e qual documento foi baixado nos campos abaixo.";
  if (source === "admin" && type === "ALERT_CENTER_VIEW") return "Um administrador consultou um alerta no Admin Console. Este registro não indica que o alerta foi alterado.";
  if (source === "admin" && type === "SECURITY_INVESTIGATION_QUERY") return "Um administrador executou uma consulta na ferramenta de investigação de segurança. O registro não informa o conteúdo da consulta.";
  if (source === "login" && type === "login_success") return "A conta concluiu uma autenticação. Um login bem-sucedido também pode ser marcado como suspeito pelo Google. Confira essa indicação, o método e as etapas registradas abaixo; a marcação, por si só, não confirma uma invasão.";
  if (source === "login" && type === "login_failure") return "Houve uma tentativa de autenticação sem sucesso. Confira o motivo, a conta e o endereço IP quando disponíveis.";
  return "O Google registrou esta atividade. Confira abaixo quem participou, quando ocorreu e os dados adicionais fornecidos pela fonte.";
}

export default function WorkspaceSecurity() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [loadingEvidence, setLoadingEvidence] = useState<string | null>(null);
  async function analyzeEvidence(id: string) {
    setLoadingEvidence(id);
    try {
      const event = await utils.workspaceSecurity.event.fetch({ id });
      if (event) setSelectedEvent(event);
      else toast.message("Evidência indisponível", { description: "O registro não está mais disponível no histórico armazenado." });
    } catch {
      toast.error("Não foi possível carregar a evidência", { description: "Tente novamente em instantes." });
    } finally {
      setLoadingEvidence(null);
    }
  }
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
  const collection = summarizeSecurityCollection(sources);
  const attentionEvents = (dashboard.data?.events ?? []).filter((event) =>
    (event.severity === "critical" || (event.severity === "high" && ["login", "alert_center", "drive", "rules"].includes(event.source))) &&
    !findings.some((finding) => finding.eventIds.includes(event.id))
  );
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

    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
      <span>{dashboard.isLoading ? "Verificando coleta…" : dashboard.isError ? "Não foi possível verificar a coleta." : collection.latestCompletedAt ? `Última coleta registrada: ${new Date(collection.latestCompletedAt).toLocaleString("pt-BR")}` : "Nenhuma coleta registrada."}</span>
      {collection.failed > 0 && <span className="text-orange-700 dark:text-orange-300">Falha em {collection.failed} fonte(s).</span>}
      {collection.incomplete > 0 && <span className="text-amber-700 dark:text-amber-300">{collection.incomplete} fonte(s) com páginas ainda não coletadas. Cada atualização processa um lote.</span>}
      {collection.awaiting > 0 && <span className="text-amber-700 dark:text-amber-300">{collection.awaiting} fonte(s) aguardando coleta.</span>}
    </div>
    <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard icon={ShieldCheck} label="Eventos na amostra" value={summary.recentEvents} description="Até 250 registros mais recentes; use a lista paginada para ver os anteriores." />
      <MetricCard icon={ShieldAlert} label="Alta ou crítica na amostra" value={summary.highOrCriticalEvents} description="Eventos prioritários entre os 250 mais recentes." />
      <MetricCard icon={AlertTriangle} label="Sem 2SV" value={posture?.usersWithoutTwoStepVerification ?? 0} description="Usuários sem verificação em duas etapas." />
      <MetricCard icon={UserRoundX} label="Usuários suspensos" value={posture?.suspendedUsers ?? 0} description="Contas suspensas no diretório." />
    </div>

    <Card className="mt-6 border-orange-500/40 bg-orange-500/5"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="h-5 w-5 text-orange-600 dark:text-orange-300" />Requer atenção{dashboard.data && <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-xs">{findings.length + attentionEvents.length}</span>}</CardTitle><p className="text-xs text-muted-foreground">Sinais de risco e eventos prioritários para investigação. Um alerta isolado também merece revisão.</p></CardHeader><CardContent>
      {dashboard.isLoading ? <p className="text-sm text-muted-foreground">Carregando alertas de segurança…</p> : dashboard.isError ? <p className="text-sm text-orange-700 dark:text-orange-300">Não foi possível carregar os alertas. Tente atualizar a segurança novamente.</p> : findings.length + attentionEvents.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum alerta encontrado nos achados armazenados e na amostra dos 250 eventos mais recentes. Isso não garante ausência de risco; consulte o histórico e a cobertura das fontes.</p> : <div className="max-h-[560px] space-y-3 overflow-y-auto">
        {findings.map((finding) => <div key={finding.id} className="rounded-xl border border-orange-500/30 p-4"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${severityClass(finding.severity)}`}>{severityLabels[finding.severity] ?? finding.severity}</span><p className="font-medium">{finding.title}</p></div><p className="mt-2 text-sm text-muted-foreground">{finding.description}</p><p className="mt-3 break-words text-xs text-muted-foreground">{finding.subjects.join(", ") || "Usuário não disponibilizado pelo Google"} · {new Date(finding.lastOccurredAt).toLocaleString("pt-BR")} · {finding.evidenceCount} evidências</p><p className="mt-1 break-words text-xs text-muted-foreground">IP: {finding.ipAddresses.join(", ") || "não informado pelo Google"}</p><div className="mt-3 flex flex-wrap gap-2">{finding.eventIds.map((id, index) => <Button key={id} size="sm" variant="outline" disabled={loadingEvidence !== null} onClick={() => void analyzeEvidence(id)}>{loadingEvidence === id ? "Carregando…" : finding.eventIds.length === 1 ? "Analisar evento" : `Analisar evidência ${index + 1}`}</Button>)}</div></div>)}
        {attentionEvents.map((event) => <div key={event.id} className="rounded-xl border border-orange-500/30 p-4"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${severityClass(event.severity)}`}>{severityLabels[event.severity] ?? event.severity}</span><p className="font-medium">{eventName(event.source, event.type, event.title)}</p></div><p className="mt-2 break-words text-sm text-muted-foreground">{event.target ?? event.actor ?? "Usuário não disponibilizado pelo Google"} · {new Date(event.occurredAt).toLocaleString("pt-BR")}</p><p className="mt-1 break-words text-xs text-muted-foreground">IP: {event.ipAddress ?? "não informado pelo Google"}{event.country ? ` · País: ${event.country}` : ""}</p><Button className="mt-3" size="sm" variant="outline" onClick={() => setSelectedEvent(event)}>Analisar evento</Button></div>)}
      </div>}
      <p className="mt-4 text-xs text-muted-foreground">Confirme acessos e exportações com o usuário e revise as evidências no Google Admin Console. IPs diferentes podem decorrer de VPN ou rede móvel; o endereço sozinho não confirma invasão.</p>
    </CardContent></Card>



    {posture && <Card className="mt-6 border-0">
      <CardHeader className="pb-4">
        <CardTitle className="text-base">Postura de segurança</CardTitle>
        <p className="text-xs text-muted-foreground">Contas que precisam de revisão das configurações de acesso.</p>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        {[
          { title: "Sem verificação em duas etapas", description: "Revise a proteção adicional dessas contas.", count: posture.usersWithoutTwoStepVerification, people: posture.usersWithoutTwoStepVerificationDetails, icon: ShieldAlert, tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
          { title: "Contas suspensas", description: "Confira se a suspensão ainda é necessária.", count: posture.suspendedUsers, people: posture.suspendedUserDetails, icon: UserRoundX, tone: "bg-muted text-muted-foreground" },
        ].map(({ title, description, count, people, icon: Icon, tone }) => <section key={title} className="min-w-0 overflow-hidden rounded-xl border border-border/70">
          <div className="flex items-start gap-3 border-b border-border/70 bg-muted/20 p-4">
            <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tone}`}><Icon className="size-4" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold leading-5">{title}</h3><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>
            <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold tabular-nums ${tone}`}>{count.toLocaleString("pt-BR")}<span className="sr-only"> contas</span></span>
          </div>
          {people.length > 0 ? <ScrollArea className="h-64" role="region" aria-label={title}>
            <ul className="divide-y divide-border/50 px-4">
              {people.map((person) => <li key={person.id} className="py-3 pr-3">
                <p className="break-words text-sm font-medium leading-5">{person.displayName ?? person.email ?? person.id}</p>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {person.email && <span className="min-w-0 break-all">{person.email}</span>}
                  {person.orgUnitPath && <span className="min-w-0 break-words text-[11px]">{person.orgUnitPath}</span>}
                </div>
              </li>)}
            </ul>
          </ScrollArea> : <p className="px-4 py-8 text-center text-sm text-muted-foreground">{count === 0 ? "Nenhuma conta nesta condição." : "Detalhes das contas não disponíveis nesta coleta."}</p>}
          <div className="border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground">{people.length.toLocaleString("pt-BR")} de {count.toLocaleString("pt-BR")} contas listadas</div>
        </section>)}
      </CardContent>
    </Card>}



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
            {!selectedEvent.actor && <div><dt className="text-xs font-medium text-muted-foreground">Ator</dt><dd className="mt-1 text-sm text-muted-foreground">Não informado no registro. Proprietários e usuários afetados são apresentados separadamente quando disponíveis.</dd></div>}
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
