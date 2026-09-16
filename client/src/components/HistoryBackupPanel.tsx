import { AlertTriangle, CheckCircle2, Clock3, Database, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

type HistoryBackupPanelProps = {
  archive: any;
  loading: boolean;
  syncing: boolean;
  activity: string;
  onRunCycle: () => void;
  onRefresh: () => void;
};

const formatNumber = (value: unknown) => Number(value || 0).toLocaleString("pt-BR");

export default function HistoryBackupPanel({ archive, loading, syncing, activity, onRunCycle, onRefresh }: HistoryBackupPanelProps) {
  const state = archive?.state || {};
  const protectedCount = Number(archive?.totalArchived || 0);
  const storedCount = Number(archive?.totalStored || protectedCount);
  const legacyCount = Math.max(0, storedCount - protectedCount);
  const sourceCount = typeof state.sourceExecutionCount === "number" ? state.sourceExecutionCount : null;
  const missingCount = typeof state.missingExecutionCount === "number" ? state.missingExecutionCount : null;
  const detailsSaved = Number(state.detailsHydrated || 0);
  const detailsPending = Number(state.detailsPending || 0);
  const detailsUnavailable = Number(state.detailsUnavailable || 0);
  const detailsTotal = detailsSaved + detailsPending + detailsUnavailable;
  const detailsPercent = detailsTotal ? Math.round((detailsSaved / detailsTotal) * 100) : 0;
  const historyChecked = sourceCount == null ? 0 : Math.min(sourceCount, Number(state.backfillScanned || 0));
  const historyPercent = sourceCount ? Math.min(100, Math.round((historyChecked / sourceCount) * 100)) : 0;
  const historyComplete = Boolean(state.backfillComplete && state.archiveFormatVersion === 2 && missingCount === 0);
  const fullyProtected = historyComplete && detailsPending === 0;
  const lastUpdated = state.lastSyncAt ? new Date(String(state.lastSyncAt)).toLocaleString("pt-BR") : "Ainda não executado";
  const hasError = Boolean(state.lastError);
  const errorMessage = String(state.lastError || "").toLowerCase() === "fetch failed"
    ? "A comunicação com o n8n ou o Firestore foi interrompida temporariamente. O progresso anterior está salvo; tente executar o ciclo novamente."
    : String(state.lastError || "");
  const statusLabel = syncing ? "Sincronizando agora" : hasError ? "Requer atenção" : fullyProtected ? "Proteção concluída" : historyComplete ? "Detalhes pendentes" : missingCount != null ? `${formatNumber(missingCount)} pendentes` : state.backfillStarted ? "Revisão pendente" : "Não iniciada";
  const statusClass = hasError
    ? "border-destructive/25 bg-destructive/10 text-destructive"
    : fullyProtected
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
      : "border-primary/20 bg-primary/10 text-primary";
  const cycleButtonLabel = syncing
    ? historyComplete ? "Preservando até 300 detalhes…" : "Avançando até 300 execuções…"
    : historyComplete ? "Preservar próximo lote" : "Avançar histórico principal";
  const lastCycleLabel = historyComplete ? "Detalhes no último ciclo" : "Verificadas no último ciclo";
  const lastCycleCount = historyComplete ? state.lastDetailAttempted : state.lastRunProcessed;

  return <div className="space-y-6">
    <Card className="border-0">
      <CardHeader className="gap-5 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="flex items-center gap-2 text-xl"><ShieldCheck className="h-5 w-5 text-primary" />Proteção do histórico</CardTitle>
            <Badge variant="outline" className={statusClass}>{syncing && <RefreshCw className="mr-1.5 h-3 w-3 animate-spin" />}{statusLabel}</Badge>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">Mantém no Firestore uma cópia consultável das execuções do n8n. O histórico principal alimenta indicadores; os detalhes preservam nodes, entradas, saídas e erros.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onRunCycle} disabled={syncing || loading}>{cycleButtonLabel}</Button>
          <Button variant="outline" onClick={onRefresh} disabled={syncing}><RefreshCw className="mr-2 h-4 w-4" />Atualizar status</Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-muted/35 p-4"><p className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Database className="h-4 w-4" />Execuções protegidas</p><p className="mt-2 text-2xl font-semibold">{formatNumber(protectedCount)}</p></div>
          <div className="rounded-xl border bg-muted/35 p-4"><p className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><ShieldCheck className="h-4 w-4" />Cobertura principal</p><p className="mt-2 text-2xl font-semibold">{missingCount == null ? "Calculando" : state.reconciliationTruncated ? "Parcial" : missingCount === 0 ? "Completa" : sourceCount == null ? `${formatNumber(missingCount)} pendentes` : `${formatNumber(historyChecked)} de ${formatNumber(sourceCount)} verificadas`}</p>{!historyComplete && sourceCount != null && <div className="mt-3"><Progress value={historyPercent} /><p className="mt-2 text-xs text-muted-foreground">{historyPercent}% da revisão concluída</p></div>}</div>
          <div className="rounded-xl border bg-muted/35 p-4"><p className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Clock3 className="h-4 w-4" />Última atualização</p><p className="mt-2 text-base font-semibold">{lastUpdated}</p></div>
        </div>
      </CardContent>
    </Card>

    {syncing && <div role="status" className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm font-medium text-primary"><RefreshCw className="h-4 w-4 animate-spin" />{activity || "Executando o próximo ciclo…"}</div>}
    {hasError && <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /><div><p className="font-semibold text-destructive">O último ciclo não foi concluído</p><p className="mt-1 text-muted-foreground">{errorMessage}</p></div></div>}

    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="border-0">
        <CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2 text-base"><Server className="h-4 w-4 text-primary" />1. Histórico principal</CardTitle><p className="mt-2 text-sm leading-6 text-muted-foreground">Copia ID, workflow, status, data e duração. É a base das listas, métricas e relatórios.</p></div><Badge variant={historyComplete ? "secondary" : "outline"}>{historyComplete ? "Concluído" : "Pendente"}</Badge></div></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-sm"><div><p className="text-xs text-muted-foreground">No n8n</p><p className="mt-1 font-semibold">{sourceCount == null ? "—" : formatNumber(sourceCount)}</p></div><div><p className="text-xs text-muted-foreground">Protegidas</p><p className="mt-1 font-semibold">{formatNumber(protectedCount)}</p></div><div><p className="text-xs text-muted-foreground">Pendentes na última revisão</p><p className="mt-1 font-semibold">{missingCount == null ? "—" : formatNumber(missingCount)}</p></div></div>
          {!historyComplete && sourceCount != null && <div><div className="mb-2 flex justify-between text-xs text-muted-foreground"><span>Progresso da revisão</span><span>{formatNumber(historyChecked)} de {formatNumber(sourceCount)}</span></div><Progress value={historyPercent} /></div>}
          <p className="text-xs leading-5 text-muted-foreground">A comparação é feita pelo ID de cada execução. Registros já existentes não são duplicados.</p>
        </CardContent>
      </Card>

      <Card className="border-0">
        <CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2 text-base"><Database className="h-4 w-4 text-primary" />2. Nodes e respostas</CardTitle><p className="mt-2 text-sm leading-6 text-muted-foreground">Preserva o caminho executado e os dados técnicos disponíveis antes que o n8n os remova.</p></div><Badge variant={detailsPending === 0 && detailsTotal > 0 ? "secondary" : "outline"}>{detailsPending === 0 && detailsTotal > 0 ? "Concluído" : "Em fila"}</Badge></div></CardHeader>
        <CardContent className="space-y-4">
          <div><div className="mb-2 flex justify-between text-sm"><span className="text-muted-foreground">Detalhes preservados</span><span className="font-semibold">{detailsPercent}%</span></div><Progress value={detailsPercent} /></div>
          <div className="grid grid-cols-3 gap-3 text-sm"><div><p className="text-xs text-muted-foreground">Salvos</p><p className="mt-1 font-semibold">{formatNumber(detailsSaved)}</p></div><div><p className="text-xs text-muted-foreground">Na fila</p><p className="mt-1 font-semibold">{formatNumber(detailsPending)}</p></div><div><p className="text-xs text-muted-foreground">Indisponíveis</p><p className="mt-1 font-semibold">{formatNumber(detailsUnavailable)}</p></div></div>
        </CardContent>
      </Card>
    </div>

    <Card className="border-0"><CardContent className="grid gap-5 p-6 md:grid-cols-[1fr_auto] md:items-center"><div><p className="font-semibold">Operação automática</p><p className="mt-1 text-sm leading-6 text-muted-foreground">A proteção do histórico avança diariamente, mesmo com esta página fechada.</p>{legacyCount > 0 && <p className="mt-2 text-xs text-muted-foreground">O Firestore também mantém {formatNumber(legacyCount)} registros legados durante a validação.</p>}</div><div className="text-sm md:text-right"><p className="text-xs text-muted-foreground">{lastCycleLabel}</p><p className="mt-1 font-semibold">{formatNumber(lastCycleCount)}</p></div></CardContent></Card>
  </div>;
}
