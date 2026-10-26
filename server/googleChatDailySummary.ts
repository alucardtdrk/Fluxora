import { createHash } from "node:crypto";
import { getFirestoreDocument, runFirestoreQuery, setFirestoreDocument } from "./firestore.js";
import { getFluxoraCollectionPaths } from "./fluxoraFirestorePaths.js";
import { getN8nAnalytics } from "./n8n.js";

// Run only from the scheduled Workspace cycle; manual refreshes do not send messages.
export async function sendDailyChatSummary(collection: { status: string; sources: Record<string, { status: string }> }) {
  const configured = process.env.GOOGLE_CHAT_DAILY_SUMMARY_WEBHOOK_URL?.trim();
  if (!configured) return { status: "disabled" as const };
  let destination: URL;
  try {
    destination = new URL(configured);
    if (destination.origin !== "https://chat.googleapis.com" || destination.username || destination.password || !/^\/v1\/spaces\/[\w-]+\/messages$/.test(destination.pathname) || !destination.searchParams.get("key") || !destination.searchParams.get("token")) return { status: "invalid_configuration" as const };
  } catch { return { status: "invalid_configuration" as const }; }

  const now = new Date();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  const since = new Date(now.getTime() - 86_400_000);
  const hash = createHash("sha256").update(`fluxora-daily:${day}:${destination.pathname}`).digest("hex");
  const requestId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  // Incoming webhooks reject requestId; delivery tracking stays in Firestore.
  destination.searchParams.delete("requestId");
  const systemCollection = getFluxoraCollectionPaths("system").destination;
  const deliveryId = `google-chat-daily-${day}-${hash.slice(0, 8)}`;
  try {
    const previous = await getFirestoreDocument(systemCollection, deliveryId);
    if (previous?.sentAt) return { status: "already_sent" as const };
    let text = typeof previous?.text === "string" ? previous.text : "";
    if (!text) {
      const [operation, security] = await Promise.allSettled([
        getN8nAnalytics("7d"),
        runFirestoreQuery({ from: [{ collectionId: getFluxoraCollectionPaths("workspaceSecurityFindings").legacy }], where: { compositeFilter: { op: "AND", filters: [
          { fieldFilter: { field: { fieldPath: "lastOccurredAt" }, op: "GREATER_THAN_OR_EQUAL", value: { timestampValue: since.toISOString() } } },
          { fieldFilter: { field: { fieldPath: "lastOccurredAt" }, op: "LESS_THAN_OR_EQUAL", value: { timestampValue: now.toISOString() } } },
        ] } }, orderBy: [{ field: { fieldPath: "lastOccurredAt" }, direction: "DESCENDING" }], limit: 500 }),
      ]);
      const lines = ["📊 *Fluxora · Resumo diário*", now.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })];
      const attention: string[] = [];
      const details: string[] = [];
      if (operation.status === "fulfilled" && operation.value.status === "ok") {
        const daily = operation.value.executionSummary24h;
        details.push("", "⚙️ *Execuções · últimas 24h*");
        if (daily?.executions === 0) details.push("Nenhuma execução registrada no período.");
        else if (daily) {
          details.push(`${daily.executions.toLocaleString("pt-BR")} execuções · ${daily.workflows.toLocaleString("pt-BR")} workflows`, `${daily.success.toLocaleString("pt-BR")} com sucesso · ${daily.errors.toLocaleString("pt-BR")} com erro`);
          if (daily.successRate != null) details.push(`Taxa de sucesso: ${daily.successRate.toLocaleString("pt-BR")}%`);
          if (daily.others) details.push(`${daily.others.toLocaleString("pt-BR")} em outros estados (em andamento, aguardando ou canceladas).`);
          if (daily.errors) attention.push(`• ${daily.errors.toLocaleString("pt-BR")} execuções com erro nas últimas 24h`);
        } else {
          details.push("Dados indisponíveis.");
          attention.push("• Execuções nas últimas 24h: dados indisponíveis");
        }
        const incidents = operation.value.incidentGroups;
        const pending = incidents.filter((incident) => incident.lifecycle.status === "new").length;
        const investigating = incidents.filter((incident) => incident.lifecycle.status === "investigating" || incident.lifecycle.status === "acknowledged").length;
        const resolved = incidents.filter((incident) => incident.lifecycle.status === "resolved" && incident.lifecycle.resolvedAt && Date.parse(incident.lifecycle.resolvedAt) >= since.getTime() && Date.parse(incident.lifecycle.resolvedAt) <= now.getTime()).length;
        const unassigned = incidents.filter((incident) => incident.lifecycle.status !== "resolved" && ["high", "critical"].includes(incident.lifecycle.severity) && !incident.lifecycle.owner).length;
        if (pending) attention.push(`• ${pending} incidentes pendentes`);
        if (unassigned) attention.push(`• ${unassigned} incidentes prioritários sem responsável`);
        details.push("", "👥 *Atendimento · ocorrências dos últimos 7 dias*", `• Em investigação: ${investigating}`, `• Resolvidos nas últimas 24h: ${resolved}`, `• Prioritários sem responsável: ${unassigned}`);
        if (operation.value.truncated) attention.push("• Os dados de operação estão parciais");
      } else {
        attention.push("• Execuções e incidentes: dados indisponíveis");
        details.push("", "⚙️ *Execuções · últimas 24h*", "Dados indisponíveis.", "", "👥 *Atendimento · ocorrências dos últimos 7 dias*", "Incidentes: dados indisponíveis. Consulte o Fluxora antes de concluir que não há pendências.");
      }
      const states = Object.values(collection.sources);
      const failed = states.filter((source) => source.status === "failure").length;
      const pending = states.filter((source) => source.status === "incomplete").length;
      const status = collection.status === "success" ? "concluída" : collection.status === "partial" ? "parcial" : collection.status === "skipped_locked" ? "não executada: outro ciclo em andamento" : "falhou";
      const partial = collection.status !== "success" || failed > 0 || pending > 0;
      const collectionLine = `Coleta Workspace: ${status}${failed ? ` · ${failed} fontes com falha` : ""}${pending ? ` · ${pending} fontes com páginas pendentes` : ""}`;
      if (partial) attention.push(`• ${collectionLine}`);
      if (security.status === "rejected") attention.push("• Segurança: dados indisponíveis");
      if (attention.length) lines.push("", "⚠️ *Pontos de atenção*", ...attention);
      lines.push(...details, "", "🛡️ *Segurança · últimas 24h*");
      if (security.status === "fulfilled") {
        const count = security.value.length;
        lines.push(count ? `${count === 500 ? "Pelo menos " : ""}${count} achados registrados para revisão.` : "Nenhum achado registrado no período.");
        if (count) lines.push("Achados são sinais para investigação; não confirmam invasão.");
      } else lines.push("Não foi possível verificar os achados recentes.");
      if (partial) lines.push(collection.status === "partial" ? "A coleta está parcial; esse resultado pode estar incompleto." : "A coleta não foi concluída integralmente; esse resultado pode estar incompleto.");
      else lines.push(collectionLine + ".");
      try {
        const base = new URL(process.env.APP_BASE_URL || "");
        if (base.protocol === "https:" && !base.username && !base.password) lines.push("", `🔗 <${base.origin}/monitoring|Abrir Monitoramento> · <${base.origin}/workspace-security|Abrir Segurança>`);
      } catch { /* Links are omitted when the public URL is not configured. */ }
      text = lines.join("\n");
      await setFirestoreDocument(systemCollection, deliveryId, { day, requestId, text, status: "pending", createdAt: now.toISOString() });
    }
    const response = await fetch(destination, { method: "POST", headers: { "content-type": "application/json; charset=UTF-8" }, body: JSON.stringify({ text }), redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return { status: "failed" as const };
    await setFirestoreDocument(systemCollection, deliveryId, { day, requestId, text, status: "sent", sentAt: new Date().toISOString() });
    return { status: "sent" as const };
  } catch {
    return { status: "failed" as const };
  }
}
