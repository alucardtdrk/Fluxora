import { History, RotateCcw, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type WorkflowChangeHistoryProps = {
  changes: any[];
  canRestore: boolean;
  historyConfigured: boolean;
  onRestore: (snapshotId: string) => Promise<void>;
};

export default function WorkflowChangeHistory({ changes, canRestore, historyConfigured, onRestore }: WorkflowChangeHistoryProps) {
  if (!historyConfigured) return <Card className="border-0 bg-card shadow-sm"><CardContent className="p-6 text-sm text-muted-foreground">Conecte o Firestore para habilitar snapshots automaticos, historico de alteracoes e restauracao de versoes.</CardContent></Card>;

  return (
    <Card className="border-0 bg-card shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-foreground"><History className="h-4 w-4 text-feedback-info" />Historico de alteracoes</CardTitle>
        <p className="text-xs text-muted-foreground">Cada salvamento gera snapshot previo no Firestore antes de atualizar o workflow no n8n.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {changes.length === 0 ? <div className="rounded-2xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">Nenhuma alteracao registrada para este workflow.</div> : changes.map((change) => (
          <div key={change.id} className="rounded-[24px] border border-border bg-muted p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={change.type === "restore" ? "bg-feedback-error-surface text-feedback-error" : "bg-feedback-info-surface text-feedback-info"}>{change.type === "restore" ? "Restauracao" : "Edicao"}</Badge>
                  <span className="text-xs text-muted-foreground">{change.createdAt ? new Date(change.createdAt).toLocaleString("pt-BR") : "-"}</span>
                </div>
                <p className="mt-3 text-sm font-semibold text-foreground">{change.summary || "Alteracao sem resumo"}</p>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />{change.actor}</span>
                  <span>{change.actorRole === "admin" ? "Administrador" : change.actorRole === "operator" ? "Operador" : "Visualizador"}</span>
                  <span>{Array.isArray(change.nodeNames) && change.nodeNames.length ? change.nodeNames.join(", ") : "workflow completo"}</span>
                </div>
              </div>
              <Button
                variant="outline"
                disabled={!canRestore || !(change.restoredFromSnapshotId || change.snapshotId)}
                onClick={async () => { await onRestore(change.restoredFromSnapshotId || change.snapshotId); }}
                className="w-full lg:w-auto"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Restaurar esta versao
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
