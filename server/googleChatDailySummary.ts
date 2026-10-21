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
  destination.searchParams.set("requestId", requestId);
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
      const lines = [`*Resumo diário do Fluxora — ${now.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}*`];
      if (operation.status === "fulfilled" && operation.value.status === "ok") {
        const incidents = operation.value.incidentGroups;
        const pending = incidents.filter((incident) => incident.lifecycle.status === "new").length;
        const investigating = incidents.filter((incident) => incident.lifecycle.status === "investigating" || incident.lifecycle.status === "acknowledged").length;
        const resolved = incidents.filter((incident) => incident.lifecycle.status === "resolved" && incident.lifecycle.resolvedAt && Date.parse(incident.lifecycle.resolvedAt) >= since.getTime() && Date.parse(incident.lifecycle.resolvedAt) <= now.getTime()).length;
        const unassigned = incidents.filter((incident) => incident.lifecycle.status !== "resolved" && ["high", "critical"].includes(incident.lifecycle.severity) && !incident.lifecycle.owner).length;
        lines.push("", "*Atendimento — incidentes com ocorrências nos últimos 7 dias*", `${pending} pendentes · ${investigating} em investigação`, `${resolved} resolvidos nas últimas 24h · ${unassigned} prioritários sem responsável`);
        if (operation.value.truncated) lines.push("Atenção: os dados de operação estão parciais.");
      } else lines.push("", "Incidentes: dados indisponíveis. Consulte o Fluxora antes de concluir que não há pendências.");
      if (security.status === "fulfilled") {
        const count = security.value.length;
        lines.push("", `*Segurança — últimas 24h:* ${count === 500 ? "pelo menos " : ""}${count} achados registrados para revisão.`);
      } else lines.push("", "Segurança: dados indisponíveis. Não foi possível verificar os achados recentes.");
      const states = Object.values(collection.sources);
      const failed = states.filter((source) => source.status === "failure").length;
      const pending = states.filter((source) => source.status === "incomplete").length;
      const status = collection.status === "success" ? "concluída" : collection.status === "partial" ? "parcial" : collection.status === "skipped_locked" ? "não executada: outro ciclo em andamento" : "falhou";
      lines.push("", `Coleta Workspace: ${status}${failed ? ` · ${failed} fontes com falha` : ""}${pending ? ` · ${pending} fontes com páginas pendentes` : ""}.`, "Achados são sinais para investigação; não confirmam invasão.");
      try {
        const base = new URL(process.env.APP_BASE_URL || "");
        if (base.protocol === "https:" && !base.username && !base.password) lines.push("", `<${base.origin}/monitoring|Abrir Monitoramento> · <${base.origin}/workspace-security|Abrir Workspace Security>`);
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
